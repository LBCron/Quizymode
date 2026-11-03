using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;

namespace Quizymode.Api.Services.Taxonomy;

/// <summary>
/// Keeps the public item counts on <see cref="ITaxonomySearchIndex"/> fresh. Counts are reloaded lazily by the
/// first search after a 10-minute TTL lapses (no background service), and are PUBLIC-ONLY (<c>IsPrivate = false</c>),
/// so a topic's count never reveals private content. A failed refresh keeps the previous counts and retries after a minute.
/// </summary>
internal sealed class TaxonomySearchCounts(
    ITaxonomySearchIndex index,
    IMemoryCache cache,
    ILogger<TaxonomySearchCounts> logger)
{
    internal const string CacheKey = "taxonomy-search-counts";
    internal static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    internal static readonly TimeSpan FailureRetry = TimeSpan.FromMinutes(1);

    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task EnsureFreshAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        if (cache.TryGetValue(CacheKey, out _))
        {
            return;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (cache.TryGetValue(CacheKey, out _))
            {
                return;
            }

            try
            {
                index.ReplaceCounts(await LoadAsync(db, cancellationToken), DateTimeOffset.UtcNow);
                cache.Set(CacheKey, true, Ttl);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(exception, "Failed to refresh taxonomy search counts; keeping the previous counts.");
                cache.Set(CacheKey, true, FailureRetry);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task<Dictionary<(string Category, string? L1, string? L2), int>> LoadAsync(
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        var rows = await db.Items
            .AsNoTracking()
            .Where(ItemVisibility.PublicEligible)
            .Where(item => item.CategoryId != null)
            .GroupBy(item => new
            {
                Category = item.Category!.Name,
                L1 = item.NavigationKeyword1 != null ? item.NavigationKeyword1.Name : null,
                L2 = item.NavigationKeyword2 != null ? item.NavigationKeyword2.Name : null
            })
            .Select(group => new { group.Key.Category, group.Key.L1, group.Key.L2, Count = group.Count() })
            .ToListAsync(cancellationToken);

        Dictionary<(string Category, string? L1, string? L2), int> counts = new();
        foreach (var row in rows)
        {
            string category = CategoryHelper.NameToSlug(row.Category);
            string? l1 = row.L1?.ToLowerInvariant();
            string? l2 = row.L2?.ToLowerInvariant();

            Add(counts, (category, null, null), row.Count);
            if (l1 is not null)
            {
                Add(counts, (category, l1, null), row.Count);
                if (l2 is not null)
                {
                    Add(counts, (category, l1, l2), row.Count);
                }
            }
        }

        return counts;
    }

    private static void Add(Dictionary<(string Category, string? L1, string? L2), int> counts, (string, string?, string?) key, int amount)
    {
        counts[key] = counts.GetValueOrDefault(key) + amount;
    }
}
