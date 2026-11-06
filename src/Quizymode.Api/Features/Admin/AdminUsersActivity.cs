using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

public static class AdminUsersActivity
{
    public sealed record UsersQueryRequest(
        string? Search = null,
        int ActivityDays = 30,
        string? ActivityFilter = null,
        int Page = 1,
        int PageSize = 25,
        bool IncludeInternal = false,
        string? SortBy = null,
        string? SortDir = null);

    public sealed record UsersResponse(
        UsersSummaryResponse Summary,
        List<UserOverviewResponse> Users,
        int TotalCount,
        int Page,
        int PageSize,
        int TotalPages);

    public sealed record UsersSummaryResponse(
        DateTime ActivityWindowStartUtc,
        DateTime ActivityWindowEndUtc,
        int TotalRegisteredUsers,
        int FilteredUsers,
        int UsersWithActivityInWindow,
        int UsersWithoutActivityInWindow,
        int InternalUsers,
        int InternalSessions,
        bool InternalExcluded);

    public sealed record UserOverviewResponse(
        string Id,
        string? Name,
        string? Email,
        DateTime CreatedAt,
        DateTime LastLogin,
        int UniqueUrlsInWindow,
        int TotalPageViewsInWindow,
        DateTime? LastOpenedUtc,
        string? LastKnownCountry,
        bool IsInternal,
        int SessionsInWindow,
        int StudySessionsInWindow,
        int CollectionsCreated,
        int ItemsCreated,
        int Ratings,
        int Comments,
        string SignupChannel);

    public sealed record UserActivityQueryRequest(
        string UserId,
        int Days = 30,
        string? UrlContains = null,
        int Page = 1,
        int PageSize = 25,
        bool IncludeInternal = false);

    public sealed record UserActivityResponse(
        UserDetailResponse User,
        UserActivitySummaryResponse Summary,
        List<UserUrlHistoryResponse> UrlHistory,
        int TotalCount,
        int Page,
        int PageSize,
        int TotalPages);

    public sealed record UserDetailResponse(
        string Id,
        string? Name,
        string? Email,
        DateTime CreatedAt,
        DateTime LastLogin,
        bool IsInternal);

    public sealed record UserActivitySummaryResponse(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int TotalViews,
        int UniqueUrls,
        DateTime? LastOpenedUtc,
        int InternalSessions,
        bool InternalExcluded);

    public sealed record UserUrlHistoryResponse(
        string Url,
        string Path,
        string QueryString,
        int OpenCount,
        DateTime FirstOpenedUtc,
        DateTime LastOpenedUtc);

    private enum ActivityFilter
    {
        All,
        WithActivity,
        WithoutActivity,
        Dormant
    }

    /// <summary>Days without a page view after which a user counts as dormant.</summary>
    public const int DormantDays = 30;

    private static readonly string[] SortKeys =
    [
        "lastActive", "sessions", "studySessions", "collections", "items", "ratings", "comments", "channel", "registered"
    ];

    private sealed record UserOverviewProjection(
        Guid Id,
        string? Name,
        string? Email,
        DateTime CreatedAt,
        DateTime LastLogin,
        int UniqueUrlsInWindow,
        int TotalPageViewsInWindow,
        DateTime? LastOpenedUtc,
        bool IsInternal,
        int SessionsInWindow,
        int StudySessionsInWindow,
        int CollectionsCreated,
        int ItemsCreated,
        int Ratings,
        int Comments,
        string SignupChannel);

    private sealed record UserUrlHistoryProjection(
        string Url,
        string Path,
        string QueryString,
        int OpenCount,
        DateTime FirstOpenedUtc,
        DateTime LastOpenedUtc);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/users", GetUsersHandler)
                .WithTags("Admin")
                .WithSummary("Get registered users with activity metrics (Admin only)")
                .WithDescription("Returns a filterable, paged list of registered users plus page-view activity metrics for a selected time window. Activity from internal sessions is excluded unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<UsersResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);

            app.MapGet("admin/users/{id}/page-view-history", GetUserActivityHandler)
                .WithTags("Admin")
                .WithSummary("Get page-view activity for a specific user (Admin only)")
                .WithDescription("Returns grouped URL history and activity summary for one registered user in a selected time window. Hits from internal sessions are excluded unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<UserActivityResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> GetUsersHandler(
            string? search = null,
            int activityDays = 30,
            string? activityFilter = null,
            int page = 1,
            int pageSize = 25,
            bool includeInternal = false,
            string? sortBy = null,
            string? sortDir = null,
            ApplicationDbContext db = null!,
            IIpGeolocationService geoService = null!,
            CancellationToken cancellationToken = default)
        {
            UsersQueryRequest request = new(search, activityDays, activityFilter, page, pageSize, includeInternal, sortBy, sortDir);
            Result<UsersResponse> result = await HandleGetUsersAsync(request, db, geoService, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> GetUserActivityHandler(
            string id,
            int days = 30,
            string? urlContains = null,
            int page = 1,
            int pageSize = 25,
            bool includeInternal = false,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            UserActivityQueryRequest request = new(id, days, urlContains, page, pageSize, includeInternal);
            Result<UserActivityResponse> result = await HandleGetUserActivityAsync(request, db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error.Type == ErrorType.NotFound
                    ? CustomResults.NotFound(failure.Error.Description, failure.Error.Code)
                    : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<UsersResponse>> HandleGetUsersAsync(
        UsersQueryRequest request,
        ApplicationDbContext db,
        IIpGeolocationService geoService,
        CancellationToken cancellationToken)
    {
        if (request.ActivityDays is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<UsersResponse>(
                Error.Validation("Admin.Users.InvalidActivityDays", $"ActivityDays must be between 1 and {PageViewRetentionService.RetentionDays}. Page hits are kept for {PageViewRetentionService.RetentionDays} days."));
        }

        ActivityFilter activityFilter;
        try
        {
            activityFilter = ParseActivityFilter(request.ActivityFilter);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<UsersResponse>(
                Error.Validation("Admin.Users.InvalidActivityFilter", ex.Message));
        }

        string sortBy = string.IsNullOrWhiteSpace(request.SortBy) ? "lastActive" : request.SortBy.Trim();
        if (!SortKeys.Contains(sortBy, StringComparer.OrdinalIgnoreCase))
        {
            return Result.Failure<UsersResponse>(
                Error.Validation("Admin.Users.InvalidSortBy", $"SortBy must be one of: {string.Join(", ", SortKeys)}."));
        }

        bool sortAscending = string.Equals(request.SortDir?.Trim(), "asc", StringComparison.OrdinalIgnoreCase);

        int page = Math.Max(1, request.Page);
        int pageSize = Math.Clamp(request.PageSize, 1, 100);
        string? search = string.IsNullOrWhiteSpace(request.Search)
            ? null
            : request.Search.Trim();
        string? searchLower = search?.ToLowerInvariant();
        Guid parsedUserId = Guid.Empty;
        bool hasUserIdSearch = search is not null && Guid.TryParse(search, out parsedUserId);

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.ActivityDays);

        IQueryable<User> usersQuery = db.Users.AsNoTracking();
        int totalRegisteredUsers = await usersQuery.CountAsync(cancellationToken);
        int internalUsers = await usersQuery.CountAsync(user => user.IsInternal, cancellationToken);

        if (searchLower is not null)
        {
            usersQuery = usersQuery.Where(user =>
                (user.Email != null && user.Email.ToLower().Contains(searchLower)) ||
                (user.Name != null && user.Name.ToLower().Contains(searchLower)) ||
                (hasUserIdSearch && user.Id == parsedUserId));
        }

        List<User> filteredUsersList = await usersQuery.ToListAsync(cancellationToken);
        List<Guid> filteredUserIds = filteredUsersList.Select(user => user.Id).ToList();

        Dictionary<Guid, (int UniqueUrlsInWindow, int TotalPageViewsInWindow, int Sessions, int StudySessions)> windowActivityByUserId = [];
        Dictionary<Guid, int> collectionsByUserId = [];
        Dictionary<Guid, int> itemsByUserId = [];
        Dictionary<Guid, int> ratingsByUserId = [];
        Dictionary<Guid, int> commentsByUserId = [];
        Dictionary<Guid, GetLifecycleReport.SignupSource> signupSources = [];
        Dictionary<Guid, DateTime> lastOpenedByUserId = [];
        int internalSessions = 0;

        if (filteredUserIds.Count > 0)
        {
            IQueryable<PageView> userPageViews = db.PageViews
                .AsNoTracking()
                .Where(pageView =>
                    pageView.UserId.HasValue &&
                    filteredUserIds.Contains(pageView.UserId.Value));

            IQueryable<PageView> windowPageViews = userPageViews
                .Where(pageView =>
                    pageView.CreatedUtc >= windowStartUtc &&
                    pageView.CreatedUtc <= windowEndUtc);

            internalSessions = await InternalTrafficFilter.InternalSessionIds(db, windowPageViews)
                .CountAsync(cancellationToken);

            if (!request.IncludeInternal)
            {
                userPageViews = InternalTrafficFilter.ExcludeInternalSessions(db, userPageViews);
                windowPageViews = InternalTrafficFilter.ExcludeInternalSessions(db, windowPageViews);
            }

            windowActivityByUserId = (await windowPageViews
                .GroupBy(pageView => pageView.UserId!.Value)
                .Select(group => new
                {
                    UserId = group.Key,
                    UniqueUrlsInWindow = group.Select(pageView => pageView.Url).Distinct().Count(),
                    TotalPageViewsInWindow = group.Count(),
                    Sessions = group.Select(pageView => pageView.SessionId).Distinct().Count(),
                    StudySessions = group
                        .Where(pageView => pageView.Area == PageHitClassifier.AreaQuiz || pageView.Area == PageHitClassifier.AreaFlashcards)
                        .Select(pageView => pageView.SessionId)
                        .Distinct()
                        .Count()
                })
                .ToListAsync(cancellationToken))
                .ToDictionary(
                    item => item.UserId,
                    item => (item.UniqueUrlsInWindow, item.TotalPageViewsInWindow, item.Sessions, item.StudySessions));

            List<string> userIdStrings = filteredUserIds.Select(id => id.ToString()).ToList();
            collectionsByUserId = CountByCreator(
                await db.Collections.AsNoTracking()
                    .Where(collection => !collection.IsRepoManaged && userIdStrings.Contains(collection.CreatedBy))
                    .Select(collection => collection.CreatedBy)
                    .ToListAsync(cancellationToken));
            itemsByUserId = CountByCreator(
                await db.Items.AsNoTracking()
                    .Where(item => !item.IsRepoManaged && userIdStrings.Contains(item.CreatedBy))
                    .Select(item => item.CreatedBy)
                    .ToListAsync(cancellationToken));
            ratingsByUserId = CountByCreator(
                await db.Ratings.AsNoTracking()
                    .Where(rating => userIdStrings.Contains(rating.CreatedBy))
                    .Select(rating => rating.CreatedBy)
                    .ToListAsync(cancellationToken));
            commentsByUserId = CountByCreator(
                await db.Comments.AsNoTracking()
                    .Where(comment => userIdStrings.Contains(comment.CreatedBy))
                    .Select(comment => comment.CreatedBy)
                    .ToListAsync(cancellationToken));
            signupSources = await GetLifecycleReport.ResolveSignupSourcesAsync(db, filteredUserIds, cancellationToken);

            lastOpenedByUserId = (await userPageViews
                .GroupBy(pageView => pageView.UserId!.Value)
                .Select(group => new
                {
                    UserId = group.Key,
                    LastOpenedUtc = group.Max(pageView => pageView.CreatedUtc)
                })
                .ToListAsync(cancellationToken))
                .ToDictionary(item => item.UserId, item => item.LastOpenedUtc);
        }

        IEnumerable<UserOverviewProjection> overviewQuery = filteredUsersList.Select(user =>
        {
            (int UniqueUrlsInWindow, int TotalPageViewsInWindow, int Sessions, int StudySessions) windowActivity =
                windowActivityByUserId.GetValueOrDefault(user.Id, (0, 0, 0, 0));
            DateTime? lastOpenedUtc = lastOpenedByUserId.TryGetValue(user.Id, out DateTime openedUtc)
                ? openedUtc
                : null;

            return new UserOverviewProjection(
                user.Id,
                user.Name,
                user.Email,
                user.CreatedAt,
                user.LastLogin,
                windowActivity.UniqueUrlsInWindow,
                windowActivity.TotalPageViewsInWindow,
                lastOpenedUtc,
                user.IsInternal,
                windowActivity.Sessions,
                windowActivity.StudySessions,
                collectionsByUserId.GetValueOrDefault(user.Id),
                itemsByUserId.GetValueOrDefault(user.Id),
                ratingsByUserId.GetValueOrDefault(user.Id),
                commentsByUserId.GetValueOrDefault(user.Id),
                (signupSources.GetValueOrDefault(user.Id)?.Channel) ?? GetLifecycleReport.UnknownChannel);
        });

        overviewQuery = activityFilter switch
        {
            ActivityFilter.WithActivity => overviewQuery.Where(user => user.TotalPageViewsInWindow > 0),
            ActivityFilter.WithoutActivity => overviewQuery.Where(user => user.TotalPageViewsInWindow == 0),
            ActivityFilter.Dormant => overviewQuery.Where(user =>
                (user.LastOpenedUtc ?? user.CreatedAt) < windowEndUtc.AddDays(-DormantDays)),
            _ => overviewQuery
        };

        List<UserOverviewProjection> overviewList = overviewQuery.ToList();

        int filteredUsers = overviewList.Count;
        int usersWithActivityInWindow = overviewList.Count(user => user.TotalPageViewsInWindow > 0);
        int usersWithoutActivityInWindow = filteredUsers - usersWithActivityInWindow;

        int totalPages = filteredUsers == 0 ? 0 : (int)Math.Ceiling(filteredUsers / (double)pageSize);
        int skip = (page - 1) * pageSize;

        List<UserOverviewProjection> pagedOverview = SortUsers(overviewList, sortBy, sortAscending)
            .Skip(skip)
            .Take(pageSize)
            .ToList();

        // Fetch the most recent page-view IP for each user in this page
        List<Guid> pagedUserIds = pagedOverview.Select(u => u.Id).ToList();
        Dictionary<Guid, string> lastIpByUserId = new();
        if (pagedUserIds.Count > 0)
        {
            lastIpByUserId = (await db.PageViews
                .AsNoTracking()
                .Where(pv => pv.UserId.HasValue && pagedUserIds.Contains(pv.UserId!.Value))
                .GroupBy(pv => pv.UserId!.Value)
                .Select(g => new { UserId = g.Key, IpAddress = g.OrderByDescending(pv => pv.CreatedUtc).First().IpAddress })
                .ToListAsync(cancellationToken))
                .ToDictionary(x => x.UserId, x => x.IpAddress);
        }

        // Resolve country for unique IPs (parallel, cached)
        List<string> uniqueIps = lastIpByUserId.Values.Distinct().ToList();
        Dictionary<string, string?> countryByIp = (await Task.WhenAll(
            uniqueIps.Select(async ip => (ip, country: await geoService.GetCountryAsync(ip, cancellationToken)))))
            .ToDictionary(t => t.ip, t => t.country);

        List<UserOverviewResponse> users = pagedOverview
            .Select(user =>
            {
                string? lastCountry = lastIpByUserId.TryGetValue(user.Id, out string? ip)
                    ? countryByIp.GetValueOrDefault(ip)
                    : null;
                return new UserOverviewResponse(
                    user.Id.ToString(),
                    user.Name,
                    user.Email,
                    user.CreatedAt,
                    user.LastLogin,
                    user.UniqueUrlsInWindow,
                    user.TotalPageViewsInWindow,
                    user.LastOpenedUtc,
                    lastCountry,
                    user.IsInternal,
                    user.SessionsInWindow,
                    user.StudySessionsInWindow,
                    user.CollectionsCreated,
                    user.ItemsCreated,
                    user.Ratings,
                    user.Comments,
                    user.SignupChannel);
            })
            .ToList();

        UsersSummaryResponse summary = new(
            windowStartUtc,
            windowEndUtc,
            totalRegisteredUsers,
            filteredUsers,
            usersWithActivityInWindow,
            usersWithoutActivityInWindow,
            internalUsers,
            internalSessions,
            InternalExcluded: !request.IncludeInternal);

        return Result.Success(new UsersResponse(summary, users, filteredUsers, page, pageSize, totalPages));
    }

    public static async Task<Result<UserActivityResponse>> HandleGetUserActivityAsync(
        UserActivityQueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<UserActivityResponse>(
                Error.Validation("Admin.UserActivity.InvalidDays", $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Page hits are kept for {PageViewRetentionService.RetentionDays} days."));
        }

        if (!Guid.TryParse(request.UserId, out Guid userId))
        {
            return Result.Failure<UserActivityResponse>(
                Error.Validation("Admin.UserActivity.InvalidUserId", "Invalid user ID format."));
        }

        int page = Math.Max(1, request.Page);
        int pageSize = Math.Clamp(request.PageSize, 1, 100);
        string? urlContains = string.IsNullOrWhiteSpace(request.UrlContains)
            ? null
            : request.UrlContains.Trim().ToLowerInvariant();

        User? user = await db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == userId, cancellationToken);

        if (user is null)
        {
            return Result.Failure<UserActivityResponse>(
                Error.NotFound("Admin.UserActivity.UserNotFound", $"User with id {request.UserId} not found."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<PageView> query = db.PageViews
            .AsNoTracking()
            .Where(pageView =>
                pageView.UserId == userId &&
                pageView.CreatedUtc >= windowStartUtc &&
                pageView.CreatedUtc <= windowEndUtc);

        int internalSessions = await InternalTrafficFilter.InternalSessionIds(db, query)
            .CountAsync(cancellationToken);

        if (!request.IncludeInternal)
        {
            query = InternalTrafficFilter.ExcludeInternalSessions(db, query);
        }

        if (urlContains is not null)
        {
            query = query.Where(pageView => pageView.Url.ToLower().Contains(urlContains));
        }

        int totalViews = await query.CountAsync(cancellationToken);
        int uniqueUrls = await query
            .Select(pageView => pageView.Url)
            .Distinct()
            .CountAsync(cancellationToken);
        DateTime? lastOpenedUtc = await query
            .Select(pageView => (DateTime?)pageView.CreatedUtc)
            .MaxAsync(cancellationToken);

        IQueryable<UserUrlHistoryProjection> groupedQuery = query
            .GroupBy(pageView => new { pageView.Url, pageView.Path, pageView.QueryString })
            .Select(group => new UserUrlHistoryProjection(
                group.Key.Url,
                group.Key.Path,
                group.Key.QueryString,
                group.Count(),
                group.Min(pageView => pageView.CreatedUtc),
                group.Max(pageView => pageView.CreatedUtc)));

        int totalCount = await groupedQuery.CountAsync(cancellationToken);
        int totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
        int skip = (page - 1) * pageSize;

        List<UserUrlHistoryResponse> urlHistory = (await groupedQuery.ToListAsync(cancellationToken))
            .Select(entry => new UserUrlHistoryResponse(
                entry.Url,
                entry.Path,
                entry.QueryString,
                entry.OpenCount,
                entry.FirstOpenedUtc,
                entry.LastOpenedUtc))
            .OrderByDescending(entry => entry.LastOpenedUtc)
            .ThenBy(entry => entry.Url)
            .Skip(skip)
            .Take(pageSize)
            .ToList();

        UserDetailResponse userResponse = new(
            user.Id.ToString(),
            user.Name,
            user.Email,
            user.CreatedAt,
            user.LastLogin,
            user.IsInternal);

        UserActivitySummaryResponse summary = new(
            windowStartUtc,
            windowEndUtc,
            totalViews,
            uniqueUrls,
            lastOpenedUtc,
            internalSessions,
            InternalExcluded: !request.IncludeInternal);

        return Result.Success(new UserActivityResponse(
            userResponse,
            summary,
            urlHistory,
            totalCount,
            page,
            pageSize,
            totalPages));
    }

    private static Dictionary<Guid, int> CountByCreator(List<string> creators)
    {
        return creators
            .Select(creator => Guid.TryParse(creator, out Guid id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .GroupBy(id => id)
            .ToDictionary(group => group.Key, group => group.Count());
    }

    private static IEnumerable<UserOverviewProjection> SortUsers(
        List<UserOverviewProjection> users,
        string sortBy,
        bool ascending)
    {
        Func<UserOverviewProjection, IComparable> key = sortBy.ToLowerInvariant() switch
        {
            "sessions" => user => user.SessionsInWindow,
            "studysessions" => user => user.StudySessionsInWindow,
            "collections" => user => user.CollectionsCreated,
            "items" => user => user.ItemsCreated,
            "ratings" => user => user.Ratings,
            "comments" => user => user.Comments,
            "channel" => user => user.SignupChannel,
            "registered" => user => user.CreatedAt,
            _ => user => user.LastOpenedUtc ?? DateTime.MinValue
        };

        IOrderedEnumerable<UserOverviewProjection> ordered = ascending
            ? users.OrderBy(key)
            : users.OrderByDescending(key);

        return ordered
            .ThenByDescending(user => user.CreatedAt)
            .ThenBy(user => user.Email ?? user.Name ?? user.Id.ToString());
    }

    private static ActivityFilter ParseActivityFilter(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ActivityFilter.All;
        }

        return value.Trim().ToLowerInvariant() switch
        {
            "all" => ActivityFilter.All,
            "with-activity" => ActivityFilter.WithActivity,
            "without-activity" => ActivityFilter.WithoutActivity,
            "dormant" => ActivityFilter.Dormant,
            _ => throw new ArgumentException("ActivityFilter must be one of: all, with-activity, without-activity, dormant.")
        };
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
        }
    }
}
