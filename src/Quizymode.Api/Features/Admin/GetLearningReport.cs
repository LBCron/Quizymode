using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Study engagement by mode and scope (ANALYTICS-007): runs started and completed, scores, how far runs
/// get, and where quiz runs stop. A run is one client run id within one session.
/// </summary>
public static class GetLearningReport
{
    public const string QuizMode = "quiz";
    public const string LearnMode = "learn";
    public const string FlashcardsMode = "flashcards";

    private static readonly string[] StudyEventNames =
    [
        AnalyticsEventCatalog.QuickQuizStarted,
        AnalyticsEventCatalog.QuestionAnswered,
        AnalyticsEventCatalog.QuizCompleted,
        AnalyticsEventCatalog.FlashcardsStarted,
        AnalyticsEventCatalog.FlashcardRevealed
    ];

    public static readonly string[] Channels =
        ["paid", "email", "campaign", "search", "social", "referral", "direct", "unknown"];

    public static readonly string[] VisitorTypes = ["new", "returning"];

    public sealed record QueryRequest(
        int Days = 7,
        bool IncludeBots = false,
        bool IncludeInternal = false,
        string? Channel = null,
        string? VisitorType = null);

    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        List<ScopeResponse> Scopes,
        int QuizRunsAbandonedBeforeFirstAnswer,
        List<DropOffPointResponse> QuizDropOff);

    /// <param name="RunsCompleted">Quiz runs that reached every question; null for flashcards, which have no completion.</param>
    /// <param name="AverageScorePercent">Mean of score / total over completed quiz runs; null when none completed.</param>
    /// <param name="AverageItemsReached">Mean questions answered (quiz) or cards revealed (flashcards) per started run.</param>
    public sealed record ScopeResponse(
        string Mode,
        string? ContextType,
        string? ContextId,
        int RunsStarted,
        int? RunsCompleted,
        double? CompletionRatePercent,
        double? AverageScorePercent,
        double AverageItemsReached);

    /// <param name="RunsReached">Started quiz runs that answered at least <paramref name="Position"/> questions.</param>
    /// <param name="RunsAbandonedHere">Unfinished quiz runs whose furthest answered question is <paramref name="Position"/>.</param>
    public sealed record DropOffPointResponse(int Position, int RunsReached, double SharePercent, int RunsAbandonedHere);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/learning", Handler)
                .WithTags("Admin")
                .WithSummary("Get study engagement by mode and scope (Admin only)")
                .WithDescription("Returns quiz and flashcards runs started and completed, average score, items reached, and quiz drop-off by question position for the selected window. Bot sessions are excluded unless includeBots=true, and internal sessions unless includeInternal=true. Optional channel (paid, email, campaign, search, social, referral, direct, unknown) and visitorType (new, returning) limit every figure to sessions of that traffic channel or visitor type; unknown values return 400.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
            bool includeBots = false,
            bool includeInternal = false,
            string? channel = null,
            string? visitorType = null,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            Result<Response> result = await HandleAsync(new QueryRequest(days, includeBots, includeInternal, channel, visitorType), db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    private sealed record StudyRow(
        string EventName,
        string SessionId,
        string? RunId,
        string? ContextType,
        string? ContextId,
        int? Position,
        int? Score,
        int? Total);

    private sealed record Run(string Mode, string? ContextType, string? ContextId, int ItemsReached, int MaxPosition, double? ScorePercent);

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.LearningReport.InvalidDays", $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Engagement data is kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        string? channelFilter = string.IsNullOrWhiteSpace(request.Channel) ? null : request.Channel.Trim().ToLowerInvariant();
        if (channelFilter is not null && !Channels.Contains(channelFilter))
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.LearningReport.InvalidChannel", $"Channel must be one of: {string.Join(", ", Channels)}."));
        }

        string? visitorTypeFilter = string.IsNullOrWhiteSpace(request.VisitorType) ? null : request.VisitorType.Trim().ToLowerInvariant();
        if (visitorTypeFilter is not null && !VisitorTypes.Contains(visitorTypeFilter))
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.LearningReport.InvalidVisitorType", $"VisitorType must be one of: {string.Join(", ", VisitorTypes)}."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<AnalyticsEvent> windowQuery = db.AnalyticsEvents
            .AsNoTracking()
            .Where(analyticsEvent =>
                analyticsEvent.OccurredUtc >= windowStartUtc &&
                analyticsEvent.OccurredUtc <= windowEndUtc &&
                StudyEventNames.Contains(analyticsEvent.EventName));

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

        List<StudyRow> rows = await query
            .Where(analyticsEvent => analyticsEvent.RunId != null)
            .Select(analyticsEvent => new StudyRow(
                analyticsEvent.EventName,
                analyticsEvent.SessionId,
                analyticsEvent.RunId,
                analyticsEvent.ContextType,
                analyticsEvent.ContextId,
                analyticsEvent.Position,
                analyticsEvent.Score,
                analyticsEvent.Total))
            .ToListAsync(cancellationToken);

        if (channelFilter is not null || visitorTypeFilter is not null)
        {
            HashSet<string> allowedSessions = await MatchingSessionIdsAsync(
                db,
                rows.Select(row => row.SessionId).Distinct(StringComparer.Ordinal).ToList(),
                channelFilter,
                visitorTypeFilter,
                cancellationToken);
            rows = rows.Where(row => allowedSessions.Contains(row.SessionId)).ToList();
        }

        List<Run> runs = BuildRuns(rows);

        List<ScopeResponse> scopes = runs
            .GroupBy(run => (run.Mode, run.ContextType, run.ContextId))
            .Select(group => ToScope(group.Key.Mode, group.Key.ContextType, group.Key.ContextId, [.. group]))
            .OrderByDescending(scope => scope.RunsStarted)
            .ThenBy(scope => scope.Mode, StringComparer.Ordinal)
            .ThenBy(scope => scope.ContextType, StringComparer.Ordinal)
            .ThenBy(scope => scope.ContextId, StringComparer.Ordinal)
            .ToList();

        List<Run> quizRuns = runs.Where(run => run.Mode == QuizMode).ToList();
        int furthest = quizRuns.Count == 0 ? 0 : quizRuns.Max(run => run.MaxPosition);
        List<DropOffPointResponse> dropOff = Enumerable.Range(1, furthest)
            .Select(position =>
            {
                int reached = quizRuns.Count(run => run.MaxPosition >= position);
                int abandonedHere = quizRuns.Count(run => run.ScorePercent is null && run.MaxPosition == position);
                return new DropOffPointResponse(position, reached, Percent(reached, quizRuns.Count) ?? 0, abandonedHere);
            })
            .ToList();
        int abandonedBeforeFirstAnswer = quizRuns.Count(run => run.ScorePercent is null && run.MaxPosition == 0);

        return Result.Success(new Response(
            windowStartUtc,
            windowEndUtc,
            botSessions,
            BotsExcluded: !request.IncludeBots,
            internalSessions,
            InternalExcluded: !request.IncludeInternal,
            scopes,
            abandonedBeforeFirstAnswer,
            dropOff));
    }

    // Channel comes from the session's first-hit attribution snapshot (sessions without one are "unknown").
    // A visitor's first session (by first-seen time, then session id) is "new" and their later ones are
    // "returning", matching the page-view rollups; sessions without a visitor id match neither type.
    private static async Task<HashSet<string>> MatchingSessionIdsAsync(
        ApplicationDbContext db,
        List<string> sessionIds,
        string? channel,
        string? visitorType,
        CancellationToken cancellationToken)
    {
        var snapshots = await db.AnalyticsSessions
            .AsNoTracking()
            .Where(session => sessionIds.Contains(session.SessionId))
            .Select(session => new { session.SessionId, session.VisitorId, session.Channel })
            .ToListAsync(cancellationToken);
        Dictionary<string, string> channelBySession = snapshots
            .GroupBy(snapshot => snapshot.SessionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().Channel, StringComparer.Ordinal);

        Dictionary<string, string?> visitorBySession = snapshots
            .GroupBy(snapshot => snapshot.SessionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().VisitorId, StringComparer.Ordinal);
        Dictionary<string, string> firstSessionByVisitor = [];
        if (visitorType is not null)
        {
            List<string> visitorIds = snapshots
                .Where(snapshot => snapshot.VisitorId != null)
                .Select(snapshot => snapshot.VisitorId!)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            var visitorSessions = await db.AnalyticsSessions
                .AsNoTracking()
                .Where(session => session.VisitorId != null && visitorIds.Contains(session.VisitorId))
                .Select(session => new { VisitorId = session.VisitorId!, session.SessionId, session.FirstSeenUtc })
                .ToListAsync(cancellationToken);
            firstSessionByVisitor = visitorSessions
                .GroupBy(session => session.VisitorId, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.OrderBy(session => session.FirstSeenUtc).ThenBy(session => session.SessionId, StringComparer.Ordinal).First().SessionId,
                    StringComparer.Ordinal);
        }

        HashSet<string> matching = new(StringComparer.Ordinal);
        foreach (string sessionId in sessionIds)
        {
            if (channel is not null)
            {
                string sessionChannel = channelBySession.TryGetValue(sessionId, out string? stored) && !string.IsNullOrEmpty(stored)
                    ? stored
                    : "unknown";
                if (sessionChannel != channel)
                {
                    continue;
                }
            }

            if (visitorType is not null)
            {
                visitorBySession.TryGetValue(sessionId, out string? visitorId);
                if (visitorId is null || !firstSessionByVisitor.TryGetValue(visitorId, out string? firstSessionId))
                {
                    continue;
                }

                string type = firstSessionId == sessionId ? "new" : "returning";
                if (type != visitorType)
                {
                    continue;
                }
            }

            matching.Add(sessionId);
        }

        return matching;
    }

    // A run is counted from its start event; answers or completions without a stored start are ignored.
    private static List<Run> BuildRuns(List<StudyRow> rows)
    {
        List<Run> runs = [];
        foreach (IGrouping<(string SessionId, string RunId), StudyRow> run in rows.GroupBy(row => (row.SessionId, row.RunId!)))
        {
            StudyRow? quizStart = run.FirstOrDefault(row => row.EventName == AnalyticsEventCatalog.QuickQuizStarted);
            StudyRow? flashcardsStart = run.FirstOrDefault(row => row.EventName == AnalyticsEventCatalog.FlashcardsStarted);

            if (quizStart is not null)
            {
                List<StudyRow> answers = run.Where(row => row.EventName == AnalyticsEventCatalog.QuestionAnswered).ToList();
                StudyRow? completed = run.FirstOrDefault(row => row.EventName == AnalyticsEventCatalog.QuizCompleted);
                double? scorePercent = completed is { Score: not null, Total: > 0 }
                    ? completed.Score.Value * 100.0 / completed.Total.Value
                    : null;
                // Learn runs (context type "learn") are scored like quiz runs but kept out of quiz drop-off:
                // they only report first-attempt answers, so an unfinished Learn run would distort the quiz funnel.
                string startMode = quizStart.ContextType == "learn" ? LearnMode : QuizMode;
                runs.Add(new Run(
                    startMode,
                    quizStart.ContextType,
                    quizStart.ContextId,
                    answers.Count,
                    answers.Count == 0 ? 0 : answers.Max(row => row.Position ?? 0),
                    scorePercent));
            }
            else if (flashcardsStart is not null)
            {
                List<StudyRow> reveals = run.Where(row => row.EventName == AnalyticsEventCatalog.FlashcardRevealed).ToList();
                runs.Add(new Run(
                    FlashcardsMode,
                    flashcardsStart.ContextType,
                    flashcardsStart.ContextId,
                    reveals.Count,
                    reveals.Count == 0 ? 0 : reveals.Max(row => row.Position ?? 0),
                    null));
            }
        }

        return runs;
    }

    private static ScopeResponse ToScope(string mode, string? contextType, string? contextId, List<Run> runs)
    {
        double averageItemsReached = Math.Round(runs.Average(run => run.ItemsReached), 1);
        if (mode != QuizMode && mode != LearnMode)
        {
            return new ScopeResponse(mode, contextType, contextId, runs.Count, null, null, null, averageItemsReached);
        }

        List<double> scores = runs.Where(run => run.ScorePercent is not null).Select(run => run.ScorePercent!.Value).ToList();
        return new ScopeResponse(
            mode,
            contextType,
            contextId,
            runs.Count,
            scores.Count,
            Percent(scores.Count, runs.Count),
            scores.Count == 0 ? null : Math.Round(scores.Average(), 1),
            averageItemsReached);
    }

    private static double? Percent(int part, int total)
    {
        return total == 0 ? null : Math.Round(part * 100.0 / total, 1);
    }
}
