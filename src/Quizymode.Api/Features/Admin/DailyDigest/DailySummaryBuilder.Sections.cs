using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

// Daily digest sections (M1-M14, M16). Each section fails on its own and is then reported as unavailable, never as zero.
internal static partial class DailySummaryBuilder
{
    /// <summary>How long after a window ends a quiz completion still counts for a run that started inside it.</summary>
    internal static readonly TimeSpan CompletionGrace = TimeSpan.FromHours(6);

    private const int MaxCollectionLookups = 200;
    private const int SessionIdChunk = 1000;

    [GeneratedRegex("^[a-z0-9._-]{1,40}$")]
    private static partial Regex SafeTokenPattern();

    [GeneratedRegex("^[a-z0-9.-]{1,80}$")]
    private static partial Regex SafeHostPattern();

    /// <summary>One quiz-related event with only the fields the digest needs.</summary>
    internal sealed record QuizEventRow(string EventName, string SessionId, string RunId, string? ContextType, string? ContextId, DateTime OccurredUtc);

    internal sealed record QuizRunStart(string SessionId, string RunId, string? ContextType, string? ContextId);

    internal sealed record QuizRunCounts(List<QuizRunStart> Starts, int Completed);

    /// <summary>
    /// Builds every per-window section independently: a section that throws is returned as null ("unavailable").
    /// <paramref name="cohortRows"/> is null when loading them failed.
    /// </summary>
    internal static async Task<DaySummary> BuildDayAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        List<VisitorCohortReport.CohortRow>? cohortRows,
        bool includeSources,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        Dictionary<string, string?> visitorBySession = (cohortRows ?? [])
            .GroupBy(row => row.SessionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().VisitorId, StringComparer.Ordinal);

        List<SessionClassifier.ClassifiedSession>? sessions = await Section("sessions", logger, () =>
            ClassifyWindowAsync(db, startUtc, endExclusiveUtc, cancellationToken));

        VisitsSection? visits = sessions is null || cohortRows is null
            ? null
            : await Section("visits", logger, () => BuildVisitsAsync(db, sessions, cohortRows, visitorBySession, startUtc, endExclusiveUtc, cancellationToken));

        AccountsSection? accounts = sessions is null
            ? null
            : await Section("accounts", logger, () => BuildAccountsAsync(db, sessions, startUtc, endExclusiveUtc, cancellationToken));

        QuizRunCounts? runs = await Section("quiz runs", logger, () =>
            LoadQuizRunsAsync(db, startUtc, endExclusiveUtc, endExclusiveUtc + CompletionGrace, cancellationToken));
        QuizSection? quizzes = runs is null
            ? null
            : await Section("quizzes", logger, () => BuildQuizSectionAsync(db, runs, visitorBySession, includeSources, cancellationToken));

        SourcesSection? sources = !includeSources || sessions is null || runs is null
            ? null
            : await Section("sources", logger, () => BuildSourcesAsync(db, sessions, runs, startUtc, endExclusiveUtc, cancellationToken));

        ProblemsSection? problems = await Section("problems", logger, () =>
            BuildProblemsAsync(db, startUtc, endExclusiveUtc, cancellationToken));

        return new DaySummary(visits, accounts, quizzes, sources, problems);
    }

    /// <summary>Raw rows in the window including bot and internal traffic, for the data check (M16).</summary>
    internal static async Task<DigestHealth> BuildHealthAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        int pageViews = await db.PageViews.AsNoTracking()
            .CountAsync(pageView => pageView.CreatedUtc >= startUtc && pageView.CreatedUtc < endExclusiveUtc, cancellationToken);
        int events = await db.AnalyticsEvents.AsNoTracking()
            .CountAsync(analyticsEvent => analyticsEvent.OccurredUtc >= startUtc && analyticsEvent.OccurredUtc < endExclusiveUtc, cancellationToken);
        return new DigestHealth(pageViews, events);
    }

    internal static async Task<T?> Section<T>(string name, ILogger logger, Func<Task<T>> build)
        where T : class
    {
        try
        {
            return await build();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Type only: messages can echo SQL or data.
            logger.LogWarning("DailyDigest: section {Section} unavailable ({ErrorType})", name, ex.GetType().Name);
            return null;
        }
    }

    private static async Task<VisitsSection> BuildVisitsAsync(
        ApplicationDbContext db,
        List<SessionClassifier.ClassifiedSession> sessions,
        List<VisitorCohortReport.CohortRow> cohortRows,
        Dictionary<string, string?> visitorBySession,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        VisitorCohortReport.Response visitors = await BuildVisitorsAsync(db, cohortRows, startUtc, endExclusiveUtc, cancellationToken);
        List<string?> visitorIds = sessions
            .Select(session => visitorBySession.TryGetValue(session.SessionId, out string? visitorId) ? visitorId : null)
            .ToList();

        return new VisitsSection(
            sessions.Sum(session => session.PageHits),
            sessions.Count,
            sessions.Count(session => session.IsEngaged),
            visitorIds.Where(id => id is not null).Distinct(StringComparer.Ordinal).Count(),
            visitorIds.Count(id => id is null),
            visitors.NewVisitors,
            visitors.ReturningVisitors,
            sessions.Sum(session => session.ItemSteps));
    }

    private static async Task<AccountsSection> BuildAccountsAsync(
        ApplicationDbContext db,
        List<SessionClassifier.ClassifiedSession> sessions,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        SessionStats stats = Summarize(sessions);
        int newAccounts = await db.Users.AsNoTracking()
            .CountAsync(user => !user.IsInternal && user.CreatedAt >= startUtc && user.CreatedAt < endExclusiveUtc, cancellationToken);
        return new AccountsSection(stats.ActiveAccounts, newAccounts, stats.AnonymousSessions, stats.ConvertedSessions, stats.AuthenticatedSessions);
    }

    /// <summary>
    /// Quiz runs started in <c>[startUtc, endExclusiveUtc)</c> and how many have a completion before
    /// <paramref name="completionCutoffUtc"/>. Bot events and internal sessions are excluded over the extended range
    /// <c>[startUtc, completionCutoffUtc)</c>, so internal completions in the grace period never count. Learn runs are not quizzes.
    /// </summary>
    internal static async Task<QuizRunCounts> LoadQuizRunsAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        DateTime completionCutoffUtc,
        CancellationToken cancellationToken)
    {
        IQueryable<AnalyticsEvent> range = db.AnalyticsEvents
            .AsNoTracking()
            .Where(analyticsEvent =>
                analyticsEvent.OccurredUtc >= startUtc
                && analyticsEvent.OccurredUtc < completionCutoffUtc
                && (analyticsEvent.EventName == AnalyticsEventCatalog.QuickQuizStarted
                    || analyticsEvent.EventName == AnalyticsEventCatalog.QuizCompleted));
        IQueryable<string> internalSessionIds = InternalTrafficFilter.InternalEventSessionIds(db, range);

        List<QuizEventRow> rows = await range
            .Where(analyticsEvent => !analyticsEvent.IsBot && analyticsEvent.RunId != null && !internalSessionIds.Contains(analyticsEvent.SessionId))
            .Select(analyticsEvent => new QuizEventRow(
                analyticsEvent.EventName,
                analyticsEvent.SessionId,
                analyticsEvent.RunId!,
                analyticsEvent.ContextType,
                analyticsEvent.ContextId,
                analyticsEvent.OccurredUtc))
            .ToListAsync(cancellationToken);

        return CountQuizRuns(rows, startUtc, endExclusiveUtc, completionCutoffUtc);
    }

    /// <summary>
    /// Cohort by start: a run counts when its start is in the window; it is completed when a completion for the same
    /// (session, run) is before <paramref name="completionCutoffUtc"/>. Duplicate events count once.
    /// </summary>
    internal static QuizRunCounts CountQuizRuns(
        IEnumerable<QuizEventRow> rows,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        DateTime completionCutoffUtc)
    {
        List<QuizEventRow> all = rows.ToList();
        List<QuizRunStart> starts = all
            .Where(row => row.EventName == AnalyticsEventCatalog.QuickQuizStarted
                && row.OccurredUtc >= startUtc
                && row.OccurredUtc < endExclusiveUtc
                && row.ContextType != "learn")
            .GroupBy(row => (row.SessionId, row.RunId))
            .Select(group => group.OrderBy(row => row.OccurredUtc).First())
            .Select(row => new QuizRunStart(row.SessionId, row.RunId, row.ContextType, row.ContextId))
            .ToList();

        HashSet<(string, string)> completedKeys = all
            .Where(row => row.EventName == AnalyticsEventCatalog.QuizCompleted && row.OccurredUtc < completionCutoffUtc)
            .Select(row => (row.SessionId, row.RunId))
            .ToHashSet();

        return new QuizRunCounts(starts, starts.Count(start => completedKeys.Contains((start.SessionId, start.RunId))));
    }

    private static async Task<QuizSection> BuildQuizSectionAsync(
        ApplicationDbContext db,
        QuizRunCounts runs,
        Dictionary<string, string?> visitorBySession,
        bool includeTopics,
        CancellationToken cancellationToken)
    {
        int participants = runs.Starts
            .Select(start => visitorBySession.TryGetValue(start.SessionId, out string? visitorId) && visitorId is not null ? "v:" + visitorId : "s:" + start.SessionId)
            .Distinct(StringComparer.Ordinal)
            .Count();

        List<TopicCount> topics = [];
        if (includeTopics && runs.Starts.Count > 0)
        {
            var grouped = runs.Starts
                .GroupBy(start => (start.ContextType, start.ContextId))
                .Select(group => new { group.Key.ContextType, group.Key.ContextId, Count = group.Count() })
                .OrderByDescending(group => group.Count)
                .ToList();

            List<Guid> collectionIds = grouped
                .Where(group => group.ContextType == "collection" && Guid.TryParse(group.ContextId, out _))
                .Select(group => Guid.Parse(group.ContextId!))
                .Distinct()
                .Take(MaxCollectionLookups)
                .ToList();
            Dictionary<Guid, (string Name, bool IsPublic)> collections = collectionIds.Count == 0
                ? []
                : (await db.Collections.AsNoTracking()
                        .Where(collection => collectionIds.Contains(collection.Id))
                        .Select(collection => new { collection.Id, collection.Name, collection.IsPublic })
                        .ToListAsync(cancellationToken))
                    .ToDictionary(collection => collection.Id, collection => (collection.Name, collection.IsPublic));

            topics = grouped
                .Select(group => new TopicCount(TopicLabel(group.ContextType, group.ContextId, collections), group.Count))
                .GroupBy(topic => topic.Label, StringComparer.Ordinal)
                .Select(group => new TopicCount(group.Key, group.Sum(topic => topic.Starts)))
                .OrderByDescending(topic => topic.Starts)
                .ThenBy(topic => topic.Label, StringComparer.Ordinal)
                .Take(3)
                .ToList();
        }

        return new QuizSection(runs.Starts.Count, runs.Completed, participants, topics);
    }

    private static string TopicLabel(string? contextType, string? contextId, Dictionary<Guid, (string Name, bool IsPublic)> collections)
    {
        switch (contextType)
        {
            case "daily":
                return "Daily quiz";
            case "category":
                return SafeToken(contextId?.Trim().ToLowerInvariant(), SafeTokenPattern());
            case "collection":
                if (Guid.TryParse(contextId, out Guid id) && collections.TryGetValue(id, out (string Name, bool IsPublic) collection))
                {
                    return collection.IsPublic ? CleanText(collection.Name, 60) : "a private collection";
                }

                return "a collection";
            default:
                return SafeToken(contextType, SafeTokenPattern());
        }
    }

    /// <summary>Strips control characters and truncates; used only for public collection names.</summary>
    internal static string CleanText(string value, int maxLength)
    {
        string cleaned = new(value.Where(character => !char.IsControl(character)).ToArray());
        cleaned = cleaned.Trim();
        if (cleaned.Length > maxLength)
        {
            cleaned = cleaned[..maxLength].TrimEnd() + "...";
        }

        return cleaned.Length == 0 ? "other" : cleaned;
    }

    private static string SafeToken(string? value, Regex pattern) =>
        value is not null && pattern.IsMatch(value) ? value : "other";

    /// <summary>The printable source of a session: utm_source, else referrer host, else channel; anything unsafe becomes "other".</summary>
    internal static string SourceKey(string? utmSource, string? referrerHost, string? channel)
    {
        if (!string.IsNullOrWhiteSpace(utmSource))
        {
            return SafeToken(utmSource.Trim().ToLowerInvariant(), SafeTokenPattern());
        }

        if (!string.IsNullOrWhiteSpace(referrerHost))
        {
            return SafeToken(referrerHost.Trim().ToLowerInvariant(), SafeHostPattern());
        }

        return string.IsNullOrWhiteSpace(channel) ? "unknown" : SafeToken(channel.Trim().ToLowerInvariant(), SafeTokenPattern());
    }

    internal static bool IsLinkedIn(string? utmSource, string? referrerHost)
    {
        string host = referrerHost?.Trim().ToLowerInvariant() ?? string.Empty;
        return host.Contains("linkedin", StringComparison.Ordinal)
            || host == "lnkd.in"
            || string.Equals(utmSource?.Trim(), "linkedin", StringComparison.OrdinalIgnoreCase);
    }

    private sealed record SourceSession(string Key, bool IsLinkedIn);

    private static async Task<SourcesSection> BuildSourcesAsync(
        ApplicationDbContext db,
        List<SessionClassifier.ClassifiedSession> sessions,
        QuizRunCounts runs,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        Dictionary<string, SourceSession> bySession = new(StringComparer.Ordinal);
        List<string> sessionIds = sessions.Select(session => session.SessionId).ToList();
        for (int offset = 0; offset < sessionIds.Count; offset += SessionIdChunk)
        {
            List<string> chunk = sessionIds.Skip(offset).Take(SessionIdChunk).ToList();
            var rows = await db.AnalyticsSessions.AsNoTracking()
                .Where(session => chunk.Contains(session.SessionId))
                .Select(session => new { session.SessionId, session.UtmSource, session.ReferrerHost, session.Channel })
                .ToListAsync(cancellationToken);
            foreach (var row in rows)
            {
                bySession[row.SessionId] = new SourceSession(
                    SourceKey(row.UtmSource, row.ReferrerHost, row.Channel),
                    IsLinkedIn(row.UtmSource, row.ReferrerHost));
            }
        }

        // Sessions without a first-hit attribution row are "unknown".
        SourceSession Resolve(string sessionId) =>
            bySession.TryGetValue(sessionId, out SourceSession? found) ? found : new SourceSession("unknown", false);

        // Accounts created in the window, attributed to the source of the account's earliest linked session.
        List<Guid> newUserIds = await db.Users.AsNoTracking()
            .Where(user => !user.IsInternal && user.CreatedAt >= startUtc && user.CreatedAt < endExclusiveUtc)
            .Select(user => user.Id)
            .ToListAsync(cancellationToken);
        List<SourceSession> signupSources = [];
        if (newUserIds.Count > 0)
        {
            var linked = await db.AnalyticsSessions.AsNoTracking()
                .Where(session => session.UserId != null && newUserIds.Contains(session.UserId.Value))
                .Select(session => new { session.UserId, session.FirstSeenUtc, session.UtmSource, session.ReferrerHost, session.Channel })
                .ToListAsync(cancellationToken);
            signupSources = linked
                .GroupBy(row => row.UserId)
                .Select(group => group.OrderBy(row => row.FirstSeenUtc).First())
                .Select(row => new SourceSession(SourceKey(row.UtmSource, row.ReferrerHost, row.Channel), IsLinkedIn(row.UtmSource, row.ReferrerHost)))
                .ToList();
        }

        List<(SourceSession Source, SessionClassifier.ClassifiedSession Session)> pairs = sessions
            .Select(session => (Resolve(session.SessionId), session))
            .ToList();

        SourceRow Row(string name, IEnumerable<(SourceSession Source, SessionClassifier.ClassifiedSession Session)> members, int newAccounts)
        {
            List<(SourceSession Source, SessionClassifier.ClassifiedSession Session)> list = members.ToList();
            HashSet<string> memberIds = list.Select(pair => pair.Session.SessionId).ToHashSet(StringComparer.Ordinal);
            return new SourceRow(
                name,
                list.Count,
                list.Count(pair => pair.Session.IsEngaged),
                runs.Starts.Count(start => memberIds.Contains(start.SessionId)),
                list.Count(pair => pair.Session.Outcome == SessionClassifier.OutcomeConverted),
                newAccounts);
        }

        List<SourceRow> top = pairs
            .Where(pair => !pair.Source.IsLinkedIn)
            .GroupBy(pair => pair.Source.Key, StringComparer.Ordinal)
            .Select(group => Row(group.Key, group, signupSources.Count(source => !source.IsLinkedIn && source.Key == group.Key)))
            .OrderByDescending(row => row.Sessions)
            .ThenBy(row => row.Name, StringComparer.Ordinal)
            .Take(3)
            .ToList();
        SourceRow linkedIn = Row("LinkedIn", pairs.Where(pair => pair.Source.IsLinkedIn), signupSources.Count(source => source.IsLinkedIn));
        return new SourcesSection(top, linkedIn);
    }

    private static async Task<ProblemsSection> BuildProblemsAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        GetClientErrors.WindowCounts errors = await GetClientErrors.CountForWindowAsync(db, startUtc, endExclusiveUtc, cancellationToken);

        var feedback = await db.FeedbackSubmissions.AsNoTracking()
            .Where(submission => submission.CreatedAt >= startUtc && submission.CreatedAt < endExclusiveUtc
                && (submission.UserId == null || !db.Users.Any(user => user.Id == submission.UserId && user.IsInternal)))
            .GroupBy(submission => submission.Type)
            .Select(group => new { Type = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);
        int problemReports = feedback.Where(row => row.Type == "reportIssue").Sum(row => row.Count);
        int otherFeedback = feedback.Where(row => row.Type != "reportIssue").Sum(row => row.Count);

        int pictureReports = await db.MediaReports.AsNoTracking()
            .CountAsync(report => report.CreatedAt >= startUtc && report.CreatedAt < endExclusiveUtc, cancellationToken);

        return new ProblemsSection(errors.Reports, errors.Sessions, errors.SignedInUsers, errors.NewGroups, problemReports, otherFeedback, pictureReports);
    }
}
