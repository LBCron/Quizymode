using Quizymode.Api.Shared.Helpers;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Featured;

public static class GetFeatured
{
    public sealed record FeaturedSetDto(
        Guid Id,
        string DisplayName,
        string CategorySlug,
        string? NavKeyword1,
        string? NavKeyword2,
        int ItemCount,
        DateTime? LastModifiedAt,
        int SortOrder);

    public sealed record FeaturedCollectionDto(
        Guid Id,
        Guid? CollectionId,
        string DisplayName,
        string? Description,
        int ItemCount,
        DateTime? LastModifiedAt,
        int SortOrder);

    public sealed record Response(
        List<FeaturedSetDto> Sets,
        List<FeaturedCollectionDto> Collections);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("featured", Handler)
                .WithTags("Featured")
                .WithSummary("Get featured sets and collections")
                .Produces<Response>(StatusCodes.Status200OK);
        }

        private static async Task<IResult> Handler(
            ApplicationDbContext db,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(db, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        try
        {
            List<FeaturedItem> items = await db.FeaturedItems
                .AsNoTracking()
                .Include(f => f.Collection)
                .OrderBy(f => f.SortOrder)
                .ThenBy(f => f.DisplayName)
                .ToListAsync(cancellationToken);

            List<FeaturedItem> setItems = items.Where(f => f.Type == FeaturedItemType.Set).ToList();
            List<FeaturedItem> collectionItems = items.Where(f => f.Type == FeaturedItemType.Collection).ToList();

            // Resolve category IDs by slug (case-insensitive name match) for sets
            List<string> categorySlugs = setItems
                .Where(f => f.CategorySlug is not null)
                .Select(f => f.CategorySlug!.ToLower())
                .Distinct()
                .ToList();

            Dictionary<string, Guid> categoryIdBySlug = await db.Categories
                .AsNoTracking()
                .Where(c => !c.IsPrivate && categorySlugs.Contains(c.Name.ToLower()))
                .ToDictionaryAsync(c => c.Name.ToLower(), c => c.Id, cancellationToken);

            // Resolve keyword IDs for set nav keywords
            List<string> allKeywordNames = setItems
                .SelectMany(f => new[] { f.NavKeyword1, f.NavKeyword2 })
                .Where(n => n is not null)
                .Select(n => n!.ToLower())
                .Distinct()
                .ToList();

            List<Keyword> matchedKeywords = await db.Keywords
                .AsNoTracking()
                .Where(k => !k.IsPrivate && allKeywordNames.Contains(k.Name.ToLower()))
                .ToListAsync(cancellationToken);

            Dictionary<string, Guid> keywordIdByName = matchedKeywords
                .GroupBy(k => k.Name.ToLower())
                .ToDictionary(g => g.Key, g => g.First().Id);

            // Build set DTOs with lastModifiedAt
            List<FeaturedSetDto> sets = [];
            foreach (FeaturedItem fi in setItems)
            {
                if (fi.CategorySlug is null) continue;

                string catKey = fi.CategorySlug.ToLower();
                if (!categoryIdBySlug.TryGetValue(catKey, out Guid categoryId))
                {
                    sets.Add(new FeaturedSetDto(fi.Id, fi.DisplayName, fi.CategorySlug, fi.NavKeyword1, fi.NavKeyword2, 0, null, fi.SortOrder));
                    continue;
                }

                IQueryable<Item> query = db.Items
                    .AsNoTracking()
                    .Where(ItemVisibility.PublicEligible)
                    .Where(i => i.CategoryId == categoryId);

                if (fi.NavKeyword1 is not null && keywordIdByName.TryGetValue(fi.NavKeyword1.ToLower(), out Guid kw1Id))
                {
                    query = query.Where(i => i.NavigationKeywordId1 == kw1Id);
                }

                if (fi.NavKeyword2 is not null && keywordIdByName.TryGetValue(fi.NavKeyword2.ToLower(), out Guid kw2Id))
                {
                    query = query.Where(i => i.NavigationKeywordId2 == kw2Id);
                }

                var stats = await query
                    .GroupBy(_ => 1)
                    .Select(g => new { Count = g.Count(), LastMod = g.Max(i => (DateTime?)(i.UpdatedAt ?? i.CreatedAt)) })
                    .SingleOrDefaultAsync(cancellationToken); // one group (GroupBy constant), so Single is safe (#490)

                sets.Add(new FeaturedSetDto(fi.Id, fi.DisplayName, fi.CategorySlug, fi.NavKeyword1, fi.NavKeyword2, stats?.Count ?? 0, stats?.LastMod, fi.SortOrder));
            }

            // Build collection DTOs with lastModifiedAt
            List<FeaturedCollectionDto> collections = [];
            foreach (FeaturedItem fi in collectionItems)
            {
                if (fi.CollectionId is null)
                {
                    collections.Add(new FeaturedCollectionDto(fi.Id, null, fi.DisplayName, null, 0, null, fi.SortOrder));
                    continue;
                }

                DateTime? lastMod = await db.CollectionItems
                    .AsNoTracking()
                    .Where(ci => ci.CollectionId == fi.CollectionId.Value)
                    .Join(db.Items.AsNoTracking().Where(ItemVisibility.MediaEligible), ci => ci.ItemId, i => i.Id, (_, i) => (DateTime?)(i.UpdatedAt ?? i.CreatedAt))
                    .MaxAsync(cancellationToken);

                int itemCount = await ItemVisibility.EligibleCollectionItems(db, null)
                    .AsNoTracking()
                    .CountAsync(ci => ci.CollectionId == fi.CollectionId.Value, cancellationToken);

                string displayName = fi.DisplayName.Length > 0 ? fi.DisplayName : (fi.Collection?.Name ?? string.Empty);
                string? description = fi.Collection?.Description;

                collections.Add(new FeaturedCollectionDto(fi.Id, fi.CollectionId, displayName, description, itemCount, lastMod, fi.SortOrder));
            }

            return Result.Success(new Response(sets, collections));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Featured.GetFailed", "Failed to retrieve featured items.", ex));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
        }
    }
}
