using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;

namespace Quizymode.Api.Services.Taxonomy.Suggestions;

/// <summary>
/// Owns the current <see cref="TopicSuggestionModel"/>. It starts as the taxonomy text only (built from the YAML registry,
/// no database access, nothing at startup) and gains the public item profiles through a single-flight BACKGROUND load,
/// so a request is never blocked on it. Database egress is bounded (AC 8.5):
/// <list type="bullet">
/// <item>Only a text suggestion with enough analyzed terms asks for a load; fallback-only requests never do.</item>
/// <item>A one-row fingerprint (count and newest timestamp of public items) is checked at most once per
/// <see cref="TopicSuggestionOptions.FingerprintInterval"/>; a change only marks the profiles stale.</item>
/// <item>A stale model reloads once <see cref="TopicSuggestionOptions.MinReloadInterval"/> has passed; a seed-sync
/// <see cref="Invalidate"/> bypasses the interval.</item>
/// <item>No more than <see cref="TopicSuggestionOptions.MaxLoadsPerDay"/> loads start in any rolling 24 hours.</item>
/// <item>A failed load keeps the previous model and waits <see cref="TopicSuggestionOptions.FailureRetry"/>.</item>
/// </list>
/// Only eligible items feed the profiles: public item, public category, public navigation keywords, and a path that
/// passes <see cref="ITaxonomyRegistry.IsValidNavigationPath"/>. Private content never does, so a change of visibility
/// is reflected at the next reload (within <see cref="TopicSuggestionOptions.MinReloadInterval"/>).
/// </summary>
internal sealed class TopicSuggestionProfiles(
    IServiceScopeFactory scopeFactory,
    ITaxonomyRegistry registry,
    TopicTextAnalyzer analyzer,
    IOptions<TopicSuggestionOptions> options,
    TimeProvider timeProvider,
    IHostApplicationLifetime lifetime,
    ILogger<TopicSuggestionProfiles> logger) : ITopicSuggestionInvalidator
{
    private sealed record Fingerprint(int Count, DateTime? Newest);

    private readonly object _gate = new();
    private readonly Queue<DateTimeOffset> _loadStarts = new();
    private readonly TopicSuggestionOptions _options = options.Value;
    private TopicSuggestionModel _model = TopicSuggestionModel.Build(registry, options.Value, analyzer, []);
    private DateTimeOffset? _loadedAt;
    private Fingerprint? _fingerprint;
    private DateTimeOffset _lastFingerprintCheck = DateTimeOffset.MinValue;
    private DateTimeOffset _retryAfter = DateTimeOffset.MinValue;
    private bool _stale;
    private bool _invalidated;

    /// <summary>The load in flight or the last one that ran (completed when none); tests await it.</summary>
    internal Task CurrentLoad { get; private set; } = Task.CompletedTask;

    /// <summary>Item-profile loads started so far (including failed ones).</summary>
    internal int LoadsStarted { get; private set; }

    public TopicSuggestionModel Model => Volatile.Read(ref _model);

    public DateTimeOffset? LoadedAtUtc
    {
        get
        {
            lock (_gate)
            {
                return _loadedAt;
            }
        }
    }

    public void Invalidate()
    {
        lock (_gate)
        {
            _invalidated = true;
            _stale = true;
        }
    }

    /// <summary>
    /// Called by a text suggestion (never by a fallback-only one). Starts at most one background load when the rules above
    /// allow it and returns without waiting for it; the fingerprint query, when due, runs inline with a short timeout.
    /// </summary>
    public async Task EnsureFreshAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        DateTimeOffset now = timeProvider.GetUtcNow();
        lock (_gate)
        {
            if (!CurrentLoad.IsCompleted || now < _retryAfter)
            {
                return;
            }

            if (_loadedAt is null || _invalidated)
            {
                TryStartLoad(now);
                return;
            }

            bool expired = now - _loadedAt.Value >= _options.MaxModelAge;
            if (_stale || expired)
            {
                if (expired || now - _loadedAt.Value >= _options.MinReloadInterval)
                {
                    TryStartLoad(now);
                }

                return;
            }

            if (now - _lastFingerprintCheck < _options.FingerprintInterval)
            {
                return;
            }

            _lastFingerprintCheck = now;
        }

        Fingerprint? current;
        try
        {
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(_options.FingerprintTimeout);
            current = await QueryFingerprintAsync(db, timeout.Token);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Topic suggestion fingerprint check failed; keeping the current model.");
            return;
        }

        lock (_gate)
        {
            if (current == _fingerprint)
            {
                return;
            }

            // Changed data only marks the model stale; the reload waits for MinReloadInterval.
            _stale = true;
            if (CurrentLoad.IsCompleted && _loadedAt is not null && now - _loadedAt.Value >= _options.MinReloadInterval)
            {
                TryStartLoad(now);
            }
        }
    }

    // Callers hold _gate.
    private void TryStartLoad(DateTimeOffset now)
    {
        while (_loadStarts.Count > 0 && now - _loadStarts.Peek() >= TimeSpan.FromHours(24))
        {
            _loadStarts.Dequeue();
        }

        if (_loadStarts.Count >= _options.MaxLoadsPerDay)
        {
            logger.LogDebug("Topic suggestion profile load skipped: the daily cap of {Cap} loads is used.", _options.MaxLoadsPerDay);
            return;
        }

        _loadStarts.Enqueue(now);
        LoadsStarted++;
        bool wasStale = _stale;
        bool wasInvalidated = _invalidated;
        _stale = false;
        _invalidated = false;
        CurrentLoad = Task.Run(() => LoadAsync(now, wasStale, wasInvalidated, lifetime.ApplicationStopping));
    }

    private async Task LoadAsync(DateTimeOffset startedAt, bool wasStale, bool wasInvalidated, CancellationToken cancellationToken)
    {
        Stopwatch stopwatch = Stopwatch.StartNew();
        try
        {
            using IServiceScope scope = scopeFactory.CreateScope();
            ApplicationDbContext db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

            // Read before the rows so a change made during the load is seen as stale at the next check.
            Fingerprint? fingerprint = await QueryFingerprintAsync(db, cancellationToken);

            int cap = Math.Max(0, _options.ExplanationCap);
            List<TopicProfileItem> items = [];
            long rows = 0;
            long approximateBytes = 0;
            await foreach (ProfileRow row in ProjectEligibleRows(db, cap).AsAsyncEnumerable().WithCancellation(cancellationToken))
            {
                rows++;
                approximateBytes += row.Category.Length + row.L1.Length + row.L2.Length + row.Question.Length + row.CorrectAnswer.Length + row.Explanation.Length;
                string category = CategoryHelper.NameToSlug(row.Category);
                string l1 = row.L1.ToLowerInvariant();
                string l2 = row.L2.ToLowerInvariant();
                if (!registry.IsValidNavigationPath(category, l1, l2))
                {
                    continue;
                }

                items.Add(TopicProfileDocument.Create(analyzer, category, l1, l2, row.Question, row.CorrectAnswer, row.Explanation, cap));
            }

            TopicSuggestionModel model = TopicSuggestionModel.Build(registry, _options, analyzer, items);
            lock (_gate)
            {
                Volatile.Write(ref _model, model);
                _loadedAt = timeProvider.GetUtcNow();
                _fingerprint = fingerprint;
                _lastFingerprintCheck = _loadedAt.Value;
            }

            logger.LogInformation(
                "Topic suggestion profiles loaded: {Rows} rows, {Eligible} eligible, about {ApproximateBytes} bytes, {ElapsedMs} ms.",
                rows,
                items.Count,
                approximateBytes,
                stopwatch.ElapsedMilliseconds);
        }
        catch (Exception exception)
        {
            lock (_gate)
            {
                _stale |= wasStale;
                _invalidated |= wasInvalidated;
                _retryAfter = startedAt + _options.FailureRetry;
            }

            if (exception is OperationCanceledException && cancellationToken.IsCancellationRequested)
            {
                logger.LogInformation("Topic suggestion profile load cancelled by shutdown.");
            }
            else
            {
                logger.LogWarning(exception, "Topic suggestion profile load failed; keeping the previous model.");
            }
        }
    }

    /// <summary>
    /// The only item query: public items in public categories with public navigation keywords, three text columns and a
    /// capped explanation. No answers list, no keyword join, nothing that identifies an author.
    /// </summary>
    internal static IQueryable<ProfileRow> ProjectEligibleRows(ApplicationDbContext db, int explanationCap)
    {
        return db.Items
            .AsNoTracking()
            .Where(ItemVisibility.PublicEligible)
            .Where(item => item.CategoryId != null
                && !item.Category!.IsPrivate
                && item.NavigationKeywordId1 != null
                && item.NavigationKeywordId2 != null
                && !item.NavigationKeyword1!.IsPrivate
                && !item.NavigationKeyword2!.IsPrivate)
            .Select(item => new ProfileRow(
                item.Category!.Name,
                item.NavigationKeyword1!.Name,
                item.NavigationKeyword2!.Name,
                item.Question,
                item.CorrectAnswer,
                item.Explanation.Substring(0, explanationCap)));
    }

    internal sealed record ProfileRow(string Category, string L1, string L2, string Question, string CorrectAnswer, string Explanation);

    private static async Task<Fingerprint?> QueryFingerprintAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        var row = await db.Items
            .AsNoTracking()
            .Where(ItemVisibility.PublicEligible)
            .GroupBy(_ => 1)
            .Select(group => new { Count = group.Count(), Newest = group.Max(item => item.UpdatedAt ?? item.CreatedAt) })
            .FirstOrDefaultAsync(cancellationToken);

        return row is null ? new Fingerprint(0, null) : new Fingerprint(row.Count, row.Newest);
    }
}
