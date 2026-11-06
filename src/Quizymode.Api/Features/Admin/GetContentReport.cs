using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Content engagement (ANALYTICS-008): per category, navigation set, and collection usage and community
/// signals, featured-entry click-through, public content nobody studied, and user-created content by week.
/// </summary>
public static class GetContentReport
{
    public const int MaxRows = 50;

    public sealed record QueryRequest(int Days = 30, bool IncludeBots = false, bool IncludeInternal = false);

    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        List<ContentRowResponse> Categories,
        List<ContentRowResponse> NavigationSets,
        List<ContentRowResponse> Collections,
        List<FeaturedRowResponse> Featured,
        List<UntouchedResponse> UntouchedCategories,
        List<UntouchedResponse> UntouchedCollections,
        List<UserCreatedWeekResponse> UserCreated);

    /// <param name="Key">Category slug, navigation path (category/keyword/keyword), or collection id.</param>
    /// <param name="StudySessions">Sessions with a Quiz or Flashcards page hit in this scope.</param>
    /// <param name="Bookmarks">Collections only; null for categories and navigation sets.</param>
    /// <param name="Shares">Collections only; null for categories and navigation sets.</param>
    /// <param name="Completions">Completed quiz runs; null when the scope has no recorded quiz runs.</param>
    public sealed record ContentRowResponse(
        string Key,
        string? Name,
        int Sessions,
        int StudySessions,
        int ItemSteps,
        int RatingsCount,
        double? AverageStars,
        int Comments,
        int? Bookmarks,
        int? Shares,
        int? Completions,
        double? AverageScorePercent);

    /// <param name="SessionsSeen">Sessions that viewed home or the Featured page.</param>
    /// <param name="SessionsOpened">Of those, sessions that then opened this entry's scope in the same session.</param>
    public sealed record FeaturedRowResponse(
        Guid Id,
        string Type,
        string DisplayName,
        int SessionsSeen,
        int SessionsOpened,
        double? ClickThroughPercent);

    public sealed record UntouchedResponse(string Key, string Name);

    /// <param name="WeekStartUtc">Monday of the week.</param>
    public sealed record UserCreatedWeekResponse(
        DateTime WeekStartUtc,
        int PrivateItems,
        int PublicItems,
        int Collections);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/content", Handler)
                .WithTags("Admin")
                .WithSummary("Get content engagement report (Admin only)")
                .WithDescription("Returns per category, navigation set, and collection engagement, featured click-through, untouched public content, and user-created content by week for the selected window. Bot sessions are excluded unless includeBots=true, and internal sessions unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 30,
            bool includeBots = false,
            bool includeInternal = false,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            Result<Response> result = await HandleAsync(new QueryRequest(days, includeBots, includeInternal), db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    private sealed record HitRow(string SessionId, string? Area, string? ScopeType, string? ScopeKey, string? NavPath, bool IsItemStep, DateTime CreatedUtc);

    private sealed record ItemMeta(string? Category, string? Keyword1, string? Keyword2);

    private sealed class Counters
    {
        public HashSet<string> Sessions { get; } = [];
        public HashSet<string> StudySessions { get; } = [];
        public int ItemSteps { get; set; }
        public int RatingsCount { get; set; }
        public int StarsSum { get; set; }
        public int Comments { get; set; }
        public int Bookmarks { get; set; }
        public int Shares { get; set; }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.ContentReport.InvalidDays", $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Engagement data is kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<PageView> windowQuery = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= windowStartUtc && pageView.CreatedUtc <= windowEndUtc);

        int botSessions = await windowQuery
            .Where(pageView => pageView.IsBot)
            .Select(pageView => pageView.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);
        int internalSessions = await InternalTrafficFilter.InternalSessionIds(db, windowQuery).CountAsync(cancellationToken);

        IQueryable<PageView> query = request.IncludeBots ? windowQuery : windowQuery.Where(pageView => !pageView.IsBot);
        if (!request.IncludeInternal)
        {
            query = InternalTrafficFilter.ExcludeInternalSessions(db, query);
        }

        List<HitRow> hits = await query
            .Where(pageView =>
                pageView.Area == PageHitClassifier.AreaHome ||
                pageView.Area == PageHitClassifier.AreaFeatured ||
                pageView.ScopeType == PageHitClassifier.ScopeCategory ||
                pageView.ScopeType == PageHitClassifier.ScopeCollection)
            .Select(pageView => new HitRow(
                pageView.SessionId, pageView.Area, pageView.ScopeType, pageView.ScopeKey, pageView.NavPath, pageView.IsItemStep, pageView.CreatedUtc))
            .ToListAsync(cancellationToken);

        Dictionary<string, Counters> categories = [];
        Dictionary<string, Counters> navSets = [];
        Dictionary<string, Counters> collections = [];

        foreach (HitRow hit in hits)
        {
            bool isStudy = hit.Area is PageHitClassifier.AreaQuiz or PageHitClassifier.AreaFlashcards;
            if (hit.ScopeType == PageHitClassifier.ScopeCategory && hit.ScopeKey is not null)
            {
                Touch(categories, hit.ScopeKey, hit, isStudy);
                if (hit.NavPath is not null)
                {
                    Touch(navSets, hit.NavPath, hit, isStudy);
                }
            }
            else if (hit.ScopeType == PageHitClassifier.ScopeCollection && hit.ScopeKey is not null)
            {
                Touch(collections, hit.ScopeKey, hit, isStudy);
            }
        }

        // Ratings and comments are item-level: attributed to the item's category, navigation prefixes, and collections.
        var ratingRows = await db.Ratings.AsNoTracking()
            .Where(rating => rating.Stars != null && rating.CreatedAt >= windowStartUtc && rating.CreatedAt <= windowEndUtc)
            .Select(rating => new { rating.ItemId, Stars = rating.Stars!.Value })
            .ToListAsync(cancellationToken);
        List<Guid> commentItemIds = await db.Comments.AsNoTracking()
            .Where(comment => comment.CreatedAt >= windowStartUtc && comment.CreatedAt <= windowEndUtc)
            .Select(comment => comment.ItemId)
            .ToListAsync(cancellationToken);

        List<Guid> itemIds = ratingRows.Select(rating => rating.ItemId).Concat(commentItemIds).Distinct().ToList();
        Dictionary<Guid, ItemMeta> itemMeta = [];
        ILookup<Guid, string> collectionsByItem = Array.Empty<(Guid ItemId, string CollectionId)>()
            .ToLookup(pair => pair.ItemId, pair => pair.CollectionId);
        if (itemIds.Count > 0)
        {
            itemMeta = await db.Items.AsNoTracking()
                .Where(item => itemIds.Contains(item.Id))
                .Select(item => new
                {
                    item.Id,
                    Category = item.Category == null ? null : item.Category.Name,
                    Keyword1 = item.NavigationKeyword1 == null ? null : item.NavigationKeyword1.Name,
                    Keyword2 = item.NavigationKeyword2 == null ? null : item.NavigationKeyword2.Name
                })
                .ToDictionaryAsync(item => item.Id, item => new ItemMeta(item.Category, item.Keyword1, item.Keyword2), cancellationToken);
            collectionsByItem = (await db.CollectionItems.AsNoTracking()
                    .Where(collectionItem => itemIds.Contains(collectionItem.ItemId))
                    .Select(collectionItem => new { collectionItem.ItemId, collectionItem.CollectionId })
                    .ToListAsync(cancellationToken))
                .ToLookup(row => row.ItemId, row => row.CollectionId.ToString());
        }

        foreach (var rating in ratingRows)
        {
            int stars = rating.Stars;
            AttributeItem(rating.ItemId, itemMeta, collectionsByItem, categories, navSets, collections, counters =>
            {
                counters.RatingsCount++;
                counters.StarsSum += stars;
            });
        }

        foreach (Guid itemId in commentItemIds)
        {
            AttributeItem(itemId, itemMeta, collectionsByItem, categories, navSets, collections, counters => counters.Comments++);
        }

        foreach (var rating in await db.CollectionRatings.AsNoTracking()
                     .Where(rating => rating.CreatedAt >= windowStartUtc && rating.CreatedAt <= windowEndUtc)
                     .Select(rating => new { rating.CollectionId, rating.Stars })
                     .ToListAsync(cancellationToken))
        {
            Counters counters = Get(collections, rating.CollectionId.ToString());
            counters.RatingsCount++;
            counters.StarsSum += rating.Stars;
        }

        foreach (Guid collectionId in await db.CollectionBookmarks.AsNoTracking()
                     .Where(bookmark => bookmark.CreatedAt >= windowStartUtc && bookmark.CreatedAt <= windowEndUtc)
                     .Select(bookmark => bookmark.CollectionId)
                     .ToListAsync(cancellationToken))
        {
            Get(collections, collectionId.ToString()).Bookmarks++;
        }

        foreach (Guid collectionId in await db.CollectionShares.AsNoTracking()
                     .Where(share => share.CreatedAt >= windowStartUtc && share.CreatedAt <= windowEndUtc)
                     .Select(share => share.CollectionId)
                     .ToListAsync(cancellationToken))
        {
            Get(collections, collectionId.ToString()).Shares++;
        }

        // Completions and score come from the study-engagement report (quiz runs only).
        Result<GetLearningReport.Response> learning = await GetLearningReport.HandleAsync(
            new GetLearningReport.QueryRequest(request.Days, request.IncludeBots, request.IncludeInternal), db, cancellationToken);
        Dictionary<(string Type, string Id), (int Completions, double? Score)> quizByScope = [];
        if (learning.IsSuccess)
        {
            foreach (GetLearningReport.ScopeResponse scope in learning.Value!.Scopes.Where(s =>
                         s.Mode == GetLearningReport.QuizMode && s.ContextType is not null && s.ContextId is not null))
            {
                quizByScope[(scope.ContextType!, scope.ContextId!.ToLowerInvariant())] = (scope.RunsCompleted ?? 0, scope.AverageScorePercent);
            }
        }

        Dictionary<Guid, string> collectionNames = await db.Collections.AsNoTracking()
            .ToDictionaryAsync(collection => collection.Id, collection => collection.Name, cancellationToken);

        List<ContentRowResponse> categoryRows = ToRows(categories, "category", withCollectionSignals: false, quizByScope, _ => null);
        List<ContentRowResponse> navRows = ToRows(navSets, null, withCollectionSignals: false, quizByScope, _ => null);
        List<ContentRowResponse> collectionRows = ToRows(
            collections, "collection", withCollectionSignals: true, quizByScope,
            key => Guid.TryParse(key, out Guid id) && collectionNames.TryGetValue(id, out string? name) ? name : null);

        List<FeaturedRowResponse> featured = await BuildFeaturedAsync(db, hits, cancellationToken);

        HashSet<string> studiedCategories = hits
            .Where(hit => hit.Area is PageHitClassifier.AreaQuiz or PageHitClassifier.AreaFlashcards &&
                          hit.ScopeType == PageHitClassifier.ScopeCategory && hit.ScopeKey is not null)
            .Select(hit => hit.ScopeKey!)
            .ToHashSet(StringComparer.Ordinal);
        HashSet<string> studiedCollections = hits
            .Where(hit => hit.Area is PageHitClassifier.AreaQuiz or PageHitClassifier.AreaFlashcards &&
                          hit.ScopeType == PageHitClassifier.ScopeCollection && hit.ScopeKey is not null)
            .Select(hit => hit.ScopeKey!)
            .ToHashSet(StringComparer.Ordinal);

        List<UntouchedResponse> untouchedCategories = (await db.Categories.AsNoTracking()
                .Where(category => !category.IsPrivate)
                .Select(category => category.Name)
                .ToListAsync(cancellationToken))
            .Where(name => !studiedCategories.Contains(name.ToLowerInvariant()))
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Select(name => new UntouchedResponse(name.ToLowerInvariant(), name))
            .ToList();
        List<UntouchedResponse> untouchedCollections = (await db.Collections.AsNoTracking()
                .Where(collection => collection.IsPublic)
                .Select(collection => new { collection.Id, collection.Name })
                .ToListAsync(cancellationToken))
            .Where(collection => !studiedCollections.Contains(collection.Id.ToString()))
            .OrderBy(collection => collection.Name, StringComparer.OrdinalIgnoreCase)
            .Select(collection => new UntouchedResponse(collection.Id.ToString(), collection.Name))
            .ToList();

        List<UserCreatedWeekResponse> userCreated = await BuildUserCreatedAsync(db, windowStartUtc, windowEndUtc, cancellationToken);

        return Result.Success(new Response(
            windowStartUtc, windowEndUtc, botSessions, !request.IncludeBots, internalSessions, !request.IncludeInternal,
            categoryRows, navRows, collectionRows, featured, untouchedCategories, untouchedCollections, userCreated));
    }

    private static Counters Get(Dictionary<string, Counters> map, string key)
    {
        if (!map.TryGetValue(key, out Counters? counters))
        {
            counters = new Counters();
            map[key] = counters;
        }

        return counters;
    }

    private static void Touch(Dictionary<string, Counters> map, string key, HitRow hit, bool isStudy)
    {
        Counters counters = Get(map, key);
        counters.Sessions.Add(hit.SessionId);
        if (isStudy)
        {
            counters.StudySessions.Add(hit.SessionId);
        }

        if (hit.IsItemStep)
        {
            counters.ItemSteps++;
        }
    }

    private static void AttributeItem(
        Guid itemId,
        Dictionary<Guid, ItemMeta> itemMeta,
        ILookup<Guid, string> collectionsByItem,
        Dictionary<string, Counters> categories,
        Dictionary<string, Counters> navSets,
        Dictionary<string, Counters> collections,
        Action<Counters> apply)
    {
        if (itemMeta.TryGetValue(itemId, out ItemMeta? meta) && !string.IsNullOrEmpty(meta.Category))
        {
            string category = meta.Category.ToLowerInvariant();
            apply(Get(categories, category));
            string path = category;
            foreach (string? keyword in new[] { meta.Keyword1, meta.Keyword2 })
            {
                if (string.IsNullOrEmpty(keyword))
                {
                    break;
                }

                path += "/" + keyword.ToLowerInvariant();
                apply(Get(navSets, path));
            }
        }

        foreach (string collectionId in collectionsByItem[itemId])
        {
            apply(Get(collections, collectionId));
        }
    }

    private static List<ContentRowResponse> ToRows(
        Dictionary<string, Counters> map,
        string? contextType,
        bool withCollectionSignals,
        Dictionary<(string Type, string Id), (int Completions, double? Score)> quizByScope,
        Func<string, string?> nameOf)
    {
        return map
            .OrderByDescending(pair => pair.Value.Sessions.Count)
            .ThenByDescending(pair => pair.Value.RatingsCount + pair.Value.Comments)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal)
            .Take(MaxRows)
            .Select(pair =>
            {
                Counters c = pair.Value;
                (int Completions, double? Score) quiz = default;
                bool hasQuiz = contextType is not null && quizByScope.TryGetValue((contextType, pair.Key), out quiz);
                return new ContentRowResponse(
                    pair.Key,
                    nameOf(pair.Key),
                    c.Sessions.Count,
                    c.StudySessions.Count,
                    c.ItemSteps,
                    c.RatingsCount,
                    c.RatingsCount == 0 ? null : Math.Round(c.StarsSum / (double)c.RatingsCount, 2),
                    c.Comments,
                    withCollectionSignals ? c.Bookmarks : null,
                    withCollectionSignals ? c.Shares : null,
                    hasQuiz ? quiz.Completions : null,
                    hasQuiz ? quiz.Score : null);
            })
            .ToList();
    }

    private static async Task<List<FeaturedRowResponse>> BuildFeaturedAsync(
        ApplicationDbContext db,
        List<HitRow> hits,
        CancellationToken cancellationToken)
    {
        List<FeaturedItem> entries = await db.FeaturedItems.AsNoTracking()
            .OrderBy(item => item.SortOrder)
            .ToListAsync(cancellationToken);

        // First time each session saw a page that lists featured entries.
        Dictionary<string, DateTime> firstSeen = hits
            .Where(hit => hit.Area is PageHitClassifier.AreaHome or PageHitClassifier.AreaFeatured)
            .GroupBy(hit => hit.SessionId)
            .ToDictionary(group => group.Key, group => group.Min(hit => hit.CreatedUtc));

        List<FeaturedRowResponse> rows = [];
        foreach (FeaturedItem entry in entries)
        {
            Func<HitRow, bool> matches = BuildMatcher(entry);
            int opened = hits
                .Where(hit => matches(hit) && firstSeen.TryGetValue(hit.SessionId, out DateTime seen) && hit.CreatedUtc >= seen)
                .Select(hit => hit.SessionId)
                .Distinct()
                .Count();
            rows.Add(new FeaturedRowResponse(
                entry.Id,
                entry.Type.ToString().ToLowerInvariant(),
                entry.DisplayName,
                firstSeen.Count,
                opened,
                firstSeen.Count == 0 ? null : Math.Round(opened * 100.0 / firstSeen.Count, 1)));
        }

        return rows;
    }

    private static Func<HitRow, bool> BuildMatcher(FeaturedItem entry)
    {
        if (entry.Type == FeaturedItemType.Collection)
        {
            string id = entry.CollectionId?.ToString() ?? string.Empty;
            return hit => hit.ScopeType == PageHitClassifier.ScopeCollection && hit.ScopeKey == id;
        }

        string category = (entry.CategorySlug ?? string.Empty).ToLowerInvariant();
        string path = category;
        foreach (string? keyword in new[] { entry.NavKeyword1, entry.NavKeyword2 })
        {
            if (string.IsNullOrWhiteSpace(keyword))
            {
                break;
            }

            path += "/" + keyword.Trim().ToLowerInvariant();
        }

        return hit => hit.ScopeType == PageHitClassifier.ScopeCategory &&
                      hit.ScopeKey == category &&
                      (path == category || hit.NavPath == path || (hit.NavPath?.StartsWith(path + "/", StringComparison.Ordinal) ?? false));
    }

    private static async Task<List<UserCreatedWeekResponse>> BuildUserCreatedAsync(
        ApplicationDbContext db,
        DateTime windowStartUtc,
        DateTime windowEndUtc,
        CancellationToken cancellationToken)
    {
        var items = await db.Items.AsNoTracking()
            .Where(item => !item.IsRepoManaged && item.CreatedAt >= windowStartUtc && item.CreatedAt <= windowEndUtc)
            .Select(item => new { item.CreatedAt, item.IsPrivate })
            .ToListAsync(cancellationToken);
        List<DateTime> collectionDates = await db.Collections.AsNoTracking()
            .Where(collection => !collection.IsRepoManaged && collection.CreatedAt >= windowStartUtc && collection.CreatedAt <= windowEndUtc)
            .Select(collection => collection.CreatedAt)
            .ToListAsync(cancellationToken);

        SortedDictionary<DateTime, int[]> weeks = [];
        void Add(DateTime date, int slot)
        {
            DateTime week = WeekStart(date);
            if (!weeks.TryGetValue(week, out int[]? counts))
            {
                counts = new int[3];
                weeks[week] = counts;
            }

            counts[slot]++;
        }

        foreach (var item in items)
        {
            Add(item.CreatedAt, item.IsPrivate ? 0 : 1);
        }

        foreach (DateTime date in collectionDates)
        {
            Add(date, 2);
        }

        return weeks.Select(pair => new UserCreatedWeekResponse(pair.Key, pair.Value[0], pair.Value[1], pair.Value[2])).ToList();
    }

    private static DateTime WeekStart(DateTime date)
    {
        int offset = ((int)date.DayOfWeek + 6) % 7;
        return DateTime.SpecifyKind(date.Date.AddDays(-offset), DateTimeKind.Utc);
    }
}
