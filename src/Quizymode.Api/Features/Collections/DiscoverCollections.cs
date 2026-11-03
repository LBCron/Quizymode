using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Keywords;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Collections;

public static class DiscoverCollections
{
    public sealed record Response(List<CollectionDiscoverItem> Items, int TotalCount);

    public sealed record CollectionDiscoverItem(
        string Id,
        string Name,
        string? Description,
        string CreatedBy,
        DateTime CreatedAt,
        int ItemCount,
        bool IsBookmarked);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("collections/discover", Handler)
                .WithTags("Collections")
                .WithSummary("Search public collections that are listed in Discover")
                .WithDescription(
                    "Returns public, discoverable collections matching optional text (name/description), and/or items in the collection matching category, navigation keywords (L1/L2), and item tags.")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            string? q,
            string? category,
            string? keywords,
            string? tags,
            int? page,
            int? pageSize,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            int pageVal = Math.Clamp(page ?? 1, 1, 100);
            int pageSizeVal = Math.Clamp(pageSize ?? 20, 1, 50);

            Result<Response> result = await HandleAsync(
                q ?? "",
                category,
                keywords,
                tags,
                pageVal,
                pageSizeVal,
                db,
                userContext,
                cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        string query,
        string? category,
        string? keywords,
        string? tags,
        int page,
        int pageSize,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            List<string> navList = ParseCommaSeparated(keywords);
            List<string> tagList = ParseCommaSeparated(tags);

            if (navList.Count > 2)
            {
                return Result.Failure<Response>(
                    Error.Validation("Collections.Discover.InvalidKeywords", "At most two navigation keywords are allowed."));
            }

            if (navList.Count > 0 && string.IsNullOrWhiteSpace(category))
            {
                return Result.Failure<Response>(
                    Error.Validation("Collections.Discover.KeywordsRequireCategory", "Navigation keywords require a category."));
            }

            if (navList.Count > 0)
            {
                Result pathResult = await NavigationPathValidator.ValidatePathAsync(
                    category!.Trim(),
                    navList,
                    db,
                    userContext,
                    cancellationToken);

                if (pathResult.IsFailure)
                {
                    return Result.Failure<Response>(pathResult.Error!);
                }
            }

            bool hasTextQuery = !string.IsNullOrWhiteSpace(query);
            bool hasCategory = !string.IsNullOrWhiteSpace(category);
            bool hasNav = navList.Count > 0;
            bool hasTags = tagList.Count > 0;
            bool hasItemFilters = hasCategory || hasNav || hasTags;

            IQueryable<Item>? matchingItems = null;
            if (hasItemFilters)
            {
                Result<IQueryable<Item>> itemQueryResult = await BuildMatchingItemsQueryAsync(
                    db,
                    userContext,
                    category,
                    navList,
                    tagList,
                    cancellationToken);

                if (itemQueryResult.IsFailure)
                {
                    return Result.Failure<Response>(itemQueryResult.Error!);
                }

                matchingItems = itemQueryResult.Value;
            }

            // Discover lists only collections that are both link-public and opted into Discover (AC 1.9).
            var q = db.Collections
                .Where(c => c.IsPublic && c.IsDiscoverable)
                .AsQueryable();

            if (hasTextQuery)
            {
                string term = query.Trim().ToLower();
                q = q.Where(c => c.Name.ToLower().Contains(term) ||
                    (c.Description != null && c.Description.ToLower().Contains(term)));
            }

            if (matchingItems is not null)
            {
                q = q.Where(c => db.CollectionItems
                    .Any(ci => ci.CollectionId == c.Id && matchingItems.Select(i => i.Id).Contains(ci.ItemId)));
            }

            int totalCount = await q.CountAsync(cancellationToken);

            List<Guid> collectionIds = await q
                .OrderByDescending(c => c.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);

            if (collectionIds.Count == 0)
            {
                return Result.Success(new Response(new List<CollectionDiscoverItem>(), totalCount));
            }

            List<Collection> collections = await db.Collections
                .Where(c => collectionIds.Contains(c.Id))
                .OrderByDescending(c => c.CreatedAt)
                .ToListAsync(cancellationToken);

            var itemCounts = await ItemVisibility.EligibleCollectionItems(db, userContext.IsAuthenticated ? userContext.UserId : null)
                .Where(ci => collectionIds.Contains(ci.CollectionId))
                .GroupBy(ci => ci.CollectionId)
                .Select(g => new { CollectionId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken);

            var countMap = itemCounts.ToDictionary(x => x.CollectionId, x => x.Count);

            HashSet<Guid>? bookmarkedIds = null;
            if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
            {
                bookmarkedIds = (await db.CollectionBookmarks
                    .Where(b => b.UserId == userContext.UserId && collectionIds.Contains(b.CollectionId))
                    .Select(b => b.CollectionId)
                    .ToListAsync(cancellationToken))
                    .ToHashSet();
            }

            var items = collections
                .OrderByDescending(c => c.CreatedAt)
                .Select(c => new CollectionDiscoverItem(
                    c.Id.ToString(),
                    c.Name,
                    c.Description,
                    c.CreatedBy,
                    c.CreatedAt,
                    countMap.GetValueOrDefault(c.Id, 0),
                    bookmarkedIds?.Contains(c.Id) ?? false))
                .ToList();

            return Result.Success(new Response(items, totalCount));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Collections.DiscoverFailed", "Failed to discover collections.", ex));
        }
    }

    private static List<string> ParseCommaSeparated(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return new List<string>();
        }

        return value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Select(k => k.Trim())
            .ToList();
    }

    private static async Task<Result<IQueryable<Item>>> BuildMatchingItemsQueryAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        string? category,
        List<string> navList,
        List<string> tagList,
        CancellationToken cancellationToken)
    {
        IQueryable<Item> query = db.Items.Where(ItemVisibility.MediaEligible);

        Guid? categoryId = null;
        if (!string.IsNullOrWhiteSpace(category))
        {
            categoryId = await ResolveCategoryIdAsync(category.Trim(), db, userContext, cancellationToken);
            if (!categoryId.HasValue)
            {
                query = query.Where(i => false);
                return Result.Success(query);
            }

            query = query.Where(i => i.CategoryId == categoryId.Value);
        }

        if (navList.Count > 0)
        {
            Result<List<Guid>> navIdsResult = await ResolveNavigationKeywordIdsAsync(db, userContext, navList, cancellationToken);
            if (navIdsResult.IsFailure)
            {
                return Result.Failure<IQueryable<Item>>(navIdsResult.Error!);
            }

            List<Guid> navIds = navIdsResult.Value;
            if (navIds.Count != navList.Count)
            {
                query = query.Where(i => false);
            }
            else if (navIds.Count == 1)
            {
                Guid id1 = navIds[0];
                query = query.Where(i => i.NavigationKeywordId1 == id1);
            }
            else if (navIds.Count == 2)
            {
                Guid id1 = navIds[0];
                Guid id2 = navIds[1];
                query = query.Where(i => i.NavigationKeywordId1 == id1 && i.NavigationKeywordId2 == id2);
            }
        }

        if (tagList.Count > 0)
        {
            Result<List<Guid>> tagIdsResult = await ResolveEffectiveKeywordIdsForTagsAsync(db, userContext, tagList, cancellationToken);
            if (tagIdsResult.IsFailure)
            {
                return Result.Failure<IQueryable<Item>>(tagIdsResult.Error!);
            }

            List<Guid> tagIds = tagIdsResult.Value;
            if (tagIds.Count == 0)
            {
                query = query.Where(i => false);
            }
            else
            {
                foreach (Guid keywordId in tagIds.Distinct())
                {
                    Guid captured = keywordId;
                    query = query.Where(i => i.ItemKeywords.Any(ik => ik.KeywordId == captured));
                }
            }
        }

        return Result.Success(query);
    }

    private static async Task<Guid?> ResolveCategoryIdAsync(
        string categoryName,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        Category? globalCategory = await db.Categories
            .FirstOrDefaultAsync(c => !c.IsPrivate && c.Name.ToLower() == categoryName.ToLower(), cancellationToken);
        if (globalCategory is not null)
        {
            return globalCategory.Id;
        }

        if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
        {
            Category? privateCategory = await db.Categories
                .FirstOrDefaultAsync(
                    c => c.IsPrivate && c.CreatedBy == userContext.UserId && c.Name.ToLower() == categoryName.ToLower(),
                    cancellationToken);
            if (privateCategory is not null)
            {
                return privateCategory.Id;
            }
        }

        string requestedSlug = CategoryHelper.NameToSlug(categoryName);
        if (string.IsNullOrEmpty(requestedSlug))
        {
            return null;
        }

        List<Category> allForSlug = await db.Categories
            .Where(c => !c.IsPrivate || (userContext.IsAuthenticated && c.CreatedBy == userContext.UserId))
            .ToListAsync(cancellationToken);

        Category? bySlug = allForSlug
            .FirstOrDefault(c => string.Equals(CategoryHelper.NameToSlug(c.Name), requestedSlug, StringComparison.OrdinalIgnoreCase));
        return bySlug?.Id;
    }

    private static async Task<Result<List<Guid>>> ResolveNavigationKeywordIdsAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        List<string> navNames,
        CancellationToken cancellationToken)
    {
        IQueryable<Keyword> keywordQuery = db.Keywords.AsQueryable();
        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate);
        }
        else
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate || (k.IsPrivate && k.CreatedBy == userContext.UserId));
        }

        List<string> normalized = navNames
            .Select(k => k.Trim().ToLower())
            .Where(k => !string.IsNullOrEmpty(k))
            .ToList();

        List<Keyword> candidates = await keywordQuery
            .Where(k => normalized.Contains(k.Name.ToLower()))
            .ToListAsync(cancellationToken);

        var ids = new List<Guid>();
        foreach (string nameLower in normalized)
        {
            List<Keyword> matchesForName = candidates
                .Where(k => k.Name.Equals(nameLower, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (matchesForName.Count == 0)
            {
                return Result.Success(new List<Guid>());
            }

            Keyword? publicMatch = matchesForName.FirstOrDefault(k => !k.IsPrivate);
            Keyword chosen = publicMatch ?? matchesForName[0];
            ids.Add(chosen.Id);
        }

        return Result.Success(ids);
    }

    /// <summary>
    /// Resolves tag names to keyword IDs (public wins). Empty list if any name is unknown — caller treats as no matches.
    /// </summary>
    private static async Task<Result<List<Guid>>> ResolveEffectiveKeywordIdsForTagsAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        List<string> tagNames,
        CancellationToken cancellationToken)
    {
        IQueryable<Keyword> keywordQuery = db.Keywords.AsQueryable();
        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate);
        }
        else
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate || (k.IsPrivate && k.CreatedBy == userContext.UserId));
        }

        List<string> normalized = tagNames
            .Select(k => k.Trim().ToLower())
            .Where(k => !string.IsNullOrEmpty(k))
            .ToList();

        if (normalized.Count == 0)
        {
            return Result.Success(new List<Guid>());
        }

        List<Keyword> candidates = await keywordQuery
            .Where(k => normalized.Contains(k.Name.ToLower()))
            .ToListAsync(cancellationToken);

        var effectiveIds = new List<Guid>();
        foreach (string nameLower in normalized)
        {
            List<Keyword> matchesForName = candidates
                .Where(k => k.Name.Equals(nameLower, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (matchesForName.Count == 0)
            {
                return Result.Success(new List<Guid>());
            }

            Keyword? publicMatch = matchesForName.FirstOrDefault(k => !k.IsPrivate);
            Keyword chosen = publicMatch ?? matchesForName[0];
            effectiveIds.Add(chosen.Id);
        }

        return Result.Success(effectiveIds);
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services
        }
    }
}
