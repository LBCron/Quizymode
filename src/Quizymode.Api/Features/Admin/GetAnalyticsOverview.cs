using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// One-screen admin overview (ANALYTICS-005): KPIs for the window and the equal-length previous window,
/// a zero-filled UTC daily series, release markers, and work-queue counts. Windows are whole UTC days
/// ending with today. Bots and internal sessions are always excluded. Session numbers come from the
/// shared <see cref="SessionClassifier"/> so they match the Sessions and Acquisition reports.
/// </summary>
public static class GetAnalyticsOverview
{
    private static readonly int[] AllowedDays = [7, 30, 90];

    public sealed record QueryRequest(int Days = 7);

    /// <param name="NewVisitors">Distinct first-time visitors (ANALYTICS-003).</param>
    /// <param name="ReturningVisitors">Distinct returning visitors (ANALYTICS-003).</param>
    public sealed record Kpis(
        int HumanSessions,
        int EngagedSessions,
        int StudySessions,
        int ConvertedSessions,
        int NewSignups,
        int ActiveRegisteredUsers,
        int? NewVisitors,
        int? ReturningVisitors);

    public sealed record DailyPoint(
        DateOnly Day,
        int HumanSessions,
        int EngagedSessions,
        int StudySessions,
        int ConvertedSessions,
        int NewSignups,
        int ActiveRegisteredUsers);

    /// <param name="Day">First UTC day the version appeared in non-internal, non-bot traffic.</param>
    public sealed record ReleaseMarker(string Version, DateOnly Day);

    /// <param name="NewClientErrorGroups">Front-end error groups first seen in the window, bots and internal traffic excluded (OBS-001).</param>
    public sealed record WorkQueue(
        int ItemsAwaitingReview,
        int PendingPrivateKeywords,
        int IdeasAwaitingModeration,
        int NewClientErrorGroups,
        int PicturesAwaitingReview = 0,
        DateTime? OldestPictureSubmittedAt = null);

    public sealed record Response(
        int Days,
        DateOnly WindowStartDay,
        DateOnly WindowEndDay,
        Kpis Current,
        Kpis Previous,
        List<DailyPoint> Daily,
        List<ReleaseMarker> ReleaseMarkers,
        WorkQueue WorkQueue);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/overview", Handler)
                .WithTags("Admin")
                .WithSummary("Get the admin overview with KPIs, daily trends, release markers, and work queue counts (Admin only)")
                .WithDescription("days must be 7, 30, or 90. Returns KPIs for the window and the previous window of equal length, a zero-filled UTC daily series, release markers (first UTC day each app version appeared), and moderation work-queue counts. Bot and internal traffic is always excluded.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            Result<Response> result = await HandleAsync(new QueryRequest(days), db, DateTime.UtcNow, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        if (!AllowedDays.Contains(request.Days))
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.AnalyticsOverview.InvalidDays", "Days must be 7, 30, or 90."));
        }

        DateTime windowEndExclusive = nowUtc.Date.AddDays(1);
        DateTime windowStart = windowEndExclusive.AddDays(-request.Days);
        DateTime previousStart = windowStart.AddDays(-request.Days);

        List<SessionClassifier.ClassifiedSession> current = await ClassifyWindowAsync(db, windowStart, windowEndExclusive, cancellationToken);
        List<SessionClassifier.ClassifiedSession> previous = await ClassifyWindowAsync(db, previousStart, windowStart, cancellationToken);

        List<DateTime> signupTimes = await db.Users
            .AsNoTracking()
            .Where(user => !user.IsInternal && user.CreatedAt >= previousStart && user.CreatedAt < windowEndExclusive)
            .Select(user => user.CreatedAt)
            .ToListAsync(cancellationToken);

        // Cohort rows are all-time and independent of the window, so load them once for both windows.
        List<VisitorCohortReport.CohortRow> cohortRows = await VisitorCohortReport.LoadRowsAsync(
            db, false, false, cancellationToken);
        VisitorCohortReport.Response currentVisitors = await VisitorCohortReport.BuildAsync(
            db, cohortRows, windowStart, windowEndExclusive.AddTicks(-1), cancellationToken);
        VisitorCohortReport.Response previousVisitors = await VisitorCohortReport.BuildAsync(
            db, cohortRows, previousStart, windowStart.AddTicks(-1), cancellationToken);

        Kpis currentKpis = BuildKpis(
            current,
            signupTimes.Count(time => time >= windowStart),
            currentVisitors.NewVisitors,
            currentVisitors.ReturningVisitors);
        Kpis previousKpis = BuildKpis(
            previous,
            signupTimes.Count(time => time < windowStart),
            previousVisitors.NewVisitors,
            previousVisitors.ReturningVisitors);

        List<DailyPoint> daily = BuildDaily(current, signupTimes, windowStart, request.Days);

        List<ReleaseMarker> markers = await BuildReleaseMarkersAsync(db, windowStart, windowEndExclusive, cancellationToken);

        Result<GetClientErrors.Response> clientErrors = await GetClientErrors.HandleAsync(
            new GetClientErrors.QueryRequest(request.Days), db, cancellationToken);

        int picturesAwaiting = await db.Items.CountAsync(
            item => item.ImageReviewState == ItemImageReviewState.PendingReview, cancellationToken);
        DateTime? oldestPictureSubmittedAt = picturesAwaiting == 0
            ? null
            : await (from review in db.ItemImageReviews
                     join item in db.Items on review.ItemId equals item.Id
                     where item.ImageReviewState == ItemImageReviewState.PendingReview && review.Revision == item.ImageRevision
                     select (DateTime?)review.SubmittedAt).MinAsync(cancellationToken);

        WorkQueue workQueue = new(
            await db.Items.CountAsync(item => item.ReadyForReview, cancellationToken),
            await db.Keywords.CountAsync(
                keyword => keyword.IsPrivate && keyword.IsReviewPending
                    && db.ItemKeywords.Any(itemKeyword => itemKeyword.KeywordId == keyword.Id),
                cancellationToken),
            await db.Ideas.CountAsync(idea => idea.ModerationState == IdeaModerationState.PendingReview, cancellationToken),
            clientErrors.IsSuccess ? clientErrors.Value.NewGroups : 0,
            picturesAwaiting,
            oldestPictureSubmittedAt);

        return Result.Success(new Response(
            request.Days,
            DateOnly.FromDateTime(windowStart),
            DateOnly.FromDateTime(windowEndExclusive.AddDays(-1)),
            currentKpis,
            previousKpis,
            daily,
            markers,
            workQueue));
    }

    private static async Task<List<SessionClassifier.ClassifiedSession>> ClassifyWindowAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        IQueryable<PageView> scope = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= startUtc && pageView.CreatedUtc < endExclusiveUtc && !pageView.IsBot);
        scope = InternalTrafficFilter.ExcludeInternalSessions(db, scope);

        return await SessionClassifier.ClassifyAsync(scope, cancellationToken);
    }

    internal static Kpis BuildKpis(
        List<SessionClassifier.ClassifiedSession> sessions,
        int signups,
        int? newVisitors,
        int? returningVisitors)
    {
        return new Kpis(
            sessions.Count,
            sessions.Count(session => session.IsEngaged),
            sessions.Count(session => session.HasStudyActivity),
            sessions.Count(session => session.Outcome == SessionClassifier.OutcomeConverted),
            signups,
            sessions.Where(session => session.UserId.HasValue).Select(session => session.UserId!.Value).Distinct().Count(),
            newVisitors,
            returningVisitors);
    }

    /// <summary>One point per UTC day of the window, including days with no activity.</summary>
    internal static List<DailyPoint> BuildDaily(
        List<SessionClassifier.ClassifiedSession> sessions,
        List<DateTime> signupTimes,
        DateTime windowStart,
        int days)
    {
        Dictionary<DateTime, List<SessionClassifier.ClassifiedSession>> sessionsByDay = sessions
            .GroupBy(session => session.StartedUtc.Date)
            .ToDictionary(group => group.Key, group => group.ToList());
        Dictionary<DateTime, int> signupsByDay = signupTimes
            .Where(time => time >= windowStart)
            .GroupBy(time => time.Date)
            .ToDictionary(group => group.Key, group => group.Count());

        List<DailyPoint> points = [];
        for (int offset = 0; offset < days; offset++)
        {
            DateTime day = windowStart.AddDays(offset);
            List<SessionClassifier.ClassifiedSession> daySessions =
                sessionsByDay.TryGetValue(day, out List<SessionClassifier.ClassifiedSession>? found) ? found : [];
            points.Add(new DailyPoint(
                DateOnly.FromDateTime(day),
                daySessions.Count,
                daySessions.Count(session => session.IsEngaged),
                daySessions.Count(session => session.HasStudyActivity),
                daySessions.Count(session => session.Outcome == SessionClassifier.OutcomeConverted),
                signupsByDay.TryGetValue(day, out int signups) ? signups : 0,
                daySessions.Where(session => session.UserId.HasValue).Select(session => session.UserId!.Value).Distinct().Count()));
        }

        return points;
    }

    private static async Task<List<ReleaseMarker>> BuildReleaseMarkersAsync(
        ApplicationDbContext db,
        DateTime windowStart,
        DateTime windowEndExclusive,
        CancellationToken cancellationToken)
    {
        IQueryable<string> internalSessionIds = InternalTrafficFilter.AllInternalSessionIds(db);

        var firstSeen = await db.AnalyticsSessions
            .AsNoTracking()
            // Non-null predicate: see InternalTrafficFilter.ExcludeInternalSessions.
            .Where(session => session.AppVersion != null
                && !internalSessionIds.Any(sessionId => sessionId == session.SessionId && session.SessionId != null)
                && !db.PageViews.Any(pageView => pageView.SessionId == session.SessionId && pageView.IsBot))
            .GroupBy(session => session.AppVersion!)
            .Select(group => new { Version = group.Key, FirstSeenUtc = group.Min(session => session.FirstSeenUtc) })
            .ToListAsync(cancellationToken);

        return ComputeReleaseMarkers(
            firstSeen.Select(row => (row.Version, row.FirstSeenUtc)),
            windowStart,
            windowEndExclusive);
    }

    /// <summary>A marker sits on the first UTC day a version appeared, kept only when that day is inside the window.</summary>
    internal static List<ReleaseMarker> ComputeReleaseMarkers(
        IEnumerable<(string Version, DateTime FirstSeenUtc)> firstSeenByVersion,
        DateTime windowStart,
        DateTime windowEndExclusive)
    {
        return firstSeenByVersion
            .Where(row => row.FirstSeenUtc >= windowStart && row.FirstSeenUtc < windowEndExclusive)
            .OrderBy(row => row.FirstSeenUtc)
            .Select(row => new ReleaseMarker(row.Version, DateOnly.FromDateTime(row.FirstSeenUtc)))
            .ToList();
    }
}
