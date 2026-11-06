using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Counts unique sessions per funnel event so admins can see where anonymous visitors engage,
/// stop, start signup, and become authenticated (FUNNEL-001).
/// </summary>
public static class GetConversionFunnel
{
    public sealed record QueryRequest(int Days = 7, bool IncludeBots = false, bool IncludeInternal = false);

    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int SessionsWithEvents,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        List<StepResponse> Steps);

    /// <param name="ConversionFromPreviousPercent">
    /// Unique sessions at this step as a share of the previous step's; null for the first step or
    /// when the previous step has no sessions. Steps are counted independently, so a later step can
    /// exceed an earlier one (for example sign-ins by returning users who never saw a prompt).
    /// </param>
    public sealed record StepResponse(
        string EventName,
        int Sessions,
        int Events,
        double? ConversionFromPreviousPercent,
        double? ConversionFromFirstPercent);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/funnel", Handler)
                .WithTags("Admin")
                .WithSummary("Get the conversion event funnel (Admin only)")
                .WithDescription("Returns unique sessions and step-to-step conversion for each allowlisted funnel event in the selected window. Bot sessions are excluded unless includeBots=true, and internal sessions unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
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

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.ConversionFunnel.InvalidDays", $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Engagement data is kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<AnalyticsEvent> windowQuery = db.AnalyticsEvents
            .AsNoTracking()
            .Where(analyticsEvent =>
                analyticsEvent.OccurredUtc >= windowStartUtc &&
                analyticsEvent.OccurredUtc <= windowEndUtc);

        int botSessions = await windowQuery
            .Where(analyticsEvent => analyticsEvent.IsBot)
            .Select(analyticsEvent => analyticsEvent.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        IQueryable<string> internalSessionIds = InternalTrafficFilter.InternalEventSessionIds(db, windowQuery);

        int internalSessions = await internalSessionIds.CountAsync(cancellationToken);

        IQueryable<AnalyticsEvent> query = request.IncludeBots
            ? windowQuery
            : windowQuery.Where(analyticsEvent => !analyticsEvent.IsBot);

        if (!request.IncludeInternal)
        {
            query = query.Where(analyticsEvent => !internalSessionIds.Contains(analyticsEvent.SessionId));
        }

        int sessionsWithEvents = await query
            .Select(analyticsEvent => analyticsEvent.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        Dictionary<string, (int Sessions, int Events)> countsByEvent = (await query
            .GroupBy(analyticsEvent => analyticsEvent.EventName)
            .Select(group => new
            {
                EventName = group.Key,
                Sessions = group.Select(analyticsEvent => analyticsEvent.SessionId).Distinct().Count(),
                Events = group.Count()
            })
            .ToListAsync(cancellationToken))
            .ToDictionary(row => row.EventName, row => (row.Sessions, row.Events), StringComparer.Ordinal);

        List<StepResponse> steps = [];
        int? firstSessions = null;
        int? previousSessions = null;
        foreach (string eventName in AnalyticsEventCatalog.FunnelSteps)
        {
            (int sessions, int events) = countsByEvent.GetValueOrDefault(eventName, (0, 0));
            firstSessions ??= sessions;

            steps.Add(new StepResponse(
                eventName,
                sessions,
                events,
                previousSessions is null ? null : Percent(sessions, previousSessions.Value),
                steps.Count == 0 ? null : Percent(sessions, firstSessions.Value)));

            previousSessions = sessions;
        }

        return Result.Success(new Response(
            windowStartUtc,
            windowEndUtc,
            sessionsWithEvents,
            botSessions,
            BotsExcluded: !request.IncludeBots,
            internalSessions,
            InternalExcluded: !request.IncludeInternal,
            steps));
    }

    private static double? Percent(int part, int total)
    {
        return total == 0 ? null : Math.Round(part * 100.0 / total, 1);
    }
}
