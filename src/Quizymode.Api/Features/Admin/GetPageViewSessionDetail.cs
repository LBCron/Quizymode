using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Returns the ordered click path for a single session so an admin can see exactly
/// what one visitor did, rather than inferring it from aggregate counts.
/// </summary>
public static class GetPageViewSessionDetail
{
    public sealed record QueryRequest(string SessionId, bool IncludeInternal = false);

    public sealed record Response(
        string SessionId,
        string Outcome,
        DateTime StartedUtc,
        DateTime EndedUtc,
        int PageHits,
        int DistinctPages,
        int DurationSeconds,
        bool IsBounce,
        string IpAddress,
        string? Country,
        string? UserEmail,
        string? UserAgent,
        bool IsBot,
        bool IsInternal,
        List<JourneyStepResponse> Steps,
        string? VisitorId,
        string VisitorType,
        int SessionsFromVisitor,
        string? Channel,
        List<ActivityResponse> Activities,
        string? Region,
        string? City);

    /// <summary>One game, quiz or flashcards run of the session, built from engagement events by run id.</summary>
    public sealed record ActivityResponse(
        string Kind,
        string RunId,
        string? ContextType,
        string? ContextId,
        DateTime StartedUtc,
        DateTime? CompletedUtc,
        int? Score,
        int? Total);

    public sealed record JourneyStepResponse(
        int StepNumber,
        string Path,
        string QueryString,
        string Url,
        bool IsAuthenticated,
        DateTime CreatedUtc,
        int? DwellSeconds,
        string Area,
        bool IsItemStep);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/page-view-sessions/{sessionId}", Handler)
                .WithTags("Admin")
                .WithSummary("Get the ordered page journey for one session (Admin only)")
                .WithDescription("Returns every page hit in a session in order, with its feature area and dwell time per step. Also returns the visitor id and type (new, returning, unknown), traffic channel, and the game, quiz and flashcards runs of the session. The final step has no dwell time because no exit event is recorded. Internal sessions return 404 unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .ProducesProblem(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            string sessionId,
            bool? includeInternal,
            ApplicationDbContext db,
            IIpGeolocationService geoService,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(
                new QueryRequest(sessionId, includeInternal ?? false), db, geoService, cancellationToken);

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
        string sessionId = (request.SessionId ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.PageViewSessionDetail.InvalidSessionId", "SessionId is required."));
        }

        List<PageView> hits = await db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.SessionId == sessionId)
            .OrderBy(pageView => pageView.CreatedUtc)
            .ThenBy(pageView => pageView.Id)
            .ToListAsync(cancellationToken);

        if (hits.Count == 0)
        {
            return Result.Failure<Response>(
                Error.NotFound("Admin.PageViewSessionDetail.NotFound", $"No page views were found for session '{sessionId}'."));
        }

        List<Guid> sessionUserIds = hits
            .Where(hit => hit.UserId.HasValue)
            .Select(hit => hit.UserId!.Value)
            .Distinct()
            .ToList();

        bool isInternal = hits.Any(hit => hit.IsInternal) ||
            (sessionUserIds.Count > 0 && await db.Users
                .AsNoTracking()
                .AnyAsync(user => sessionUserIds.Contains(user.Id) && user.IsInternal, cancellationToken));

        if (isInternal && !request.IncludeInternal)
        {
            return Result.Failure<Response>(
                Error.NotFound(
                    "Admin.PageViewSessionDetail.InternalSession",
                    $"Session '{sessionId}' is internal traffic and is excluded. Pass includeInternal=true to view it."));
        }

        PageView firstHit = hits[0];
        PageView lastHit = hits[^1];

        string outcome = firstHit.IsAuthenticated
            ? GetPageViewSessions.OutcomeAuthenticated
            : hits.Any(hit => hit.IsAuthenticated)
                ? GetPageViewSessions.OutcomeConverted
                : GetPageViewSessions.OutcomeAnonymous;

        List<JourneyStepResponse> steps = hits
            .Select((hit, index) => new JourneyStepResponse(
                StepNumber: index + 1,
                Path: hit.Path,
                QueryString: hit.QueryString,
                Url: hit.Url,
                IsAuthenticated: hit.IsAuthenticated,
                CreatedUtc: hit.CreatedUtc,
                // The last step has no successor and the SPA emits no exit event, so its
                // dwell time is genuinely unknown rather than zero.
                DwellSeconds: index == hits.Count - 1
                    ? null
                    : (int)Math.Round((hits[index + 1].CreatedUtc - hit.CreatedUtc).TotalSeconds),
                // Rows not yet reached by the classification backfill are classified on the fly.
                Area: hit.Area ?? PageHitClassifier.Classify(hit.Path, hit.QueryString).Area,
                IsItemStep: hit.Area is null
                    ? PageHitClassifier.Classify(hit.Path, hit.QueryString).IsItemStep
                    : hit.IsItemStep))
            .ToList();

        Guid? userId = hits.LastOrDefault(hit => hit.UserId.HasValue)?.UserId;
        string? userEmail = null;
        if (userId.HasValue)
        {
            userEmail = await db.Users
                .Where(user => user.Id == userId.Value)
                .Select(user => user.Email)
                .FirstOrDefaultAsync(cancellationToken);
        }

        AnalyticsSession? snapshot = await db.AnalyticsSessions
            .AsNoTracking()
            .Where(session => session.SessionId == sessionId)
            .OrderBy(session => session.FirstSeenUtc)
            .FirstOrDefaultAsync(cancellationToken);

        string visitorType = GetPageViewSessions.VisitorTypeUnknown;
        int sessionsFromVisitor = 0;
        if (snapshot?.VisitorId is string visitorId)
        {
            List<string> visitorSessionIds = await db.AnalyticsSessions
                .AsNoTracking()
                .Where(session => session.VisitorId == visitorId)
                .OrderBy(session => session.FirstSeenUtc)
                .ThenBy(session => session.SessionId)
                .Select(session => session.SessionId)
                .ToListAsync(cancellationToken);

            sessionsFromVisitor = visitorSessionIds.Count;
            visitorType = visitorSessionIds.Count > 0 && string.Equals(visitorSessionIds[0], sessionId, StringComparison.Ordinal)
                ? GetPageViewSessions.VisitorTypeNew
                : GetPageViewSessions.VisitorTypeReturning;
        }

        Dictionary<string, List<SessionActivityBuilder.Activity>> activitiesBySession =
            await SessionActivityBuilder.LoadAsync(db, [sessionId], cancellationToken);
        List<ActivityResponse> activities = activitiesBySession.GetValueOrDefault(sessionId)?
            .Select(activity => new ActivityResponse(
                activity.Kind,
                activity.RunId,
                activity.ContextType,
                activity.ContextId,
                activity.StartedUtc,
                activity.CompletedUtc,
                activity.Score,
                activity.Total))
            .ToList() ?? [];

        string? country = snapshot?.Country ?? await geoService.GetCountryAsync(firstHit.IpAddress, cancellationToken);

        return Result.Success(new Response(
            SessionId: sessionId,
            Outcome: outcome,
            StartedUtc: firstHit.CreatedUtc,
            EndedUtc: lastHit.CreatedUtc,
            PageHits: hits.Count,
            DistinctPages: hits.Select(hit => hit.Path).Distinct().Count(),
            DurationSeconds: (int)Math.Round((lastHit.CreatedUtc - firstHit.CreatedUtc).TotalSeconds),
            IsBounce: hits.Count == 1,
            IpAddress: IpTruncation.Truncate(firstHit.IpAddress),
            Country: country,
            UserEmail: userEmail,
            UserAgent: firstHit.UserAgent,
            IsBot: firstHit.IsBot,
            IsInternal: isInternal,
            Steps: steps,
            VisitorId: snapshot?.VisitorId,
            VisitorType: visitorType,
            SessionsFromVisitor: sessionsFromVisitor,
            Channel: snapshot?.Channel,
            Activities: activities,
            Region: snapshot?.Region,
            City: snapshot?.City));
    }
}
