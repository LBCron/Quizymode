using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Get;

/// <summary>
/// Builder class responsible for constructing EF Core queries for items based on filter criteria.
/// Applies filters in a specific order: visibility, category, keywords, collection.
/// Each filter method returns a Result to allow for proper error handling and early termination.
/// </summary>
internal sealed class ItemQueryBuilder
{
    private readonly ApplicationDbContext _db;
    private readonly IUserContext _userContext;
    private readonly CancellationToken _cancellationToken;

    public ItemQueryBuilder(
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        _db = db;
        _userContext = userContext;
        _cancellationToken = cancellationToken;
    }

    /// <summary>
    /// Main method that builds the complete query by applying all requested filters in sequence.
    /// Filters are applied in dependency order: visibility first (fundamental security),
    /// then category, keywords, and finally collection (which depends on visibility).
    /// Returns Result pattern to handle validation errors gracefully.
    /// </summary>
    public async Task<Result<IQueryable<Item>>> BuildQueryAsync(GetItems.QueryRequest request)
    {
        if (request.NavigationKeywords is not null && request.NavigationKeywords.Count > 2)
        {
            return Result.Failure<IQueryable<Item>>(
                Error.Validation("Navigation.InvalidPath", "Navigation path supports at most two keywords."));
        }

        if (!string.IsNullOrEmpty(request.Category) && request.NavigationKeywords is not null
            && request.NavigationKeywords.Count > 0)
        {
            Result pathValidationResult = await Quizymode.Api.Features.Keywords.NavigationPathValidator.ValidatePathAsync(
                request.Category,
                request.NavigationKeywords,
                _db,
                _userContext,
                _cancellationToken);

            if (pathValidationResult.IsFailure)
            {
                return Result.Failure<IQueryable<Item>>(pathValidationResult.Error!);
            }
        }

        IQueryable<Item> query = _db.Items.AsQueryable();

        // When loading by collectionId, allow only if collection is public or user is owner/shared; then bypass item visibility so all items in collection are visible.
        // Media eligibility still applies: items with unapproved uploaded pictures show only to their creator (#400).
        bool skipVisibilityForCollection = request.CollectionId.HasValue;
        if (skipVisibilityForCollection)
        {
            query = query.Where(ItemVisibility.EligibleFor(_userContext.IsAuthenticated ? _userContext.UserId : null));
        }

        if (!skipVisibilityForCollection)
        {
            Result<IQueryable<Item>> visibilityResult = ApplyVisibilityFilter(query, request);
            if (visibilityResult.IsFailure)
            {
                return visibilityResult;
            }
            query = visibilityResult.Value;
        }

        Result<IQueryable<Item>> categoryResult = await ApplyCategoryFilterAsync(query, request);
        if (categoryResult.IsFailure)
        {
            return categoryResult;
        }
        query = categoryResult.Value;

        Result<IQueryable<Item>> navigationResult = await ApplyNavigationFilterAsync(query, request);
        if (navigationResult.IsFailure)
        {
            return navigationResult;
        }
        query = navigationResult.Value;

        Result<IQueryable<Item>> keywordResult = await ApplyKeywordFilterAsync(query, request);
        if (keywordResult.IsFailure)
        {
            return keywordResult;
        }
        query = keywordResult.Value;

        Result<IQueryable<Item>> collectionResult = await ApplyCollectionFilterAsync(query, request);
        if (collectionResult.IsFailure)
        {
            return collectionResult;
        }
        query = collectionResult.Value;

        return Result.Success(query);
    }

    /// <summary>
    /// Applies visibility filtering to the query based on IsPrivate parameter and user authentication status.
    /// Visibility rules:
    /// - If IsPrivate=true: user must be authenticated and only sees their own private items
    /// - If IsPrivate=false: only global (non-private) items are returned
    /// Public items whose uploaded pictures are not Approved are excluded for everyone but their creator (#400).
    /// - If IsPrivate=null (all items):
    ///   - Anonymous users: only global items
    ///   - Authenticated users: global items + their own private items
    /// This ensures users can only see items they have permission to view.
    /// </summary>
    private Result<IQueryable<Item>> ApplyVisibilityFilter(IQueryable<Item> query, GetItems.QueryRequest request)
    {
        if (request.IsPrivate.HasValue)
        {
            if (request.IsPrivate.Value)
            {
                if (!_userContext.IsAuthenticated || string.IsNullOrEmpty(_userContext.UserId))
                {
                    return Result.Failure<IQueryable<Item>>(
                        Error.Validation("Items.Unauthorized", "Must be authenticated to view private items"));
                }
                query = query.Where(i => i.IsPrivate && i.CreatedBy == _userContext.UserId);
            }
            else
            {
                query = query.Where(ItemVisibility.PublicEligible);
            }
        }
        else
        {
            if (!_userContext.IsAuthenticated)
            {
                query = query.Where(ItemVisibility.PublicEligible);
            }
            else if (!string.IsNullOrEmpty(_userContext.UserId))
            {
                query = query.Where(ItemVisibility.VisibleTo(_userContext.UserId));
            }
        }

        return Result.Success(query);
    }

    /// <summary>
    /// Applies category filtering to the query. Resolves category name to category ID,
    /// supporting both global and private categories (if user is authenticated).
    /// If category is not found, returns empty result set rather than erroring.
    /// </summary>
    private async Task<Result<IQueryable<Item>>> ApplyCategoryFilterAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        if (string.IsNullOrEmpty(request.Category))
        {
            return Result.Success(query);
        }

        string categoryName = request.Category.Trim();
        Guid? categoryId = await ResolveCategoryIdAsync(categoryName);

        if (categoryId.HasValue)
        {
            query = query.Where(i => i.CategoryId == categoryId.Value);
        }
        else
        {
            query = query.Where(i => false);
        }

        return Result.Success(query);
    }

    /// <summary>
    /// Resolves a category name to its ID, checking both global and user's private categories.
    /// First checks global categories, then if user is authenticated, checks their private categories.
    /// Uses case-insensitive comparison. Handles NotSupportedException for databases that don't support
    /// ToLower() in queries by loading categories into memory and comparing there.
    /// Returns null if category is not found.
    /// </summary>
    private async Task<Guid?> ResolveCategoryIdAsync(string categoryName)
    {
        try
        {
            Category? globalCategory = await _db.Categories
                .FirstOrDefaultAsync(
                    c => !c.IsPrivate && c.Name.ToLower() == categoryName.ToLower(),
                    _cancellationToken);

            if (globalCategory is not null)
            {
                return globalCategory.Id;
            }

            if (_userContext.IsAuthenticated && !string.IsNullOrEmpty(_userContext.UserId))
            {
                Category? privateCategory = await _db.Categories
                    .FirstOrDefaultAsync(
                        c => c.IsPrivate && c.CreatedBy == _userContext.UserId && c.Name.ToLower() == categoryName.ToLower(),
                        _cancellationToken);

                if (privateCategory is not null)
                {
                    return privateCategory.Id;
                }
            }
        }
        catch (NotSupportedException)
        {
            List<Category> allCategories = await _db.Categories
                .Where(c => !c.IsPrivate)
                .ToListAsync(_cancellationToken);

            Category? globalCategory = allCategories
                .FirstOrDefault(c => string.Equals(c.Name, categoryName, StringComparison.OrdinalIgnoreCase));

            if (globalCategory is not null)
            {
                return globalCategory.Id;
            }

            if (_userContext.IsAuthenticated && !string.IsNullOrEmpty(_userContext.UserId))
            {
                List<Category> privateCategories = await _db.Categories
                    .Where(c => c.IsPrivate && c.CreatedBy == _userContext.UserId)
                    .ToListAsync(_cancellationToken);

                Category? privateCategory = privateCategories
                    .FirstOrDefault(c => string.Equals(c.Name, categoryName, StringComparison.OrdinalIgnoreCase));

                if (privateCategory is not null)
                {
                    return privateCategory.Id;
                }
            }
        }

        // Fallback: resolve by slug (e.g. URL "certs" -> category "Certs")
        string requestedSlug = CategoryHelper.NameToSlug(categoryName);
        if (string.IsNullOrEmpty(requestedSlug))
            return null;

        List<Category> allForSlug = await _db.Categories
            .Where(c => !c.IsPrivate || (_userContext.IsAuthenticated && c.CreatedBy == _userContext.UserId))
            .ToListAsync(_cancellationToken);

        Category? bySlug = allForSlug
            .FirstOrDefault(c => string.Equals(CategoryHelper.NameToSlug(c.Name), requestedSlug, StringComparison.OrdinalIgnoreCase));

        return bySlug?.Id;
    }

    private async Task<Result<IQueryable<Item>>> ApplyNavigationFilterAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        if (request.NavigationKeywords is null || request.NavigationKeywords.Count == 0)
        {
            return Result.Success(query);
        }

        if (string.IsNullOrWhiteSpace(request.Category))
        {
            return Result.Failure<IQueryable<Item>>(
                Error.Validation("Navigation.CategoryRequired", "Category is required when filtering by navigation path."));
        }

        Guid? categoryId = await ResolveCategoryIdAsync(request.Category.Trim());
        if (!categoryId.HasValue)
        {
            return Result.Success(query.Where(i => false));
        }

        List<string> normalizedKeywords = request.NavigationKeywords
            .Select(k => k.Trim().ToLowerInvariant())
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .ToList();

        if (normalizedKeywords.Count == 0)
        {
            return Result.Success(query);
        }

        if (normalizedKeywords.Contains("other"))
        {
            if (normalizedKeywords.Count > 1)
            {
                return Result.Success(query.Where(i => false));
            }

            return await ApplyOtherKeywordFilterAsync(query, categoryId.Value);
        }

        Guid? rank1KeywordId = await ResolveNavigationKeywordIdAsync(
            categoryId.Value,
            normalizedKeywords[0],
            null);

        if (!rank1KeywordId.HasValue)
        {
            return Result.Success(query.Where(i => false));
        }

        query = query.Where(i => i.NavigationKeywordId1 == rank1KeywordId.Value);

        if (normalizedKeywords.Count == 1)
        {
            return Result.Success(query);
        }

        Guid? rank2KeywordId = await ResolveNavigationKeywordIdAsync(
            categoryId.Value,
            normalizedKeywords[1],
            rank1KeywordId);

        if (!rank2KeywordId.HasValue)
        {
            return Result.Success(query.Where(i => false));
        }

        query = query.Where(i => i.NavigationKeywordId2 == rank2KeywordId.Value);
        return Result.Success(query);
    }

    private async Task<Guid?> ResolveNavigationKeywordIdAsync(
        Guid categoryId,
        string keywordName,
        Guid? parentKeywordId)
    {
        string keywordLower = keywordName.ToLowerInvariant();
        IQueryable<KeywordRelation> query = _db.KeywordRelations
            .Include(kr => kr.ChildKeyword)
            .Where(kr =>
                kr.CategoryId == categoryId &&
                kr.ParentKeywordId == parentKeywordId &&
                kr.ChildKeyword.Name.ToLower() == keywordLower);

        if (!_userContext.IsAuthenticated || string.IsNullOrEmpty(_userContext.UserId))
        {
            query = query.Where(kr => !kr.IsPrivate && !kr.ChildKeyword.IsPrivate);
        }
        else
        {
            query = query.Where(kr =>
                (!kr.IsPrivate || kr.CreatedBy == _userContext.UserId) &&
                (!kr.ChildKeyword.IsPrivate || kr.ChildKeyword.CreatedBy == _userContext.UserId));
        }

        return await query
            .Select(kr => (Guid?)kr.ChildKeywordId)
            .FirstOrDefaultAsync(_cancellationToken);
    }

    /// <summary>
    /// Applies keyword filtering to the query using AND semantics (items must have ALL selected keywords).
    /// Handles the special "other" keyword which returns items with no rank-1 navigation keyword assigned.
    /// First resolves keyword names to IDs, respecting visibility (anonymous users see only global keywords,
    /// authenticated users see global + their own private keywords).
    /// </summary>
    private async Task<Result<IQueryable<Item>>> ApplyKeywordFilterAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        if (request.Keywords is null || request.Keywords.Count == 0)
        {
            return Result.Success(query);
        }

        // Check if category is specified (required for "other" keyword and navigation context)
        if (string.IsNullOrEmpty(request.Category))
        {
            // Without category, fall back to simple keyword matching (AND semantics)
            return await ApplySimpleKeywordFilterAsync(query, request);
        }

        Guid? categoryId = await ResolveCategoryIdAsync(request.Category.Trim());
        if (!categoryId.HasValue)
        {
            // Category not found, return empty result
            return Result.Success(query.Where(i => false));
        }

        // Check for "other" keyword
        List<string> normalizedKeywords = request.Keywords
            .Select(k => k.Trim().ToLower())
            .ToList();

        bool hasOtherKeyword = normalizedKeywords.Contains("other");

        if (hasOtherKeyword && normalizedKeywords.Count > 1)
        {
            // "other" cannot be combined with other keywords
            return Result.Success(query.Where(i => false));
        }

        if (hasOtherKeyword)
        {
            // Special handling for "other": items with no rank-1 navigation keyword
            return await ApplyOtherKeywordFilterAsync(query, categoryId.Value);
        }

        // Regular keyword filtering with AND semantics
        return await ApplyAndKeywordFilterAsync(query, request, categoryId.Value);
    }

    /// <summary>
    /// Applies simple keyword filtering with AND semantics when no category is specified.
    /// When both public and private keywords share the same name, public keywords win;
    /// if no public keyword exists for a given name, the user's private keyword is used.
    /// </summary>
    private async Task<Result<IQueryable<Item>>> ApplySimpleKeywordFilterAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        IQueryable<Keyword> keywordQuery = _db.Keywords.AsQueryable();

        if (!_userContext.IsAuthenticated || string.IsNullOrEmpty(_userContext.UserId))
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate);
        }
        else
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate || (k.IsPrivate && k.CreatedBy == _userContext.UserId));
        }

        List<string> normalizedKeywords = request.Keywords!
            .Select(k => k.Trim().ToLower())
            .Where(k => !string.IsNullOrEmpty(k))
            .ToList();

        if (normalizedKeywords.Count == 0)
        {
            return Result.Success(query);
        }

        // Load all visible keyword candidates that match any requested name.
        List<Keyword> candidates = await keywordQuery
            .Where(k => normalizedKeywords.Contains(k.Name.ToLower()))
            .ToListAsync(_cancellationToken);

        // For each requested name, choose a single effective keyword ID:
        // - Prefer public keyword when present
        // - Otherwise fall back to user's private keyword (when visible)
        List<Guid> effectiveKeywordIds = new();

        foreach (string nameLower in normalizedKeywords)
        {
            List<Keyword> matchesForName = candidates
                .Where(k => k.Name.Equals(nameLower, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (matchesForName.Count == 0)
            {
                // Requested keyword not found in visible set -> no items should match
                return Result.Success(query.Where(i => false));
            }

            Keyword? publicMatch = matchesForName.FirstOrDefault(k => !k.IsPrivate);
            Keyword chosen = publicMatch ?? matchesForName[0];
            effectiveKeywordIds.Add(chosen.Id);
        }

        // AND semantics: one correlated COUNT is cheaper than N separate EXISTS subqueries
        List<Guid> distinctKeywordIds = effectiveKeywordIds.Distinct().ToList();
        int requiredCount = distinctKeywordIds.Count;
        query = query.Where(i => i.ItemKeywords.Count(ik => distinctKeywordIds.Contains(ik.KeywordId)) == requiredCount);

        return Result.Success(query);
    }

    /// <summary>
    /// Applies keyword filtering with AND semantics, respecting category context.
    /// When both public and private keywords share the same name, public keywords win;
    /// if no public keyword exists for a given name, the user's private keyword is used.
    /// </summary>
    private async Task<Result<IQueryable<Item>>> ApplyAndKeywordFilterAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request,
        Guid categoryId)
    {
        IQueryable<Keyword> keywordQuery = _db.Keywords.AsQueryable();

        if (!_userContext.IsAuthenticated || string.IsNullOrEmpty(_userContext.UserId))
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate);
        }
        else
        {
            keywordQuery = keywordQuery.Where(k => !k.IsPrivate || (k.IsPrivate && k.CreatedBy == _userContext.UserId));
        }

        List<string> normalizedKeywords = request.Keywords!
            .Select(k => k.Trim().ToLower())
            .Where(k => !string.IsNullOrEmpty(k))
            .ToList();

        if (normalizedKeywords.Count == 0)
        {
            return Result.Success(query);
        }

        // Load all visible keyword candidates that match any requested name.
        List<Keyword> candidates = await keywordQuery
            .Where(k => normalizedKeywords.Contains(k.Name.ToLower()))
            .ToListAsync(_cancellationToken);

        List<Guid> effectiveKeywordIds = new();

        foreach (string nameLower in normalizedKeywords)
        {
            List<Keyword> matchesForName = candidates
                .Where(k => k.Name.Equals(nameLower, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (matchesForName.Count == 0)
            {
                // Requested keyword not found in visible set -> no items should match
                return Result.Success(query.Where(i => false));
            }

            Keyword? publicMatch = matchesForName.FirstOrDefault(k => !k.IsPrivate);
            Keyword chosen = publicMatch ?? matchesForName[0];
            effectiveKeywordIds.Add(chosen.Id);
        }

        // AND semantics: one correlated COUNT is cheaper than N separate EXISTS subqueries
        List<Guid> distinctKeywordIds = effectiveKeywordIds.Distinct().ToList();
        int requiredCount = distinctKeywordIds.Count;
        query = query.Where(i => i.ItemKeywords.Count(ik => distinctKeywordIds.Contains(ik.KeywordId)) == requiredCount);

        return Result.Success(query);
    }

    /// <summary>
    /// Applies the special "other" keyword filter: items with no rank-1 navigation keyword assigned.
    /// </summary>
    private async Task<Result<IQueryable<Item>>> ApplyOtherKeywordFilterAsync(
        IQueryable<Item> query,
        Guid categoryId)
    {
        IQueryable<KeywordRelation> rank1Query = _db.KeywordRelations
            .Where(kr => kr.CategoryId == categoryId && kr.ParentKeywordId == null);
        if (!_userContext.IsAuthenticated || string.IsNullOrEmpty(_userContext.UserId))
            rank1Query = rank1Query.Where(kr => !kr.IsPrivate);
        else
            rank1Query = rank1Query.Where(kr => !kr.IsPrivate || kr.CreatedBy == _userContext.UserId);
        List<Guid> rank1KeywordIds = await rank1Query
            .Select(kr => kr.ChildKeywordId)
            .ToListAsync(_cancellationToken);

        if (rank1KeywordIds.Count > 0)
            query = query.Where(i => i.NavigationKeywordId1 == null || !rank1KeywordIds.Contains(i.NavigationKeywordId1.Value));

        return Result.Success(query);
    }

    /// <summary>
    /// Applies collection filtering to the query. Requires authentication and verifies
    /// that the user owns the collection (or is admin) before filtering items.
    /// Returns validation error if collection doesn't exist or user doesn't have access.
    /// Loads all item IDs in the collection first, then filters the main query to those IDs.
    /// This approach ensures visibility rules (already applied) are respected.
    /// </summary>
    private async Task<Result<IQueryable<Item>>> ApplyCollectionFilterAsync(
        IQueryable<Item> query,
        GetItems.QueryRequest request)
    {
        if (!request.CollectionId.HasValue)
        {
            return Result.Success(query);
        }

        Collection? collection = await _db.Collections
            .FirstOrDefaultAsync(c => c.Id == request.CollectionId.Value, _cancellationToken);

        if (collection is null)
        {
            return Result.Failure<IQueryable<Item>>(
                Error.NotFound("Collection.NotFound", "Collection not found"));
        }

        if (!await GetCollectionById.CanAccessCollectionAsync(_db, collection, _userContext, _cancellationToken))
        {
            return Result.Failure<IQueryable<Item>>(
                Error.NotFound("Collection.NotFound", "Collection not found"));
        }

        List<Guid> itemIdsInCollection = await _db.CollectionItems
            .Where(ci => ci.CollectionId == request.CollectionId.Value)
            .Select(ci => ci.ItemId)
            .ToListAsync(_cancellationToken);

        if (itemIdsInCollection.Count == 0)
        {
            // No items in collection, return empty result
            query = query.Where(i => false);
            return Result.Success(query);
        }

        // Filter to items in the collection
        // Note: Visibility filter is already applied before this, so only visible items will be included
        query = query.Where(i => itemIdsInCollection.Contains(i.Id));

        return Result.Success(query);
    }
}
