using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Services;

/// <summary>
/// Daily page-hit maintenance (ANALYTICS-011). On start and then every 24 hours it:
/// <list type="number">
/// <item>classifies any unclassified historical hits (<see cref="PageViewClassificationBackfill"/>);</item>
/// <item>rolls every complete UTC day not yet rolled up into <see cref="PageViewDailyRollup"/> rows
/// (bots and internal sessions excluded, matching the default report view); then</item>
/// <item>deletes raw <see cref="PageView"/> hits older than <see cref="RetentionDays"/> days, and
/// <see cref="AnalyticsSession"/> snapshots older than the same cutoff that no longer have any hits; and
/// finally, only when <see cref="EventsPruningEnabledKey"/> is true (default false), deletes
/// <see cref="AnalyticsEvent"/> rows older than the same cutoff.</item>
/// </list>
/// Raw hits are never deleted for a day that has not been rolled up: pruning only runs after the
/// rollup pass has completed through yesterday, and its cutoff is capped at that point.
/// </summary>
internal sealed class PageViewRetentionService(
    IServiceScopeFactory scopeFactory,
    ILogger<PageViewRetentionService> logger) : BackgroundService
{
    /// <summary>Raw page hits (which carry IP address and user agent) are kept this many days.</summary>
    public const int RetentionDays = 180;

    /// <summary>Area value of the session-level total rows in a day's rollup.</summary>
    public const string AreaAll = "all";

    /// <summary>ScopeType value of a feature area's total rows (all scopes of that area combined).</summary>
    public const string ScopeAll = "all";

    public const string VisitorNew = "new";
    public const string VisitorReturning = "returning";
    public const string VisitorUnknown = "unknown";
    public const string ChannelUnknown = "unknown";
    public const string DeviceUnknown = "unknown";

    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    /// <summary>Configuration key that turns on the 180-day <see cref="AnalyticsEvent"/> prune; off unless set to true.</summary>
    public const string EventsPruningEnabledKey = "PageViewRetention:EventsPruningEnabled";

    public sealed record RunResult(int DaysRolledUp, int HitsDeleted, int SessionsDeleted, int EventsDeleted = 0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using AsyncServiceScope scope = scopeFactory.CreateAsyncScope();
                ApplicationDbContext db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

                IConfiguration configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                bool pruneEvents = configuration.GetValue<bool>(EventsPruningEnabledKey);

                RunResult result = await RunAsync(db, DateTime.UtcNow, stoppingToken, pruneEvents);
                if (result.DaysRolledUp > 0 || result.HitsDeleted > 0 || result.SessionsDeleted > 0 || result.EventsDeleted > 0)
                {
                    logger.LogInformation(
                        "PageViewRetention: rolled up {Days} day(s); deleted {Hits} page hit(s), {Sessions} session snapshot(s) and {Events} engagement event(s) older than {RetentionDays} days.",
                        result.DaysRolledUp, result.HitsDeleted, result.SessionsDeleted, result.EventsDeleted, RetentionDays);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Nothing is pruned when the rollup fails, so a failed run never loses data.
                logger.LogError(ex, "PageViewRetention: error during maintenance run");
            }

            await Task.Delay(Interval, stoppingToken);
        }
    }

    /// <summary>Rolls up every pending complete day, then prunes. Safe to run repeatedly.</summary>
    /// <param name="pruneEvents">Deletes engagement events past the retention window; false by default so nothing is removed until enabled.</param>
    public static async Task<RunResult> RunAsync(
        ApplicationDbContext db,
        DateTime nowUtc,
        CancellationToken cancellationToken,
        bool pruneEvents = false)
    {
        // Classify historical rows first so rollups read stored classification and the backfill
        // never updates a row that this pass is about to prune.
        await PageViewClassificationBackfill.RunAsync(db, cancellationToken);

        DateOnly today = DateOnly.FromDateTime(nowUtc);
        DateOnly lastCompleteDay = today.AddDays(-1);

        DateOnly? firstPendingDay = await FirstPendingDayAsync(db, cancellationToken);
        int daysRolledUp = 0;
        if (firstPendingDay is not null)
        {
            for (DateOnly day = firstPendingDay.Value; day <= lastCompleteDay; day = day.AddDays(1))
            {
                await RollUpDayAsync(db, day, nowUtc, cancellationToken);
                daysRolledUp++;
            }
        }

        // Every day before `today` is now rolled up, so the cutoff can never reach an un-rolled day.
        DateTime retentionCutoffUtc = nowUtc.AddDays(-RetentionDays);
        DateTime rolledThroughUtc = today.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        DateTime cutoffUtc = retentionCutoffUtc < rolledThroughUtc ? retentionCutoffUtc : rolledThroughUtc;

        int hitsDeleted = await db.PageViews
            .Where(pageView => pageView.CreatedUtc < cutoffUtc)
            .ExecuteDeleteAsync(cancellationToken);

        int sessionsDeleted = await db.AnalyticsSessions
            .Where(session => session.FirstSeenUtc < cutoffUtc &&
                !db.PageViews.Any(pageView => pageView.SessionId == session.SessionId))
            .ExecuteDeleteAsync(cancellationToken);

        // Engagement events are not rolled up (daily rollups are page-hit based), so they use the plain retention cutoff.
        int eventsDeleted = 0;
        if (pruneEvents)
        {
            eventsDeleted = await db.AnalyticsEvents
                .Where(analyticsEvent => analyticsEvent.OccurredUtc < cutoffUtc)
                .ExecuteDeleteAsync(cancellationToken);
        }

        return new RunResult(daysRolledUp, hitsDeleted, sessionsDeleted, eventsDeleted);
    }

    private static async Task<DateOnly?> FirstPendingDayAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        bool anyRollup = await db.PageViewDailyRollups.AnyAsync(cancellationToken);
        if (anyRollup)
        {
            DateOnly lastRolledDay = await db.PageViewDailyRollups.MaxAsync(rollup => rollup.Day, cancellationToken);
            return lastRolledDay.AddDays(1);
        }

        bool anyHit = await db.PageViews.AnyAsync(cancellationToken);
        if (!anyHit)
        {
            return null;
        }

        DateTime earliestHitUtc = await db.PageViews.MinAsync(pageView => pageView.CreatedUtc, cancellationToken);
        return DateOnly.FromDateTime(earliestHitUtc);
    }

    private sealed record DayHit(
        Guid Id,
        string SessionId,
        DateTime CreatedUtc,
        bool IsAuthenticated,
        string? Area,
        string? ScopeType,
        string? ScopeKey,
        string Path,
        string QueryString,
        bool IsItemStep);

    private sealed record SessionDims(string Channel, string DeviceClass, string? Country, string Outcome, string VisitorType);

    /// <summary>Replaces <paramref name="day"/>'s rollup rows with a fresh aggregate of its raw hits.</summary>
    public static async Task RollUpDayAsync(ApplicationDbContext db, DateOnly day, DateTime nowUtc, CancellationToken cancellationToken)
    {
        DateTime startUtc = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        DateTime endUtc = startUtc.AddDays(1);

        IQueryable<PageView> dayQuery = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= startUtc && pageView.CreatedUtc < endUtc && !pageView.IsBot);
        dayQuery = InternalTrafficFilter.ExcludeInternalSessions(db, dayQuery);

        List<DayHit> hits = await dayQuery
            .Select(pageView => new DayHit(
                pageView.Id,
                pageView.SessionId,
                pageView.CreatedUtc,
                pageView.IsAuthenticated,
                pageView.Area,
                pageView.ScopeType,
                pageView.ScopeKey,
                pageView.Path,
                pageView.QueryString,
                pageView.IsItemStep))
            .ToListAsync(cancellationToken);

        List<PageViewDailyRollup> rows = hits.Count == 0
            ? []
            : await BuildRowsAsync(db, day, hits, nowUtc, cancellationToken);

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await db.PageViewDailyRollups
            .Where(rollup => rollup.Day == day)
            .ExecuteDeleteAsync(cancellationToken);
        db.PageViewDailyRollups.AddRange(rows);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        db.ChangeTracker.Clear();
    }

    private static async Task<List<PageViewDailyRollup>> BuildRowsAsync(
        ApplicationDbContext db,
        DateOnly day,
        List<DayHit> hits,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        List<string> sessionIds = hits.Select(hit => hit.SessionId).Distinct(StringComparer.Ordinal).ToList();

        var snapshots = await db.AnalyticsSessions
            .AsNoTracking()
            .Where(session => sessionIds.Contains(session.SessionId))
            .Select(session => new { session.SessionId, session.VisitorId, session.FirstSeenUtc, session.Channel, session.DeviceClass, session.Country })
            .ToListAsync(cancellationToken);
        var snapshotBySession = snapshots
            .GroupBy(snapshot => snapshot.SessionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        // A visitor's first session (by first-seen time, then session id) is "new"; later ones are "returning".
        List<string> visitorIds = snapshots
            .Where(snapshot => snapshot.VisitorId != null)
            .Select(snapshot => snapshot.VisitorId!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var visitorSessions = await db.AnalyticsSessions
            .AsNoTracking()
            .Where(session => session.VisitorId != null && visitorIds.Contains(session.VisitorId))
            .Select(session => new { VisitorId = session.VisitorId!, session.SessionId, session.FirstSeenUtc })
            .ToListAsync(cancellationToken);
        Dictionary<string, string> firstSessionByVisitor = visitorSessions
            .GroupBy(session => session.VisitorId, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.OrderBy(session => session.FirstSeenUtc).ThenBy(session => session.SessionId, StringComparer.Ordinal).First().SessionId,
                StringComparer.Ordinal);

        Dictionary<string, SessionDims> dimsBySession = new(StringComparer.Ordinal);
        foreach (IGrouping<string, DayHit> session in hits.GroupBy(hit => hit.SessionId, StringComparer.Ordinal))
        {
            List<DayHit> ordered = session.OrderBy(hit => hit.CreatedUtc).ThenBy(hit => hit.Id).ToList();
            string outcome = ordered[0].IsAuthenticated
                ? SessionClassifier.OutcomeAuthenticated
                : ordered.Any(hit => hit.IsAuthenticated)
                    ? SessionClassifier.OutcomeConverted
                    : SessionClassifier.OutcomeAnonymous;

            snapshotBySession.TryGetValue(session.Key, out var snapshot);
            string visitorType = snapshot?.VisitorId is null
                ? VisitorUnknown
                : firstSessionByVisitor.TryGetValue(snapshot.VisitorId, out string? firstSessionId) && firstSessionId == session.Key
                    ? VisitorNew
                    : VisitorReturning;

            dimsBySession[session.Key] = new SessionDims(
                snapshot?.Channel ?? ChannelUnknown,
                snapshot?.DeviceClass ?? DeviceUnknown,
                snapshot?.Country,
                outcome,
                visitorType);
        }

        var classified = hits.Select(hit =>
        {
            // Hits not yet reached by the classification backfill are classified the same way here.
            PageHitClassifier.Classification classification = hit.Area is null
                ? PageHitClassifier.Classify(hit.Path, hit.QueryString)
                : new PageHitClassifier.Classification(hit.Area, hit.ScopeType, hit.ScopeKey, null, hit.IsItemStep);

            // Item scope is dropped: one row per item id would make the rollup as large as the raw table.
            bool keepScope = classification.ScopeType is PageHitClassifier.ScopeCategory or PageHitClassifier.ScopeCollection;

            return new
            {
                hit.SessionId,
                classification.Area,
                ScopeType = keepScope ? classification.ScopeType : null,
                ScopeKey = keepScope ? classification.ScopeKey : null,
                classification.IsItemStep,
                Dims = dimsBySession[hit.SessionId]
            };
        }).ToList();

        List<PageViewDailyRollup> rows = classified
            .GroupBy(hit => (hit.Area, hit.ScopeType, hit.ScopeKey, hit.Dims))
            .Select(group => NewRow(
                day,
                group.Key.Area,
                group.Key.ScopeType,
                group.Key.ScopeKey,
                group.Key.Dims,
                hits: group.Count(),
                sessions: group.Select(hit => hit.SessionId).Distinct(StringComparer.Ordinal).Count(),
                itemSteps: group.Count(hit => hit.IsItemStep),
                bouncedSessions: 0,
                nowUtc))
            .ToList();

        // Area totals: a session counts once per area even when it viewed several scopes there.
        rows.AddRange(classified
            .GroupBy(hit => (hit.Area, hit.Dims))
            .Select(group => NewRow(
                day,
                group.Key.Area,
                ScopeAll,
                scopeKey: null,
                group.Key.Dims,
                hits: group.Count(),
                sessions: group.Select(hit => hit.SessionId).Distinct(StringComparer.Ordinal).Count(),
                itemSteps: group.Count(hit => hit.IsItemStep),
                bouncedSessions: 0,
                nowUtc)));

        // Session totals: each session counts once for the day.
        rows.AddRange(classified
            .GroupBy(hit => hit.SessionId, StringComparer.Ordinal)
            .GroupBy(session => session.First().Dims)
            .Select(group => NewRow(
                day,
                AreaAll,
                scopeType: null,
                scopeKey: null,
                group.Key,
                hits: group.Sum(session => session.Count()),
                sessions: group.Count(),
                itemSteps: group.Sum(session => session.Count(hit => hit.IsItemStep)),
                bouncedSessions: group.Count(session => session.Count() == 1),
                nowUtc)));

        return rows;
    }

    private static PageViewDailyRollup NewRow(
        DateOnly day,
        string area,
        string? scopeType,
        string? scopeKey,
        SessionDims dims,
        int hits,
        int sessions,
        int itemSteps,
        int bouncedSessions,
        DateTime nowUtc) =>
        new()
        {
            Id = Guid.NewGuid(),
            Day = day,
            Area = area,
            ScopeType = scopeType,
            ScopeKey = scopeKey,
            Channel = dims.Channel,
            DeviceClass = dims.DeviceClass,
            Country = dims.Country,
            Outcome = dims.Outcome,
            VisitorType = dims.VisitorType,
            Hits = hits,
            Sessions = sessions,
            ItemSteps = itemSteps,
            BouncedSessions = bouncedSessions,
            CreatedUtc = nowUtc
        };
}
