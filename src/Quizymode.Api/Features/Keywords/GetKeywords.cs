using Dapper;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
using Microsoft.Extensions.Logging;

namespace Quizymode.Api.Features.Keywords;

/// <summary>
/// Feature for retrieving navigation keywords with aggregates.
/// Returns the next navigation layer based on current selection (category + selected keywords).
/// Rank 1 keywords are first-level navigation under a category.
/// Rank 2 keywords are children of a rank-1 keyword (via ParentName).
/// </summary>
public static class GetKeywords
{
    /// <summary>
    /// Request DTO for keyword navigation query.
    /// Category: Required category name.
    /// SelectedKeywords: List of currently selected keywords (for determining next navigation layer).
    /// </summary>
    public sealed record QueryRequest(
        string Category,
        List<string>? SelectedKeywords);

    /// <summary>
    /// Response DTO for a navigation keyword with aggregates.
    /// </summary>
    public sealed record KeywordResponse(
        string Name,
        int ItemCount,
        double? AverageRating,
        int NavigationRank,
        string? Description = null,
        int PrivateItemCount = 0);

    public sealed record Response(List<KeywordResponse> Keywords);

    // Intermediate class for Dapper mapping
    private sealed class KeywordRow
    {
        public string Name { get; set; } = string.Empty;
        public int ItemCount { get; set; }
        public double? AverageRating { get; set; }
        public int NavigationRank { get; set; }
        public int SortRank { get; set; }
        public string? Description { get; set; }
        public int PrivateItemCount { get; set; }
    }

    private sealed record NavigationKeywordDefinitionRow(
        Guid KeywordId,
        string Name,
        int NavigationRank,
        int SortRank,
        string? Description);

    private sealed record ItemNavigationMatchRow(Guid ItemId, Guid KeywordId);

    private sealed record RatingAggregateRow(Guid KeywordId, int Stars);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("keywords", Handler)
                .WithTags("Keywords")
                .WithSummary("Get navigation keywords with aggregates")
                .WithDescription("Returns the next navigation layer (rank-1 or rank-2 keywords) based on current selection. Includes item counts and average ratings.")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            string category,
            string? selectedKeywords,
            ApplicationDbContext db,
            IUserContext userContext,
            ILogger<Endpoint> logger,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(category))
            {
                return CustomResults.BadRequest("Category is required");
            }

            List<string>? keywordList = null;
            if (!string.IsNullOrEmpty(selectedKeywords))
            {
                keywordList = selectedKeywords.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(k => !string.IsNullOrWhiteSpace(k))
                    .ToList();
            }

            QueryRequest request = new(category.Trim(), keywordList);

            Result<Response> result = await HandleAsync(request, db, userContext, logger, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        IUserContext userContext,
        ILogger<Endpoint> logger,
        CancellationToken cancellationToken)
    {
        try
        {
            // Validate navigation path
            Result pathValidationResult = await NavigationPathValidator.ValidatePathAsync(
                request.Category,
                request.SelectedKeywords,
                db,
                userContext,
                cancellationToken);

            if (pathValidationResult.IsFailure)
            {
                return Result.Failure<Response>(pathValidationResult.Error!);
            }

            // Resolve category
            string categoryName = request.Category.Trim();
            Guid? categoryId = await ResolveCategoryIdAsync(categoryName, db, userContext, cancellationToken);

            if (!categoryId.HasValue)
            {
                return Result.Failure<Response>(
                    Error.NotFound("Keywords.CategoryNotFound", $"Category '{categoryName}' not found"));
            }

            // Determine navigation layer to return
            int? targetRank = await DetermineTargetRankAsync(request.SelectedKeywords, db, categoryId.Value, userContext, cancellationToken);
            
            if (!targetRank.HasValue)
            {
                // At leaf (e.g. rank-2 already selected): return item-level keywords for this path
                List<KeywordResponse> itemKeywords = await GetItemKeywordsAtPathAsync(
                    categoryId.Value,
                    request.SelectedKeywords,
                    db,
                    userContext,
                    cancellationToken);
                // Exclude item-level keywords that match the category name
                itemKeywords = itemKeywords
                    .Where(k => !string.Equals(k.Name, categoryName, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                Response leafResponse = new(itemKeywords);
                logger.LogInformation(
                    "Item keywords at leaf. Category: {Category}, SelectedKeywords: {SelectedKeywords}, KeywordCount: {KeywordCount}",
                    request.Category,
                    request.SelectedKeywords != null ? string.Join(",", request.SelectedKeywords) : "(none)",
                    itemKeywords.Count);
                return Result.Success(leafResponse);
            }

            // Get navigation keywords for the target rank
            List<KeywordResponse> keywords = await GetNavigationKeywordsAsync(
                categoryId.Value,
                targetRank.Value,
                request.SelectedKeywords,
                db,
                userContext,
                cancellationToken);

            // Exclude keywords whose name matches the category (e.g. "outdoors" in outdoors category)
            keywords = keywords
                .Where(k => !string.Equals(k.Name, categoryName, StringComparison.OrdinalIgnoreCase))
                .ToList();

            // Do not show "other" when it has 0 items (it may come from SQL with count 0; we only add it when > 0)
            keywords = keywords
                .Where(k => !string.Equals(k.Name, "other", StringComparison.OrdinalIgnoreCase) || k.ItemCount > 0)
                .ToList();

            // Add "other" keyword for rank-1 only when it has items (do not show "other" with 0 items)
            if (targetRank == 1)
            {
                int otherItemCount = await GetOtherItemCountAsync(
                    categoryId.Value,
                    db,
                    userContext,
                    cancellationToken);

                if (otherItemCount > 0)
                {
                    keywords.Insert(0, new KeywordResponse(
                        Name: "other",
                        ItemCount: otherItemCount,
                        AverageRating: null, // Could calculate if needed
                        NavigationRank: 1,
                        Description: null,
                        PrivateItemCount: 0));
                }
            }

            // Keywords are already ordered by relation sort order and keyword name
            Response response = new(keywords);
            int totalItemCount = keywords.Sum(k => k.ItemCount);

            logger.LogInformation(
                "Keywords retrieved. Category: {Category}, SelectedKeywords: {SelectedKeywords}, KeywordCount: {KeywordCount}, TotalItemCount: {TotalItemCount}",
                request.Category,
                request.SelectedKeywords != null ? string.Join(",", request.SelectedKeywords) : "(none)",
                keywords.Count,
                totalItemCount);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get keywords. Category: {Category}, UserId: {UserId}",
                request.Category, userContext.UserId);
            return Result.Failure<Response>(
                Error.Problem("Keywords.GetFailed", "Failed to get keywords."));
        }
    }

    /// <summary>
    /// Determines which navigation rank to return based on current selection.
    /// Returns 1 if no keywords selected (show rank-1), 2 if rank-1 selected (show rank-2), null if rank-2 selected.
    /// </summary>
    private static async Task<int?> DetermineTargetRankAsync(
        List<string>? selectedKeywords,
        ApplicationDbContext db,
        Guid categoryId,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        if (selectedKeywords is null || selectedKeywords.Count == 0)
        {
            return 1; // Show rank-1 keywords
        }

        List<string> normalizedKeywords = selectedKeywords
            .Select(k => k.Trim().ToLower())
            .ToList();

        IQueryable<KeywordRelation> rank1Query = db.KeywordRelations
            .Include(kr => kr.ChildKeyword)
            .Where(kr => kr.CategoryId == categoryId
                && kr.ParentKeywordId == null
                && normalizedKeywords.Contains(kr.ChildKeyword.Name.ToLower()));
        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            rank1Query = rank1Query.Where(kr => !kr.IsPrivate);
        else
            rank1Query = rank1Query.Where(kr => !kr.IsPrivate || kr.CreatedBy == userContext.UserId);
        bool hasRank1Keyword = await rank1Query.AnyAsync(cancellationToken);

        if (!hasRank1Keyword)
        {
            // Rank-2 or non-navigation keywords selected - no more navigation layers
            return null;
        }

        // If we have 2+ keywords, we're at leaf: either rank-2 selected or item-level filter (e.g. s3 under aws)
        if (normalizedKeywords.Count >= 2)
        {
            return null; // No more navigation layers; return item-level keywords for this path
        }

        return 2; // Show rank-2 keywords under the selected rank-1 parent
    }

    /// <summary>
    /// Gets navigation keywords for the specified rank with aggregates.
    /// </summary>
    private static async Task<List<KeywordResponse>> GetNavigationKeywordsAsync(
        Guid categoryId,
        int targetRank,
        List<string>? selectedKeywords,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        string? currentUserId = userContext.UserId;
        bool isAuthenticated = userContext.IsAuthenticated && !string.IsNullOrEmpty(currentUserId);
        string safeCurrentUserId = currentUserId ?? string.Empty;

        Guid? parentKeywordId = null;
        if (targetRank == 2 && selectedKeywords is not null && selectedKeywords.Count > 0)
        {
            List<string> normalizedSelected = selectedKeywords.Select(k => k.Trim().ToLower()).ToList();
            IQueryable<KeywordRelation> parentQuery = db.KeywordRelations
                .Include(kr => kr.ChildKeyword)
                .Where(kr => kr.CategoryId == categoryId && kr.ParentKeywordId == null && normalizedSelected.Contains(kr.ChildKeyword.Name.ToLower()));
            if (!isAuthenticated)
                parentQuery = parentQuery.Where(kr => !kr.IsPrivate);
            else
                parentQuery = parentQuery.Where(kr => !kr.IsPrivate || kr.CreatedBy == safeCurrentUserId);
            parentKeywordId = await parentQuery.Select(kr => kr.ChildKeywordId).FirstOrDefaultAsync(cancellationToken);
            if (parentKeywordId == default)
                parentKeywordId = null;
        }

        IQueryable<KeywordRelation> relationQuery = db.KeywordRelations
            .AsNoTracking()
            .Include(kr => kr.ChildKeyword)
            .Where(kr => kr.CategoryId == categoryId);

        relationQuery = targetRank == 1
            ? relationQuery.Where(kr => kr.ParentKeywordId == null)
            : relationQuery.Where(kr => kr.ParentKeywordId == parentKeywordId);

        if (!isAuthenticated)
        {
            relationQuery = relationQuery.Where(kr => !kr.IsPrivate && !kr.ChildKeyword.IsPrivate);
        }
        else
        {
            relationQuery = relationQuery.Where(kr =>
                (!kr.IsPrivate || kr.CreatedBy == safeCurrentUserId) &&
                (!kr.ChildKeyword.IsPrivate || kr.ChildKeyword.CreatedBy == safeCurrentUserId));
        }

        List<NavigationKeywordDefinitionRow> relations = await relationQuery
            .OrderBy(kr => kr.SortOrder)
            .ThenBy(kr => kr.ChildKeyword.Name)
            .Select(kr => new NavigationKeywordDefinitionRow(
                kr.ChildKeywordId,
                kr.ChildKeyword.Name,
                kr.ParentKeywordId == null ? 1 : 2,
                kr.SortOrder,
                kr.Description))
            .ToListAsync(cancellationToken);

        if (relations.Count == 0)
        {
            return [];
        }

        List<Guid> relationKeywordIds = relations
            .Select(row => row.KeywordId)
            .ToList();

        IQueryable<Item> visibleItems = db.Items
            .AsNoTracking()
            .Where(item => item.CategoryId == categoryId);

        if (!isAuthenticated)
        {
            visibleItems = visibleItems.Where(ItemVisibility.PublicEligible);
        }
        else
        {
            visibleItems = visibleItems.Where(ItemVisibility.VisibleTo(safeCurrentUserId));
        }

        IQueryable<Item> countedItems = targetRank == 1
            ? visibleItems.Where(item =>
                item.NavigationKeywordId1.HasValue &&
                relationKeywordIds.Contains(item.NavigationKeywordId1.Value))
            : visibleItems.Where(item =>
                item.NavigationKeywordId1 == parentKeywordId &&
                item.NavigationKeywordId2.HasValue &&
                relationKeywordIds.Contains(item.NavigationKeywordId2.Value));

        List<ItemNavigationMatchRow> itemMatches = await (targetRank == 1
                ? countedItems.Where(item => item.NavigationKeywordId1.HasValue)
                    .Select(item => new ItemNavigationMatchRow(item.Id, item.NavigationKeywordId1!.Value))
                : countedItems.Where(item => item.NavigationKeywordId2.HasValue)
                    .Select(item => new ItemNavigationMatchRow(item.Id, item.NavigationKeywordId2!.Value)))
            .ToListAsync(cancellationToken);

        Dictionary<Guid, int> itemCounts = itemMatches
            .GroupBy(row => row.KeywordId)
            .ToDictionary(group => group.Key, group => group.Count());

        Dictionary<Guid, int> privateItemCounts = [];
        if (isAuthenticated)
        {
            IQueryable<Item> privateItems = db.Items
                .AsNoTracking()
                .Where(item =>
                    item.CategoryId == categoryId &&
                    item.IsPrivate &&
                    item.CreatedBy == safeCurrentUserId);

            IQueryable<Item> countedPrivateItems = targetRank == 1
                ? privateItems.Where(item =>
                    item.NavigationKeywordId1.HasValue &&
                    relationKeywordIds.Contains(item.NavigationKeywordId1.Value))
                : privateItems.Where(item =>
                    item.NavigationKeywordId1 == parentKeywordId &&
                    item.NavigationKeywordId2.HasValue &&
                    relationKeywordIds.Contains(item.NavigationKeywordId2.Value));

            List<ItemNavigationMatchRow> privateMatches = await (targetRank == 1
                    ? countedPrivateItems.Where(item => item.NavigationKeywordId1.HasValue)
                        .Select(item => new ItemNavigationMatchRow(item.Id, item.NavigationKeywordId1!.Value))
                    : countedPrivateItems.Where(item => item.NavigationKeywordId2.HasValue)
                        .Select(item => new ItemNavigationMatchRow(item.Id, item.NavigationKeywordId2!.Value)))
                .ToListAsync(cancellationToken);

            privateItemCounts = privateMatches
                .GroupBy(row => row.KeywordId)
                .ToDictionary(group => group.Key, group => group.Count());
        }

        Dictionary<Guid, Guid> keywordByItemId = itemMatches.ToDictionary(row => row.ItemId, row => row.KeywordId);
        List<Guid> matchingItemIds = keywordByItemId.Keys.ToList();

        List<RatingAggregateRow> ratingRows = [];
        if (matchingItemIds.Count > 0)
        {
            List<(Guid ItemId, int Stars)> rawRatings = await db.Ratings
                .AsNoTracking()
                .Where(rating => matchingItemIds.Contains(rating.ItemId) && rating.Stars.HasValue)
                .Select(rating => new ValueTuple<Guid, int>(rating.ItemId, rating.Stars!.Value))
                .ToListAsync(cancellationToken);

            ratingRows = rawRatings
                .Where(rating => keywordByItemId.ContainsKey(rating.ItemId))
                .Select(rating => new RatingAggregateRow(keywordByItemId[rating.ItemId], rating.Stars))
                .ToList();
        }

        Dictionary<Guid, double?> averageRatings = ratingRows
            .GroupBy(row => row.KeywordId)
            .ToDictionary(
                group => group.Key,
                group => (double?)Math.Round(group.Average(row => row.Stars), 2));

        return relations
            .Select(relation => new KeywordResponse(
                relation.Name,
                itemCounts.GetValueOrDefault(relation.KeywordId),
                averageRatings.GetValueOrDefault(relation.KeywordId),
                relation.NavigationRank,
                relation.Description,
                privateItemCounts.GetValueOrDefault(relation.KeywordId)))
            .ToList();
    }

    /// <summary>
    /// Gets distinct item-level keywords that appear on items at the given path (category + selected keywords).
    /// Used at leaf of sets hierarchy to show boxes for filtering items by tag.
    /// </summary>
    private static async Task<List<KeywordResponse>> GetItemKeywordsAtPathAsync(
        Guid categoryId,
        List<string>? selectedKeywords,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        if (selectedKeywords is null || selectedKeywords.Count == 0)
        {
            return new List<KeywordResponse>();
        }

        List<string> normalizedPath = selectedKeywords
            .Select(k => k.Trim().ToLower())
            .ToList();

        // Resolve path keyword IDs
        List<Guid> pathKeywordIds = await db.Keywords
            .Where(k => normalizedPath.Contains(k.Name.ToLower())
                && (!k.IsPrivate || (userContext.IsAuthenticated && k.CreatedBy == userContext.UserId)))
            .Select(k => k.Id)
            .ToListAsync(cancellationToken);

        if (pathKeywordIds.Count != normalizedPath.Count)
        {
            return new List<KeywordResponse>();
        }

        // Item IDs in category with visibility: match by NavigationKeywordId1/2 when path length 1 or 2, else by ItemKeywords
        IQueryable<Item> itemsQuery = db.Items.Where(i => i.CategoryId == categoryId);
        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            itemsQuery = itemsQuery.Where(ItemVisibility.PublicEligible);
        else
            itemsQuery = itemsQuery.Where(ItemVisibility.VisibleTo(userContext.UserId));

        if (pathKeywordIds.Count == 1)
            itemsQuery = itemsQuery.Where(i => i.NavigationKeywordId1 == pathKeywordIds[0]);
        else if (pathKeywordIds.Count == 2)
            itemsQuery = itemsQuery.Where(i => i.NavigationKeywordId1 == pathKeywordIds[0] && i.NavigationKeywordId2 == pathKeywordIds[1]);
        else
        {
            foreach (Guid kid in pathKeywordIds)
            {
                Guid captured = kid;
                itemsQuery = itemsQuery.Where(i => i.ItemKeywords.Any(ik => ik.KeywordId == captured));
            }
        }

        List<Guid> matchingItemIds = await itemsQuery.Select(i => i.Id).ToListAsync(cancellationToken);
        if (matchingItemIds.Count == 0)
        {
            return new List<KeywordResponse>();
        }

        // Distinct keywords on those items (excluding path keywords), with item count and avg rating
        System.Data.Common.DbConnection connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await db.Database.OpenConnectionAsync(cancellationToken);
        }

        string sql = @"
            SELECT
                k.""Name"",
                COUNT(DISTINCT ik.""ItemId"")::int AS ""ItemCount"",
                CASE
                    WHEN COUNT(DISTINCT i.""Id"") > 0 THEN
                        ROUND(AVG(CASE WHEN r.""Stars"" IS NOT NULL THEN r.""Stars""::numeric END), 2)::double precision
                    ELSE NULL
                END AS ""AverageRating""
            FROM ""ItemKeywords"" ik
            INNER JOIN ""Keywords"" k ON k.""Id"" = ik.""KeywordId""
            INNER JOIN ""Items"" i ON i.""Id"" = ik.""ItemId""
            LEFT JOIN ""Ratings"" r ON r.""ItemId"" = i.""Id"" AND r.""Stars"" IS NOT NULL
            WHERE ik.""ItemId"" = ANY(@ItemIds)
                AND ik.""KeywordId"" != ALL(@PathKeywordIds)
                AND ((@IsAuthenticated = 0 AND k.""IsPrivate"" = false)
                     OR (@IsAuthenticated = 1 AND (k.""IsPrivate"" = false OR (k.""IsPrivate"" = true AND k.""CreatedBy"" = @CurrentUserId))))
            GROUP BY k.""Name""
            ORDER BY ""ItemCount"" DESC, k.""Name"" ASC";

        string? currentUserId = userContext.UserId ?? string.Empty;
        int isAuthenticatedInt = userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId) ? 1 : 0;

        var parameters = new DynamicParameters();
        parameters.Add("ItemIds", matchingItemIds.ToArray());
        parameters.Add("PathKeywordIds", pathKeywordIds.ToArray());
        parameters.Add("IsAuthenticated", isAuthenticatedInt);
        parameters.Add("CurrentUserId", currentUserId);

        List<KeywordRow> rows = (await connection.QueryAsync<KeywordRow>(
            new CommandDefinition(sql, parameters, cancellationToken: cancellationToken))).ToList();

        return rows.Select(row => new KeywordResponse(
            row.Name,
            row.ItemCount,
            row.AverageRating,
            NavigationRank: 0,
            Description: null)).ToList();
    }

    /// <summary>
    /// Gets count of items in category that have no rank-1 navigation keyword assigned.
    /// This is used for the special "other" keyword.
    /// </summary>
    private static async Task<int> GetOtherItemCountAsync(
        Guid categoryId,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        string? currentUserId = userContext.UserId;
        bool isAuthenticated = userContext.IsAuthenticated && !string.IsNullOrEmpty(currentUserId);

        List<Guid> rank1KeywordIds = await db.KeywordRelations
            .Where(kr => kr.CategoryId == categoryId && kr.ParentKeywordId == null)
            .Select(kr => kr.ChildKeywordId)
            .ToListAsync(cancellationToken);

        IQueryable<Item> query = db.Items.Where(i => i.CategoryId == categoryId);

        if (!isAuthenticated || string.IsNullOrEmpty(currentUserId))
            query = query.Where(ItemVisibility.PublicEligible);
        else
            query = query.Where(ItemVisibility.VisibleTo(currentUserId));

        if (rank1KeywordIds.Count > 0)
            query = query.Where(i => i.NavigationKeywordId1 == null || !rank1KeywordIds.Contains(i.NavigationKeywordId1.Value));

        return await query.CountAsync(cancellationToken);
    }

    /// <summary>
    /// Resolves category name to category ID, respecting visibility.
    /// </summary>
    private static async Task<Guid?> ResolveCategoryIdAsync(
        string categoryName,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        // Try global category first
        Category? globalCategory = await db.Categories
            .FirstOrDefaultAsync(c => !c.IsPrivate && c.Name.ToLower() == categoryName.ToLower(), cancellationToken);

        if (globalCategory is not null)
        {
            return globalCategory.Id;
        }

        // Try private category if authenticated
        if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
        {
            Category? privateCategory = await db.Categories
                .FirstOrDefaultAsync(c => c.IsPrivate
                    && c.CreatedBy == userContext.UserId
                    && c.Name.ToLower() == categoryName.ToLower(), cancellationToken);

            if (privateCategory is not null)
            {
                return privateCategory.Id;
            }
        }

        return null;
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services needed for this feature
        }
    }
}
