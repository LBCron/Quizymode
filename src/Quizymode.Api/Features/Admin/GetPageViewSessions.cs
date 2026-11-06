using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Rolls raw page hits up into sessions so admins can tell a visitor who glanced at one
/// page and left from one who stayed and moved through the app.
/// </summary>
public static class GetPageViewSessions
{
    /// <summary>Materializing more sessions than this in memory is refused; narrow the window instead.</summary>
    private const int MaxSessionsAnalyzed = 50_000;

    public sealed record QueryRequest(
        int Days = 7,
        string? Outcome = null,
        int? MinPages = null,
        bool IncludeBots = false,
        string? SortBy = null,
        int Page = 1,
        int PageSize = 25,
        int LandingPagesLimit = 10,
        bool IncludeInternal = false,
        Guid? UserId = null,
        string? SessionId = null,
        string? VisitorId = null);

    /// <summary>Longest session id accepted by the filter; mirrors the tracker's own limit.</summary>
    public const int MaxSessionIdLength = 128;

    public sealed class QueryValidator : AbstractValidator<QueryRequest>
    {
        public QueryValidator()
        {
            RuleFor(request => request.SessionId)
                .Must(sessionId => sessionId is null || sessionId.Trim().Length <= MaxSessionIdLength)
                .WithMessage($"SessionId must be at most {MaxSessionIdLength} characters.");

            RuleFor(request => request.VisitorId)
                .Must(visitorId => string.IsNullOrWhiteSpace(visitorId) || Guid.TryParse(visitorId.Trim(), out _))
                .WithMessage("VisitorId must be a GUID.");
        }
    }

    public sealed record Response(
        SummaryResponse Summary,
        List<DepthBucketResponse> DepthBuckets,
        List<LandingPageResponse> LandingPages,
        List<SessionResponse> Sessions,
        int TotalCount,
        int Page,
        int PageSize,
        int TotalPages,
        VisitorCohortReport.Response Visitors);

    public sealed record SummaryResponse(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int TotalSessions,
        int TotalPageHits,
        int BouncedSessions,
        double BounceRatePercent,
        int EngagedSessions,
        double AvgPagesPerSession,
        double AvgDurationSecondsEngaged,
        double MedianDurationSecondsEngaged,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        List<OutcomeStatsResponse> ByOutcome,
        int StudySessions,
        double AvgItemStepsPerStudySession);

    public sealed record OutcomeStatsResponse(
        string Outcome,
        int Sessions,
        int BouncedSessions,
        double BounceRatePercent,
        int EngagedSessions,
        double AvgPagesPerSession);

    public sealed record DepthBucketResponse(
        string Label,
        int TotalSessions,
        int AnonymousSessions,
        int ConvertedSessions,
        int AuthenticatedSessions);

    /// <summary>Landing sessions grouped by the entry hit's feature area and content scope (ANALYTICS-004).</summary>
    /// <param name="Path">The most common entry path in the group, as an example.</param>
    public sealed record LandingPageResponse(
        string Path,
        int Sessions,
        int BouncedSessions,
        double BounceRatePercent,
        double AvgPagesPerSession,
        string Area,
        string? ScopeType,
        string? ScopeKey);

    public sealed record SessionResponse(
        string SessionId,
        string Outcome,
        DateTime StartedUtc,
        DateTime EndedUtc,
        int PageHits,
        int DistinctPages,
        int DurationSeconds,
        bool IsBounce,
        string EntryPath,
        string ExitPath,
        string IpAddress,
        string? Country,
        string? UserEmail,
        string? UserAgent,
        bool IsBot,
        bool IsInternal,
        string EntryArea,
        int ItemSteps,
        string? VisitorId,
        string VisitorType,
        int SessionsFromVisitor,
        string? Channel,
        int GamesPlayed,
        int GamesCompleted,
        int QuizRuns,
        int QuizzesCompleted,
        string? Region,
        string? City);

    public const string VisitorTypeNew = "new";
    public const string VisitorTypeReturning = "returning";
    public const string VisitorTypeUnknown = "unknown";

    private enum OutcomeFilter
    {
        All,
        Anonymous,
        Converted,
        Authenticated
    }

    private enum SessionSort
    {
        Recent,
        Pages,
        Duration
    }

    public const string OutcomeAnonymous = SessionClassifier.OutcomeAnonymous;
    public const string OutcomeConverted = SessionClassifier.OutcomeConverted;
    public const string OutcomeAuthenticated = SessionClassifier.OutcomeAuthenticated;

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/page-view-sessions", Handler)
                .WithTags("Admin")
                .WithSummary("Get session-level page-view engagement (Admin only)")
                .WithDescription("Groups page hits into sessions and reports bounce rate, session depth, study activity (sessions with a Quiz or Flashcards question view), landing pages grouped by feature area and content scope, and per-session journeys split by anonymous, converted, and authenticated visitors. Internal sessions are excluded unless includeInternal=true. Optional sessionId (max 128 characters) and visitorId (GUID) narrow the window to one session or to the sessions of one visitor; each session row also carries visitor type, channel, and game and quiz counts.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
            string? outcome = null,
            int? minPages = null,
            bool includeBots = false,
            string? sortBy = null,
            int page = 1,
            int pageSize = 25,
            int landingPagesLimit = 10,
            bool includeInternal = false,
            Guid? userId = null,
            string? sessionId = null,
            string? visitorId = null,
            ApplicationDbContext db = null!,
            IIpGeolocationService geoService = null!,
            CancellationToken cancellationToken = default)
        {
            QueryRequest request = new(days, outcome, minPages, includeBots, sortBy, page, pageSize, landingPagesLimit, includeInternal, userId, sessionId, visitorId);
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
                    "Admin.PageViewSessions.InvalidDays",
                    $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Raw page hits are kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        FluentValidation.Results.ValidationResult validation = new QueryValidator().Validate(request);
        if (!validation.IsValid)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.PageViewSessions.InvalidFilter", validation.Errors[0].ErrorMessage));
        }

        OutcomeFilter outcomeFilter;
        SessionSort sort;
        try
        {
            outcomeFilter = ParseOutcomeFilter(request.Outcome);
            sort = ParseSort(request.SortBy);
        }
        catch (ArgumentException ex)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.PageViewSessions.InvalidFilter", ex.Message));
        }

        int page = Math.Max(1, request.Page);
        int pageSize = Math.Clamp(request.PageSize, 1, 100);
        int landingPagesLimit = Math.Clamp(request.LandingPagesLimit, 1, 25);
        int minPages = Math.Clamp(request.MinPages ?? 1, 1, 100);

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<PageView> windowQuery = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= windowStartUtc && pageView.CreatedUtc <= windowEndUtc);

        // A user filter keeps every hit of the sessions the user took part in (user detail view).
        if (request.UserId is Guid filterUserId)
        {
            IQueryable<string> userSessionIds = db.PageViews
                .Where(pageView => pageView.UserId == filterUserId)
                .Select(pageView => pageView.SessionId);
            windowQuery = windowQuery.Where(pageView => userSessionIds.Contains(pageView.SessionId));
        }

        // A session filter narrows to exactly one session id (admin deep link and "filter to this session").
        string? sessionIdFilter = string.IsNullOrWhiteSpace(request.SessionId) ? null : request.SessionId.Trim();
        if (sessionIdFilter is not null)
        {
            windowQuery = windowQuery.Where(pageView => pageView.SessionId == sessionIdFilter);
        }

        // A visitor filter keeps the sessions the stored visitor id snapshot links together. Only the
        // opaque visitor id is used; never IP, user agent or a fingerprint.
        string? visitorIdFilter = string.IsNullOrWhiteSpace(request.VisitorId)
            ? null
            : Guid.Parse(request.VisitorId.Trim()).ToString();
        if (visitorIdFilter is not null)
        {
            IQueryable<string> visitorSessionIds = db.AnalyticsSessions
                .Where(session => session.VisitorId == visitorIdFilter)
                .Select(session => session.SessionId);
            windowQuery = windowQuery.Where(pageView => visitorSessionIds.Contains(pageView.SessionId));
        }

        // Bot sessions are reported even when excluded: the gap between the two numbers is
        // usually the explanation for anonymous traffic looking like one-off page checks.
        int botSessions = await windowQuery
            .Where(pageView => pageView.IsBot)
            .Select(pageView => pageView.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        // Internal sessions (admins, flagged users, marked browsers) are counted like bots so the
        // excluded share stays visible; the id list is small and also flags rows when included.
        HashSet<string> internalSessionIds = (await InternalTrafficFilter.InternalSessionIds(db, windowQuery)
            .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        IQueryable<PageView> baseQuery = request.IncludeBots
            ? windowQuery
            : windowQuery.Where(pageView => !pageView.IsBot);

        if (!request.IncludeInternal)
        {
            baseQuery = InternalTrafficFilter.ExcludeInternalSessions(db, baseQuery);
        }

        int sessionCount = await baseQuery
            .Select(pageView => pageView.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        if (sessionCount > MaxSessionsAnalyzed)
        {
            return Result.Failure<Response>(
                Error.Validation(
                    "Admin.PageViewSessions.WindowTooLarge",
                    $"The selected window contains {sessionCount} sessions, which exceeds the {MaxSessionsAnalyzed} session analysis limit. Select a shorter time range."));
        }

        // Shared with GetAcquisitionReport so bounce/engaged/outcome numbers can never disagree
        // between the two reports for the same window and exclusions.
        List<SessionClassifier.ClassifiedSession> sessions = await SessionClassifier.ClassifyAsync(baseQuery, cancellationToken);

        SummaryResponse summary = BuildSummary(
            windowStartUtc,
            windowEndUtc,
            sessions,
            botSessions,
            botsExcluded: !request.IncludeBots,
            internalSessions: internalSessionIds.Count,
            internalExcluded: !request.IncludeInternal);

        List<DepthBucketResponse> depthBuckets = BuildDepthBuckets(sessions);
        List<LandingPageResponse> landingPages = BuildLandingPages(sessions, landingPagesLimit);

        // Outcome and minPages narrow the session list only; the summary, histogram, and
        // landing pages always describe the whole window so the denominators stay stable.
        List<SessionClassifier.ClassifiedSession> filtered = sessions
            .Where(session => outcomeFilter switch
            {
                OutcomeFilter.Anonymous => session.Outcome == OutcomeAnonymous,
                OutcomeFilter.Converted => session.Outcome == OutcomeConverted,
                OutcomeFilter.Authenticated => session.Outcome == OutcomeAuthenticated,
                _ => true
            })
            .Where(session => session.PageHits >= minPages)
            .ToList();

        filtered = sort switch
        {
            SessionSort.Pages => filtered
                .OrderByDescending(session => session.PageHits)
                .ThenByDescending(session => session.StartedUtc)
                .ToList(),
            SessionSort.Duration => filtered
                .OrderByDescending(session => session.DurationSeconds)
                .ThenByDescending(session => session.StartedUtc)
                .ToList(),
            _ => filtered
                .OrderByDescending(session => session.StartedUtc)
                .ThenBy(session => session.SessionId, StringComparer.Ordinal)
                .ToList()
        };

        int totalCount = filtered.Count;
        int totalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize);
        List<SessionClassifier.ClassifiedSession> pageRows = filtered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        // Resolve emails and countries for the visible page only.
        List<Guid> userIds = pageRows
            .Where(session => session.UserId.HasValue)
            .Select(session => session.UserId!.Value)
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

        List<string> uniqueIps = pageRows.Select(session => session.IpAddress).Distinct().ToList();
        Dictionary<string, string?> countryByIp = (await Task.WhenAll(
            uniqueIps.Select(async ip => (ip, country: await geoService.GetCountryAsync(ip, cancellationToken)))))
            .ToDictionary(entry => entry.ip, entry => entry.country);

        List<string> pageSessionIds = pageRows.Select(session => session.SessionId).ToList();

        Dictionary<string, SessionSnapshot> snapshots = (await db.AnalyticsSessions
                .AsNoTracking()
                .Where(snapshot => pageSessionIds.Contains(snapshot.SessionId))
                .Select(snapshot => new SessionSnapshot(snapshot.SessionId, snapshot.VisitorId, snapshot.Channel, snapshot.Country, snapshot.FirstSeenUtc, snapshot.Region, snapshot.City))
                .ToListAsync(cancellationToken))
            .GroupBy(snapshot => snapshot.SessionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        List<string> visitorIds = snapshots.Values
            .Where(snapshot => snapshot.VisitorId != null)
            .Select(snapshot => snapshot.VisitorId!)
            .Distinct()
            .ToList();

        // Retained snapshots per visitor (page is bounded), used for new/returning and the sessions link.
        Dictionary<string, List<SessionSnapshot>> sessionsByVisitor = visitorIds.Count == 0
            ? new Dictionary<string, List<SessionSnapshot>>(StringComparer.Ordinal)
            : (await db.AnalyticsSessions
                    .AsNoTracking()
                    .Where(snapshot => snapshot.VisitorId != null && visitorIds.Contains(snapshot.VisitorId))
                    .Select(snapshot => new SessionSnapshot(snapshot.SessionId, snapshot.VisitorId, snapshot.Channel, snapshot.Country, snapshot.FirstSeenUtc))
                    .ToListAsync(cancellationToken))
                .GroupBy(snapshot => snapshot.VisitorId!, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.OrderBy(snapshot => snapshot.FirstSeenUtc).ThenBy(snapshot => snapshot.SessionId, StringComparer.Ordinal).ToList(),
                    StringComparer.Ordinal);

        Dictionary<string, List<SessionActivityBuilder.Activity>> activitiesBySession =
            await SessionActivityBuilder.LoadAsync(db, pageSessionIds, cancellationToken);

        List<SessionResponse> sessionResponses = pageRows
            .Select(session =>
            {
                snapshots.TryGetValue(session.SessionId, out SessionSnapshot? snapshot);
                string? visitorId = snapshot?.VisitorId;
                List<SessionSnapshot>? visitorSessions = visitorId is not null && sessionsByVisitor.TryGetValue(visitorId, out List<SessionSnapshot>? list)
                    ? list
                    : null;
                string visitorType = visitorSessions is null
                    ? VisitorTypeUnknown
                    : string.Equals(visitorSessions[0].SessionId, session.SessionId, StringComparison.Ordinal)
                        ? VisitorTypeNew
                        : VisitorTypeReturning;
                SessionActivityBuilder.Counts counts = activitiesBySession.TryGetValue(session.SessionId, out List<SessionActivityBuilder.Activity>? activities)
                    ? SessionActivityBuilder.Count(activities)
                    : SessionActivityBuilder.NoActivity;

                return new SessionResponse(
                session.SessionId,
                session.Outcome,
                session.StartedUtc,
                session.EndedUtc,
                session.PageHits,
                session.DistinctPages,
                session.DurationSeconds,
                session.IsBounce,
                session.EntryPath,
                session.ExitPath,
                IpTruncation.Truncate(session.IpAddress),
                snapshot?.Country ?? countryByIp.GetValueOrDefault(session.IpAddress),
                session.UserId.HasValue && userEmails.TryGetValue(session.UserId.Value, out string? email)
                    ? email
                    : null,
                session.UserAgent,
                session.IsBot,
                internalSessionIds.Contains(session.SessionId),
                session.EntryArea,
                session.ItemSteps,
                visitorId,
                visitorType,
                visitorSessions?.Count ?? 0,
                snapshot?.Channel,
                counts.GamesPlayed,
                counts.GamesCompleted,
                counts.QuizRuns,
                counts.QuizzesCompleted,
                snapshot?.Region,
                snapshot?.City);
            })
            .ToList();

        VisitorCohortReport.Response visitors = await VisitorCohortReport.BuildAsync(
            db, windowStartUtc, windowEndUtc, request.IncludeBots, request.IncludeInternal, cancellationToken);

        return Result.Success(new Response(
            summary,
            depthBuckets,
            landingPages,
            sessionResponses,
            totalCount,
            page,
            pageSize,
            totalPages,
            visitors));
    }

    private sealed record SessionSnapshot(string SessionId, string? VisitorId, string Channel, string? Country, DateTime FirstSeenUtc, string? Region = null, string? City = null);

    private static SummaryResponse BuildSummary(
        DateTime windowStartUtc,
        DateTime windowEndUtc,
        List<SessionClassifier.ClassifiedSession> sessions,
        int botSessions,
        bool botsExcluded,
        int internalSessions,
        bool internalExcluded)
    {
        int totalSessions = sessions.Count;
        int totalPageHits = sessions.Sum(session => session.PageHits);
        int bounced = sessions.Count(session => session.PageHits == 1);
        int engaged = sessions.Count(session => session.DistinctPages >= 2);

        // Bounces always have a zero duration (there is no exit event), so including them
        // would drag the average toward zero and hide real dwell time.
        List<int> engagedDurations = sessions
            .Where(session => session.PageHits > 1)
            .Select(session => session.DurationSeconds)
            .OrderBy(seconds => seconds)
            .ToList();

        List<SessionClassifier.ClassifiedSession> studySessions = sessions
            .Where(session => session.HasStudyActivity)
            .ToList();

        List<OutcomeStatsResponse> byOutcome = new[] { OutcomeAnonymous, OutcomeConverted, OutcomeAuthenticated }
            .Select(outcome =>
            {
                List<SessionClassifier.ClassifiedSession> group = sessions.Where(session => session.Outcome == outcome).ToList();
                int groupBounced = group.Count(session => session.PageHits == 1);

                return new OutcomeStatsResponse(
                    outcome,
                    group.Count,
                    groupBounced,
                    Percent(groupBounced, group.Count),
                    group.Count(session => session.DistinctPages >= 2),
                    group.Count == 0 ? 0 : Math.Round(group.Average(session => session.PageHits), 2));
            })
            .ToList();

        return new SummaryResponse(
            WindowStartUtc: windowStartUtc,
            WindowEndUtc: windowEndUtc,
            TotalSessions: totalSessions,
            TotalPageHits: totalPageHits,
            BouncedSessions: bounced,
            BounceRatePercent: Percent(bounced, totalSessions),
            EngagedSessions: engaged,
            AvgPagesPerSession: totalSessions == 0 ? 0 : Math.Round(totalPageHits / (double)totalSessions, 2),
            AvgDurationSecondsEngaged: engagedDurations.Count == 0 ? 0 : Math.Round(engagedDurations.Average(), 1),
            MedianDurationSecondsEngaged: Median(engagedDurations),
            BotSessions: botSessions,
            BotsExcluded: botsExcluded,
            InternalSessions: internalSessions,
            InternalExcluded: internalExcluded,
            ByOutcome: byOutcome,
            StudySessions: studySessions.Count,
            AvgItemStepsPerStudySession: studySessions.Count == 0
                ? 0
                : Math.Round(studySessions.Average(session => session.ItemSteps), 2));
    }

    private static List<DepthBucketResponse> BuildDepthBuckets(List<SessionClassifier.ClassifiedSession> sessions)
    {
        (string Label, int Min, int Max)[] buckets =
        [
            ("1 page", 1, 1),
            ("2 pages", 2, 2),
            ("3-5 pages", 3, 5),
            ("6-10 pages", 6, 10),
            ("11+ pages", 11, int.MaxValue)
        ];

        return buckets
            .Select(bucket =>
            {
                List<SessionClassifier.ClassifiedSession> group = sessions
                    .Where(session => session.PageHits >= bucket.Min && session.PageHits <= bucket.Max)
                    .ToList();

                return new DepthBucketResponse(
                    bucket.Label,
                    group.Count,
                    group.Count(session => session.Outcome == OutcomeAnonymous),
                    group.Count(session => session.Outcome == OutcomeConverted),
                    group.Count(session => session.Outcome == OutcomeAuthenticated));
            })
            .ToList();
    }

    private static List<LandingPageResponse> BuildLandingPages(List<SessionClassifier.ClassifiedSession> sessions, int limit)
    {
        return sessions
            .GroupBy(session => (session.EntryArea, session.EntryScopeType, session.EntryScopeKey))
            .Select(group =>
            {
                int bounced = group.Count(session => session.PageHits == 1);
                string examplePath = group
                    .GroupBy(session => session.EntryPath, StringComparer.Ordinal)
                    .OrderByDescending(paths => paths.Count())
                    .ThenBy(paths => paths.Key, StringComparer.Ordinal)
                    .First()
                    .Key;

                return new LandingPageResponse(
                    examplePath,
                    group.Count(),
                    bounced,
                    Percent(bounced, group.Count()),
                    Math.Round(group.Average(session => session.PageHits), 2),
                    group.Key.EntryArea,
                    group.Key.EntryScopeType,
                    group.Key.EntryScopeKey);
            })
            .OrderByDescending(landing => landing.Sessions)
            .ThenBy(landing => landing.Area, StringComparer.Ordinal)
            .ThenBy(landing => landing.ScopeKey, StringComparer.Ordinal)
            .Take(limit)
            .ToList();
    }

    private static double Percent(int part, int total)
    {
        return total == 0 ? 0 : Math.Round(part * 100.0 / total, 1);
    }

    private static double Median(List<int> sortedValues)
    {
        if (sortedValues.Count == 0)
        {
            return 0;
        }

        int middle = sortedValues.Count / 2;

        return sortedValues.Count % 2 == 1
            ? sortedValues[middle]
            : Math.Round((sortedValues[middle - 1] + sortedValues[middle]) / 2.0, 1);
    }

    private static OutcomeFilter ParseOutcomeFilter(string? outcome)
    {
        if (string.IsNullOrWhiteSpace(outcome))
        {
            return OutcomeFilter.All;
        }

        return outcome.Trim().ToLowerInvariant() switch
        {
            "all" => OutcomeFilter.All,
            OutcomeAnonymous => OutcomeFilter.Anonymous,
            OutcomeConverted => OutcomeFilter.Converted,
            OutcomeAuthenticated => OutcomeFilter.Authenticated,
            _ => throw new ArgumentException("Outcome must be one of: all, anonymous, converted, authenticated.")
        };
    }

    private static SessionSort ParseSort(string? sortBy)
    {
        if (string.IsNullOrWhiteSpace(sortBy))
        {
            return SessionSort.Recent;
        }

        return sortBy.Trim().ToLowerInvariant() switch
        {
            "recent" => SessionSort.Recent,
            "pages" => SessionSort.Pages,
            "duration" => SessionSort.Duration,
            _ => throw new ArgumentException("SortBy must be one of: recent, pages, duration.")
        };
    }
}
