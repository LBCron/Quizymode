using Quizymode.Api.Features;
using Quizymode.Api.Data;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Taxonomy;
using Quizymode.Api.Shared.Models;
using Microsoft.EntityFrameworkCore;

namespace Quizymode.Api.Features.Taxonomy;

public static class GetTaxonomy
{
    public sealed record L2Dto(string Slug, string? Description, int ItemCount);

    public sealed record L1Dto(string Slug, string? Description, int ItemCount, IReadOnlyList<L2Dto> Keywords);

    public sealed record CategoryDto(
        string Slug,
        string Name,
        string? Description,
        int ItemCount,
        IReadOnlyList<L1Dto> Groups,
        IReadOnlyList<string> AllKeywordSlugs);

    public sealed record Response(IReadOnlyList<CategoryDto> Categories);

    private sealed record VisibleCategoryRow(
        Guid Id,
        string Name,
        string? Description,
        string? ShortDescription,
        bool IsPrivate);

    private sealed record CategoryCountRow(Guid CategoryId, int ItemCount);

    private sealed record Rank1NavigationKeywordCountRow(Guid CategoryId, string Rank1Slug, int ItemCount);

    private sealed record Rank2NavigationKeywordCountRow(Guid CategoryId, string Rank1Slug, string Rank2Slug, int ItemCount);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("taxonomy", Handler)
                .WithTags("Taxonomy")
                .WithSummary("Get category and keyword taxonomy (from YAML, in-memory)")
                .Produces<Response>(StatusCodes.Status200OK);
        }

        private static async Task<IResult> Handler(
            ITaxonomyRegistry registry,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            Response response = await BuildResponseAsync(registry, db, userContext, cancellationToken);
            return Results.Ok(response);
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
        }
    }

    internal static async Task<Response> BuildResponseAsync(
        ITaxonomyRegistry registry,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        string? currentUserId = userContext.UserId;
        bool isAuthenticated = userContext.IsAuthenticated && !string.IsNullOrEmpty(currentUserId);

        IQueryable<Category> visibleCategoryEntities = db.Categories.AsNoTracking();

        if (!isAuthenticated || string.IsNullOrEmpty(currentUserId))
        {
            visibleCategoryEntities = visibleCategoryEntities.Where(category => !category.IsPrivate);
        }
        else
        {
            string safeCurrentUserId = currentUserId;
            visibleCategoryEntities = visibleCategoryEntities
                .Where(category => !category.IsPrivate || category.CreatedBy == safeCurrentUserId);
        }

        IQueryable<VisibleCategoryRow> visibleCategoriesQuery = visibleCategoryEntities
            .Select(category => new VisibleCategoryRow(
                category.Id,
                category.Name,
                category.Description,
                category.ShortDescription,
                category.IsPrivate));

        List<VisibleCategoryRow> visibleCategories = await visibleCategoriesQuery.ToListAsync(cancellationToken);
        List<Guid> visibleCategoryIds = visibleCategories.Select(category => category.Id).ToList();

        Dictionary<string, VisibleCategoryRow> categoriesBySlug = visibleCategories
            .OrderBy(category => category.IsPrivate ? 1 : 0)
            .GroupBy(category => CategoryHelper.NameToSlug(category.Name), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        Dictionary<Guid, int> itemCountsByCategoryId = await BuildCategoryCountsAsync(
            db,
            visibleCategoryIds,
            userContext,
            cancellationToken);

        Dictionary<string, int> itemCountsByNavigationKey = await BuildNavigationKeywordCountsAsync(
            db,
            visibleCategoryIds,
            userContext,
            cancellationToken);

        List<CategoryDto> categories = [];
        foreach (string slug in registry.CategorySlugs)
        {
            TaxonomyCategoryDefinition? definition = registry.GetCategory(slug);
            if (definition is null)
            {
                continue;
            }

            categoriesBySlug.TryGetValue(definition.Slug, out VisibleCategoryRow? visibleCategory);
            int categoryItemCount = visibleCategory is not null &&
                                    itemCountsByCategoryId.TryGetValue(visibleCategory.Id, out int count)
                ? count
                : 0;

            List<L1Dto> groups = definition.L1Groups
                .Select(group => new L1Dto(
                    group.Slug,
                    group.Description,
                    visibleCategory is null
                        ? 0
                        : GetRank1NavigationKeywordCount(itemCountsByNavigationKey, visibleCategory.Id, group.Slug),
                    group.L2Leaves
                        .Select(leaf => new L2Dto(
                            leaf.Slug,
                            leaf.Description,
                            visibleCategory is null
                                ? 0
                                : GetRank2NavigationKeywordCount(
                                    itemCountsByNavigationKey,
                                    visibleCategory.Id,
                                    group.Slug,
                                    leaf.Slug)))
                        .ToList()))
                .ToList();

            categories.Add(new CategoryDto(
                definition.Slug,
                visibleCategory?.Name ?? FormatFallbackLabel(definition.Slug),
                visibleCategory?.Description ?? visibleCategory?.ShortDescription ?? definition.Description,
                categoryItemCount,
                groups,
                definition.AllKeywordSlugs.OrderBy(value => value, StringComparer.Ordinal).ToList()));
        }

        return new Response(categories);
    }

    private static async Task<Dictionary<Guid, int>> BuildCategoryCountsAsync(
        ApplicationDbContext db,
        IReadOnlyCollection<Guid> categoryIds,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        if (categoryIds.Count == 0)
        {
            return new Dictionary<Guid, int>();
        }

        IQueryable<Item> query = db.Items
            .AsNoTracking()
            .Where(item => item.CategoryId.HasValue && categoryIds.Contains(item.CategoryId.Value));

        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
        {
            query = query.Where(ItemVisibility.PublicEligible);
        }
        else
        {
            query = query.Where(ItemVisibility.VisibleTo(userContext.UserId));
        }

        return await query
            .GroupBy(item => item.CategoryId!.Value)
            .Select(group => new CategoryCountRow(group.Key, group.Count()))
            .ToDictionaryAsync(row => row.CategoryId, row => row.ItemCount, cancellationToken);
    }

    private static async Task<Dictionary<string, int>> BuildNavigationKeywordCountsAsync(
        ApplicationDbContext db,
        IReadOnlyCollection<Guid> categoryIds,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        if (categoryIds.Count == 0)
        {
            return new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        }

        IQueryable<Item> visibleItems = db.Items
            .AsNoTracking()
            .Where(item => item.CategoryId.HasValue && categoryIds.Contains(item.CategoryId.Value));

        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
        {
            visibleItems = visibleItems.Where(ItemVisibility.PublicEligible);
        }
        else
        {
            visibleItems = visibleItems.Where(ItemVisibility.VisibleTo(userContext.UserId));
        }

        List<Rank1NavigationKeywordCountRow> nav1Counts = await visibleItems
            .Where(item => item.NavigationKeywordId1.HasValue && item.NavigationKeyword1 != null)
            .GroupBy(item => new
            {
                CategoryId = item.CategoryId!.Value,
                Rank1Slug = item.NavigationKeyword1!.Name.ToLower()
            })
            .Select(group => new Rank1NavigationKeywordCountRow(
                group.Key.CategoryId,
                group.Key.Rank1Slug,
                group.Count()))
            .ToListAsync(cancellationToken);

        List<Rank2NavigationKeywordCountRow> nav2Counts = await visibleItems
            .Where(item => item.NavigationKeywordId1.HasValue
                && item.NavigationKeyword1 != null
                && item.NavigationKeywordId2.HasValue
                && item.NavigationKeyword2 != null)
            .GroupBy(item => new
            {
                CategoryId = item.CategoryId!.Value,
                Rank1Slug = item.NavigationKeyword1!.Name.ToLower(),
                Rank2Slug = item.NavigationKeyword2!.Name.ToLower()
            })
            .Select(group => new Rank2NavigationKeywordCountRow(
                group.Key.CategoryId,
                group.Key.Rank1Slug,
                group.Key.Rank2Slug,
                group.Count()))
            .ToListAsync(cancellationToken);

        Dictionary<string, int> counts = new(StringComparer.OrdinalIgnoreCase);
        foreach (Rank1NavigationKeywordCountRow row in nav1Counts)
        {
            counts[BuildRank1NavigationCountKey(row.CategoryId, row.Rank1Slug)] = row.ItemCount;
        }

        foreach (Rank2NavigationKeywordCountRow row in nav2Counts)
        {
            counts[BuildRank2NavigationCountKey(row.CategoryId, row.Rank1Slug, row.Rank2Slug)] = row.ItemCount;
        }

        return counts;
    }

    private static int GetRank1NavigationKeywordCount(
        IReadOnlyDictionary<string, int> counts,
        Guid categoryId,
        string rank1Slug)
    {
        return counts.TryGetValue(BuildRank1NavigationCountKey(categoryId, rank1Slug), out int count)
            ? count
            : 0;
    }

    private static int GetRank2NavigationKeywordCount(
        IReadOnlyDictionary<string, int> counts,
        Guid categoryId,
        string rank1Slug,
        string rank2Slug)
    {
        return counts.TryGetValue(BuildRank2NavigationCountKey(categoryId, rank1Slug, rank2Slug), out int count)
            ? count
            : 0;
    }

    private static string BuildRank1NavigationCountKey(Guid categoryId, string rank1Slug)
    {
        return $"{categoryId:N}|r1|{rank1Slug}".ToLowerInvariant();
    }

    private static string BuildRank2NavigationCountKey(Guid categoryId, string rank1Slug, string rank2Slug)
    {
        return $"{categoryId:N}|r2|{rank1Slug}|{rank2Slug}".ToLowerInvariant();
    }

    private static string FormatFallbackLabel(string slug)
    {
        string[] segments = slug
            .Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        List<string> words = [];
        foreach (string segment in segments)
        {
            if (segment.All(char.IsUpper))
            {
                words.Add(segment);
                continue;
            }

            if (segment.Length > 1 &&
                segment.TakeWhile(char.IsLetter).Count() >= 2 &&
                segment.Any(char.IsDigit))
            {
                words.Add(segment.ToUpperInvariant());
                continue;
            }

            words.Add(char.ToUpperInvariant(segment[0]) + segment[1..]);
        }

        return words.Count > 0 ? string.Join(" ", words) : slug;
    }
}
