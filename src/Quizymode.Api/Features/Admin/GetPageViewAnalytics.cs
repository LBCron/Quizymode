using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

public static class GetPageViewAnalytics
{
    public sealed record QueryRequest(
        int Days = 7,
        string? VisitorType = null,
        string? PathContains = null,
        int Page = 1,
        int PageSize = 25,
        int TopPagesLimit = 10,
        bool IncludeBots = false,
        bool IncludeInternal = false);

    public sealed record Response(
        SummaryResponse Summary,
        List<TopPageResponse> TopPages,
        List<RecentPageViewResponse> RecentPageViews,
        int TotalCount,
        int Page,
        int PageSize,
        int TotalPages,
        List<FeatureAreaResponse> FeatureAreas,
        ContentScopesResponse ContentScopes);

    /// <param name="Area">Feature area from the page-hit classifier; unclassified rows count as <c>other</c>.</param>
    /// <param name="Hits">Hits in this area. Across all areas these add up to <c>Summary.TotalPageViews</c>.</param>
    /// <param name="Sessions">Distinct sessions with at least one hit in this area.</param>
    /// <param name="SessionSharePercent">Sessions as a percentage of all sessions; a session can touch several areas.</param>
    /// <param name="ItemSteps">Quiz/Flashcards question views (item-step hits) in this area.</param>
    public sealed record FeatureAreaResponse(
        string Area,
        int Hits,
        int Sessions,
        double SessionSharePercent,
        int ItemSteps);

    public sealed record ContentScopesResponse(
        List<ContentScopeRowResponse> TopCategories,
        List<ContentScopeRowResponse> TopNavPaths,
        List<ContentScopeRowResponse> TopCollections);

    /// <param name="Key">Category slug, navigation path (category/kw1/kw2), or collection id.</param>
    /// <param name="Name">Resolved collection name; null for categories, navigation paths, and deleted collections.</param>
    /// <param name="AvgItemStepsPerSession">ItemSteps divided by Sessions.</param>
    public sealed record ContentScopeRowResponse(
        string Key,
        string? Name,
        int Sessions,
        int Hits,
        int ItemSteps,
        double AvgItemStepsPerSession);

    public sealed record SummaryResponse(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int TotalPageViews,
        int UniquePages,
        int UniqueSessions,
        int AuthenticatedPageViews,
        int AnonymousPageViews,
        int AuthenticatedSessions,
        int AnonymousSessions,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded);

    public sealed record TopPageResponse(
        string Path,
        int TotalViews,
        int UniqueSessions,
        int AuthenticatedViews,
        int AnonymousViews,
        DateTime LastVisitedUtc);

    public sealed record RecentPageViewResponse(
        string Id,
        string Url,
        string Path,
        string QueryString,
        string SessionId,
        string IpAddress,
        string? Country,
        bool IsAuthenticated,
        string? UserEmail,
        DateTime CreatedUtc);

    private enum VisitorFilter
    {
        All,
        Authenticated,
        Anonymous
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/page-view-analytics", Handler)
                .WithTags("Admin")
                .WithSummary("Get page-view analytics (Admin only)")
                .WithDescription("Returns summary metrics, usage by feature area and content scope (categories, navigation sets, collections), most visited raw pages, and recent page hits for anonymous and authenticated traffic. Internal sessions are excluded unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
            string? visitorType = null,
            string? pathContains = null,
            int page = 1,
            int pageSize = 25,
            int topPagesLimit = 10,
            bool includeBots = false,
            bool includeInternal = false,
            ApplicationDbContext db = null!,
            IIpGeolocationService geoService = null!,
            CancellationToken cancellationToken = default)
        {
            QueryRequest request = new(days, visitorType, pathContains, page, pageSize, topPagesLimit, includeBots, includeInternal);
            Result<Response> result = await HandleAsync(request, db, geoService, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        IIpGeolocationService geoService,
        CancellationToken cancellationToken)
    {
        // Raw hits are kept for RetentionDays only; longer ranges use GET /admin/page-view-rollups.
        if (request.Days < 1 || request.Days > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<Response>(
                Error.Validation(
                    "Admin.PageViewAnalytics.InvalidDays",
                    $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Raw page hits are kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        VisitorFilter visitorFilter;
        try
        {
            visitorFilter = ParseVisitorFilter(request.VisitorType);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.PageViewAnalytics.InvalidVisitorType", ex.Message));
        }

        int page = Math.Max(1, request.Page);
        int pageSize = Math.Clamp(request.PageSize, 1, 100);
        int topPagesLimit = Math.Clamp(request.TopPagesLimit, 1, 25);
        string? pathContains = string.IsNullOrWhiteSpace(request.PathContains)
            ? null
            : request.PathContains.Trim().ToLowerInvariant();

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<PageView> windowQuery = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= windowStartUtc && pageView.CreatedUtc <= windowEndUtc);

        // Reported even when excluded, so the size of the crawler share stays visible.
        int botSessions = await windowQuery
            .Where(pageView => pageView.IsBot)
            .Select(pageView => pageView.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        // Mirrors the bot count: internal sessions stay visible as a number when excluded.
        int internalSessions = await InternalTrafficFilter.InternalSessionIds(db, windowQuery)
            .CountAsync(cancellationToken);

        IQueryable<PageView> query = request.IncludeBots
            ? windowQuery
            : windowQuery.Where(pageView => !pageView.IsBot);

        if (!request.IncludeInternal)
        {
            query = InternalTrafficFilter.ExcludeInternalSessions(db, query);
        }

        query = visitorFilter switch
        {
            VisitorFilter.Authenticated => query.Where(pageView => pageView.IsAuthenticated),
            VisitorFilter.Anonymous => query.Where(pageView => !pageView.IsAuthenticated),
            _ => query
        };

        if (pathContains is not null)
        {
            query = query.Where(pageView => pageView.Path.ToLower().Contains(pathContains));
        }

        int totalCount = await query.CountAsync(cancellationToken);
        int totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
        int skip = (page - 1) * pageSize;

        // Batch the per-hit auth split into one GROUP BY query (2 sequential queries → 1)
        var authBreakdowns = await query
            .GroupBy(pv => pv.IsAuthenticated)
            .Select(g => new
            {
                IsAuthenticated = g.Key,
                PageViews = g.Count()
            })
            .ToListAsync(cancellationToken);

        int uniquePages = await query.Select(pv => pv.Path).Distinct().CountAsync(cancellationToken);

        // Session counts are classified by each session's FIRST hit. Grouping sessions by
        // per-hit auth state counted a visitor who signed in mid-session in both buckets,
        // so the two figures could sum to more than the unique-session total.
        var sessionFirstTimes = query
            .GroupBy(pv => pv.SessionId)
            .Select(g => new { SessionId = g.Key, FirstUtc = g.Min(pv => pv.CreatedUtc) });

        var sessionFirstHits = await (
            from pv in query
            join first in sessionFirstTimes on pv.SessionId equals first.SessionId
            where pv.CreatedUtc == first.FirstUtc
            select new { pv.SessionId, pv.IsAuthenticated })
            .ToListAsync(cancellationToken);

        Dictionary<string, bool> firstHitAuthBySession = sessionFirstHits
            .GroupBy(hit => hit.SessionId)
            .ToDictionary(group => group.Key, group => group.First().IsAuthenticated);

        int authPageViews = authBreakdowns.FirstOrDefault(x => x.IsAuthenticated)?.PageViews ?? 0;
        int anonPageViews = authBreakdowns.FirstOrDefault(x => !x.IsAuthenticated)?.PageViews ?? 0;
        int uniqueSessions = firstHitAuthBySession.Count;
        int authSessions = firstHitAuthBySession.Count(entry => entry.Value);
        int anonSessions = uniqueSessions - authSessions;

        SummaryResponse summary = new(
            WindowStartUtc: windowStartUtc,
            WindowEndUtc: windowEndUtc,
            TotalPageViews: totalCount,
            UniquePages: uniquePages,
            UniqueSessions: uniqueSessions,
            AuthenticatedPageViews: authPageViews,
            AnonymousPageViews: anonPageViews,
            AuthenticatedSessions: authSessions,
            AnonymousSessions: anonSessions,
            BotSessions: botSessions,
            BotsExcluded: !request.IncludeBots,
            InternalSessions: internalSessions,
            InternalExcluded: !request.IncludeInternal);

        List<TopPageResponse> topPages = (await query
            .GroupBy(pageView => pageView.Path)
            .Select(group => new
            {
                Path = group.Key,
                TotalViews = group.Count(),
                UniqueSessions = group.Select(pageView => pageView.SessionId).Distinct().Count(),
                AuthenticatedViews = group.Sum(pageView => pageView.IsAuthenticated ? 1 : 0),
                AnonymousViews = group.Sum(pageView => pageView.IsAuthenticated ? 0 : 1),
                LastVisitedUtc = group.Max(pageView => pageView.CreatedUtc)
            })
            .OrderByDescending(page => page.TotalViews)
            .ThenBy(page => page.Path)
            .Take(topPagesLimit)
            .ToListAsync(cancellationToken))
            .Select(page => new TopPageResponse(
                page.Path,
                page.TotalViews,
                page.UniqueSessions,
                page.AuthenticatedViews,
                page.AnonymousViews,
                page.LastVisitedUtc))
            .ToList();

        List<PageView> recentPageViews = await query
            .OrderByDescending(pageView => pageView.CreatedUtc)
            .ThenByDescending(pageView => pageView.Id)
            .Skip(skip)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        List<Guid> userIds = recentPageViews
            .Where(pageView => pageView.UserId.HasValue)
            .Select(pageView => pageView.UserId!.Value)
            .Distinct()
            .ToList();

        Dictionary<Guid, string?> userEmails = new();
        if (userIds.Count > 0)
        {
            userEmails = await db.Users
                .Where(user => userIds.Contains(user.Id))
                .Select(user => new { user.Id, user.Email })
                .ToDictionaryAsync(user => user.Id, user => user.Email, cancellationToken);
        }

        // Resolve country for unique IPs in this page (parallel, cached)
        List<string> uniqueIps = recentPageViews.Select(pv => pv.IpAddress).Distinct().ToList();
        Dictionary<string, string?> countryByIp = (await Task.WhenAll(
            uniqueIps.Select(async ip => (ip, country: await geoService.GetCountryAsync(ip, cancellationToken)))))
            .ToDictionary(t => t.ip, t => t.country);

        List<RecentPageViewResponse> recentResponses = recentPageViews
            .Select(pageView => new RecentPageViewResponse(
                pageView.Id.ToString(),
                pageView.Url,
                pageView.Path,
                pageView.QueryString,
                pageView.SessionId,
                IpTruncation.Truncate(pageView.IpAddress),
                countryByIp.GetValueOrDefault(pageView.IpAddress),
                pageView.IsAuthenticated,
                pageView.UserId.HasValue && userEmails.TryGetValue(pageView.UserId.Value, out string? email) ? email : null,
                pageView.CreatedUtc))
            .ToList();

        List<FeatureAreaResponse> featureAreas = await BuildFeatureAreasAsync(query, uniqueSessions, cancellationToken);
        ContentScopesResponse contentScopes = await BuildContentScopesAsync(db, query, topPagesLimit, cancellationToken);

        return Result.Success(new Response(
            summary, topPages, recentResponses, totalCount, page, pageSize, totalPages, featureAreas, contentScopes));
    }

    private static async Task<List<FeatureAreaResponse>> BuildFeatureAreasAsync(
        IQueryable<PageView> query,
        int uniqueSessions,
        CancellationToken cancellationToken)
    {
        var rows = await query
            .GroupBy(pageView => pageView.Area ?? PageHitClassifier.AreaOther)
            .Select(group => new
            {
                Area = group.Key,
                Hits = group.Count(),
                Sessions = group.Select(pageView => pageView.SessionId).Distinct().Count(),
                ItemSteps = group.Sum(pageView => pageView.IsItemStep ? 1 : 0)
            })
            .ToListAsync(cancellationToken);

        return rows
            .Select(row => new FeatureAreaResponse(
                row.Area,
                row.Hits,
                row.Sessions,
                uniqueSessions == 0 ? 0 : Math.Round(row.Sessions * 100.0 / uniqueSessions, 1),
                row.ItemSteps))
            .OrderByDescending(row => row.Sessions)
            .ThenByDescending(row => row.Hits)
            .ThenBy(row => row.Area, StringComparer.Ordinal)
            .ToList();
    }

    private sealed record ScopeAggregate(string Key, int Sessions, int Hits, int ItemSteps);

    private static async Task<ContentScopesResponse> BuildContentScopesAsync(
        ApplicationDbContext db,
        IQueryable<PageView> query,
        int limit,
        CancellationToken cancellationToken)
    {
        List<ScopeAggregate> categories = await AggregateScopeAsync(
            query.Where(pageView => pageView.ScopeType == PageHitClassifier.ScopeCategory && pageView.ScopeKey != null),
            pageView => pageView.ScopeKey!,
            limit,
            cancellationToken);

        List<ScopeAggregate> navPaths = await AggregateScopeAsync(
            query.Where(pageView => pageView.NavPath != null),
            pageView => pageView.NavPath!,
            limit,
            cancellationToken);

        List<ScopeAggregate> collections = await AggregateScopeAsync(
            query.Where(pageView => pageView.ScopeType == PageHitClassifier.ScopeCollection && pageView.ScopeKey != null),
            pageView => pageView.ScopeKey!,
            limit,
            cancellationToken);

        List<Guid> collectionIds = collections
            .Select(row => Guid.TryParse(row.Key, out Guid id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();

        Dictionary<Guid, string> collectionNames = collectionIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.Collections
                .AsNoTracking()
                .Where(collection => collectionIds.Contains(collection.Id))
                .Select(collection => new { collection.Id, collection.Name })
                .ToDictionaryAsync(collection => collection.Id, collection => collection.Name, cancellationToken);

        return new ContentScopesResponse(
            categories.Select(row => ToRow(row, name: null)).ToList(),
            navPaths.Select(row => ToRow(row, name: null)).ToList(),
            collections
                .Select(row => ToRow(
                    row,
                    Guid.TryParse(row.Key, out Guid id) && collectionNames.TryGetValue(id, out string? name) ? name : null))
                .ToList());
    }

    private static async Task<List<ScopeAggregate>> AggregateScopeAsync(
        IQueryable<PageView> scoped,
        System.Linq.Expressions.Expression<Func<PageView, string>> keySelector,
        int limit,
        CancellationToken cancellationToken)
    {
        var rows = await scoped
            .GroupBy(keySelector)
            .Select(group => new
            {
                Key = group.Key,
                Sessions = group.Select(pageView => pageView.SessionId).Distinct().Count(),
                Hits = group.Count(),
                ItemSteps = group.Sum(pageView => pageView.IsItemStep ? 1 : 0)
            })
            .OrderByDescending(row => row.Sessions)
            .ThenByDescending(row => row.Hits)
            .ThenBy(row => row.Key)
            .Take(limit)
            .ToListAsync(cancellationToken);

        return rows.Select(row => new ScopeAggregate(row.Key, row.Sessions, row.Hits, row.ItemSteps)).ToList();
    }

    private static ContentScopeRowResponse ToRow(ScopeAggregate row, string? name) =>
        new(
            row.Key,
            name,
            row.Sessions,
            row.Hits,
            row.ItemSteps,
            row.Sessions == 0 ? 0 : Math.Round(row.ItemSteps / (double)row.Sessions, 2));

    private static VisitorFilter ParseVisitorFilter(string? visitorType)
    {
        if (string.IsNullOrWhiteSpace(visitorType))
        {
            return VisitorFilter.All;
        }

        return visitorType.Trim().ToLowerInvariant() switch
        {
            "all" => VisitorFilter.All,
            "authenticated" => VisitorFilter.Authenticated,
            "anonymous" => VisitorFilter.Anonymous,
            _ => throw new ArgumentException("VisitorType must be one of: all, authenticated, anonymous.")
        };
    }
}
