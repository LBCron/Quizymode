using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Registered-user lifecycle (ANALYTICS-010): weekly signup cohorts with 7-day activation and week 1, 2, and 4
/// retention, plus signup-source attribution. Internal users are excluded.
/// </summary>
/// <remarks>
/// Activation is a completed quiz (<c>quiz_completed</c>) by the user within 7 days of signup. "Active in week N"
/// means at least one page view on a UTC day in <c>[signupDay + 7N, signupDay + 7N + 7)</c>; week 0 is the signup week.
/// A user counts toward a week's eligible total only once that whole 7-day window has ended.
/// </remarks>
public static class GetLifecycleReport
{
    public const string UnknownChannel = "unknown";

    /// <summary>Largest week count whose window stays inside the retention period.</summary>
    public const int MaxWeeks = Quizymode.Api.Services.PageViewRetentionService.RetentionDays / 7;

    public sealed record QueryRequest(int Weeks = 12);

    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int TotalSignups,
        List<CohortResponse> Cohorts,
        List<SourceResponse> Sources);

    /// <param name="WeekStartUtc">Monday of the signup week.</param>
    /// <param name="Activated7Days">Users with a completed quiz within 7 days of signup.</param>
    /// <param name="ActivatedEligible">Users whose 7-day activation window has ended.</param>
    public sealed record CohortResponse(
        DateTime WeekStartUtc,
        int Signups,
        int Activated7Days,
        int ActivatedEligible,
        int ActiveWeek1,
        int EligibleWeek1,
        int ActiveWeek2,
        int EligibleWeek2,
        int ActiveWeek4,
        int EligibleWeek4);

    public sealed record SourceResponse(
        string Channel,
        string? Campaign,
        int Signups,
        int Activated7Days,
        int ActivatedEligible,
        int ActiveWeek1,
        int EligibleWeek1);

    public sealed record SignupSource(string Channel, string? Campaign);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/lifecycle", Handler)
                .WithTags("Admin")
                .WithSummary("Get registered-user lifecycle cohorts (Admin only)")
                .WithDescription("Returns weekly signup cohorts with 7-day activation and week 1, 2, and 4 retention, plus signup-source attribution by first-touch channel and campaign. Internal users are excluded.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int weeks = 12,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            Result<Response> result = await HandleAsync(new QueryRequest(weeks), db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Weeks is < 1 or > MaxWeeks)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.Lifecycle.InvalidWeeks", $"Weeks must be between 1 and {MaxWeeks} ({Quizymode.Api.Services.PageViewRetentionService.RetentionDays} days of retained engagement data)."));
        }

        DateTime nowUtc = DateTime.UtcNow;
        DateTime currentWeek = WeekStart(nowUtc);
        DateTime windowStartUtc = currentWeek.AddDays(-7 * (request.Weeks - 1));

        var users = await db.Users.AsNoTracking()
            .Where(user => !user.IsInternal && user.CreatedAt >= windowStartUtc)
            .Select(user => new { user.Id, user.CreatedAt })
            .ToListAsync(cancellationToken);
        List<Guid> userIds = users.Select(user => user.Id).ToList();

        Dictionary<Guid, List<DateTime>> completions = [];
        Dictionary<Guid, HashSet<DateTime>> activeDays = [];
        Dictionary<Guid, SignupSource> sources = [];
        if (userIds.Count > 0)
        {
            foreach (var row in await db.AnalyticsEvents.AsNoTracking()
                         .Where(analyticsEvent =>
                             analyticsEvent.EventName == AnalyticsEventCatalog.QuizCompleted &&
                             !analyticsEvent.IsBot &&
                             analyticsEvent.UserId != null &&
                             userIds.Contains(analyticsEvent.UserId.Value))
                         .Select(analyticsEvent => new { UserId = analyticsEvent.UserId!.Value, analyticsEvent.OccurredUtc })
                         .ToListAsync(cancellationToken))
            {
                if (!completions.TryGetValue(row.UserId, out List<DateTime>? times))
                {
                    times = [];
                    completions[row.UserId] = times;
                }

                times.Add(row.OccurredUtc);
            }

            foreach (var row in await db.PageViews.AsNoTracking()
                         .Where(pageView => !pageView.IsBot && pageView.UserId != null && userIds.Contains(pageView.UserId.Value))
                         .Select(pageView => new { UserId = pageView.UserId!.Value, Day = pageView.CreatedUtc.Date })
                         .Distinct()
                         .ToListAsync(cancellationToken))
            {
                if (!activeDays.TryGetValue(row.UserId, out HashSet<DateTime>? days))
                {
                    days = [];
                    activeDays[row.UserId] = days;
                }

                days.Add(DateTime.SpecifyKind(row.Day, DateTimeKind.Utc));
            }

            sources = await ResolveSignupSourcesAsync(db, userIds, cancellationToken);
        }

        List<UserLifecycle> lifecycles = users
            .Select(user => Evaluate(user.Id, user.CreatedAt, nowUtc, completions, activeDays, sources))
            .ToList();

        List<CohortResponse> cohorts = lifecycles
            .GroupBy(lifecycle => WeekStart(lifecycle.CreatedAt))
            .OrderBy(group => group.Key)
            .Select(group => new CohortResponse(
                group.Key,
                group.Count(),
                group.Count(l => l.Activated),
                group.Count(l => l.ActivatedEligible),
                group.Count(l => l.ActiveWeek1),
                group.Count(l => l.EligibleWeek1),
                group.Count(l => l.ActiveWeek2),
                group.Count(l => l.EligibleWeek2),
                group.Count(l => l.ActiveWeek4),
                group.Count(l => l.EligibleWeek4)))
            .ToList();

        List<SourceResponse> sourceRows = lifecycles
            .GroupBy(l => (l.Source.Channel, l.Source.Campaign))
            .Select(group => new SourceResponse(
                group.Key.Channel,
                group.Key.Campaign,
                group.Count(),
                group.Count(l => l.Activated),
                group.Count(l => l.ActivatedEligible),
                group.Count(l => l.ActiveWeek1),
                group.Count(l => l.EligibleWeek1)))
            .OrderByDescending(row => row.Signups)
            .ThenBy(row => row.Channel, StringComparer.Ordinal)
            .ThenBy(row => row.Campaign, StringComparer.Ordinal)
            .ToList();

        return Result.Success(new Response(windowStartUtc, nowUtc, lifecycles.Count, cohorts, sourceRows));
    }

    /// <summary>
    /// First-touch channel and campaign of the visitor each user signed up as: the earliest session of the visitor id
    /// carried by the user's sessions, falling back to the user's own earliest session when no visitor id is known.
    /// </summary>
    public static async Task<Dictionary<Guid, SignupSource>> ResolveSignupSourcesAsync(
        ApplicationDbContext db,
        List<Guid> userIds,
        CancellationToken cancellationToken)
    {
        Dictionary<Guid, SignupSource> result = [];
        if (userIds.Count == 0)
        {
            return result;
        }

        var userSessions = await db.AnalyticsSessions.AsNoTracking()
            .Where(session => session.UserId != null && userIds.Contains(session.UserId.Value))
            .Select(session => new { UserId = session.UserId!.Value, session.VisitorId, session.FirstSeenUtc, session.Channel, session.UtmCampaign })
            .ToListAsync(cancellationToken);

        List<string> visitorIds = userSessions
            .Where(session => session.VisitorId != null)
            .Select(session => session.VisitorId!)
            .Distinct()
            .ToList();

        Dictionary<string, SignupSource> firstTouchByVisitor = [];
        if (visitorIds.Count > 0)
        {
            var visitorSessions = await db.AnalyticsSessions.AsNoTracking()
                .Where(session => session.VisitorId != null && visitorIds.Contains(session.VisitorId))
                .Select(session => new { VisitorId = session.VisitorId!, session.FirstSeenUtc, session.Channel, session.UtmCampaign })
                .ToListAsync(cancellationToken);
            firstTouchByVisitor = visitorSessions
                .GroupBy(session => session.VisitorId)
                .ToDictionary(
                    group => group.Key,
                    group =>
                    {
                        var first = group.OrderBy(session => session.FirstSeenUtc).First();
                        return new SignupSource(Normalize(first.Channel), first.UtmCampaign);
                    });
        }

        foreach (var group in userSessions.GroupBy(session => session.UserId))
        {
            var ordered = group.OrderBy(session => session.FirstSeenUtc).ToList();
            var withVisitor = ordered.FirstOrDefault(session => session.VisitorId != null && firstTouchByVisitor.ContainsKey(session.VisitorId));
            result[group.Key] = withVisitor is not null
                ? firstTouchByVisitor[withVisitor.VisitorId!]
                : new SignupSource(Normalize(ordered[0].Channel), ordered[0].UtmCampaign);
        }

        return result;
    }

    private static string Normalize(string? channel) => string.IsNullOrWhiteSpace(channel) ? UnknownChannel : channel;

    private sealed record UserLifecycle(
        DateTime CreatedAt,
        bool Activated,
        bool ActivatedEligible,
        bool ActiveWeek1,
        bool EligibleWeek1,
        bool ActiveWeek2,
        bool EligibleWeek2,
        bool ActiveWeek4,
        bool EligibleWeek4,
        SignupSource Source);

    private static UserLifecycle Evaluate(
        Guid userId,
        DateTime createdAt,
        DateTime nowUtc,
        Dictionary<Guid, List<DateTime>> completions,
        Dictionary<Guid, HashSet<DateTime>> activeDays,
        Dictionary<Guid, SignupSource> sources)
    {
        DateTime signupDay = createdAt.Date;
        bool activated = completions.TryGetValue(userId, out List<DateTime>? completedTimes) &&
                         completedTimes.Any(completedUtc => completedUtc >= createdAt && completedUtc < createdAt.AddDays(7));
        HashSet<DateTime> days = activeDays.GetValueOrDefault(userId) ?? [];

        bool Active(int week) => days.Any(day =>
            day >= DateTime.SpecifyKind(signupDay.AddDays(7 * week), DateTimeKind.Utc) &&
            day < DateTime.SpecifyKind(signupDay.AddDays((7 * week) + 7), DateTimeKind.Utc));
        bool Eligible(int week) => signupDay.AddDays((7 * week) + 7) <= nowUtc;

        return new UserLifecycle(
            createdAt,
            activated,
            createdAt.AddDays(7) <= nowUtc,
            Active(1), Eligible(1),
            Active(2), Eligible(2),
            Active(4), Eligible(4),
            sources.GetValueOrDefault(userId) ?? new SignupSource(UnknownChannel, null));
    }

    internal static DateTime WeekStart(DateTime date)
    {
        int offset = ((int)date.DayOfWeek + 6) % 7;
        return DateTime.SpecifyKind(date.Date.AddDays(-offset), DateTimeKind.Utc);
    }
}
