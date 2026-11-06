using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Services;

/// <summary>
/// Builds per-session game and quiz activity from <see cref="AnalyticsEvent"/> rows (#496). Runs are linked
/// by <c>SessionId</c> and <c>RunId</c> only; <c>StudySession</c> is never joined by session id so the link
/// does not outlive the analytics retention window.
/// </summary>
internal static class SessionActivityBuilder
{
    public const string KindGame = "game";
    public const string KindQuiz = "quiz";
    public const string KindFlashcards = "flashcards";

    public static readonly string[] ActivityEventNames =
    [
        AnalyticsEventCatalog.GameStarted,
        AnalyticsEventCatalog.GameCompleted,
        AnalyticsEventCatalog.QuickQuizStarted,
        AnalyticsEventCatalog.QuizCompleted,
        AnalyticsEventCatalog.FlashcardsStarted
    ];

    public sealed record Activity(
        string Kind,
        string RunId,
        string? ContextType,
        string? ContextId,
        DateTime StartedUtc,
        DateTime? CompletedUtc,
        int? Score,
        int? Total);

    public sealed record Counts(int GamesPlayed, int GamesCompleted, int QuizRuns, int QuizzesCompleted);

    public static readonly Counts NoActivity = new(0, 0, 0, 0);

    /// <summary>Loads the activity runs of the given sessions, in time order.</summary>
    public static async Task<Dictionary<string, List<Activity>>> LoadAsync(
        ApplicationDbContext db,
        IReadOnlyCollection<string> sessionIds,
        CancellationToken cancellationToken)
    {
        if (sessionIds.Count == 0)
        {
            return new Dictionary<string, List<Activity>>(StringComparer.Ordinal);
        }

        List<AnalyticsEvent> events = await db.AnalyticsEvents
            .AsNoTracking()
            .Where(analyticsEvent => sessionIds.Contains(analyticsEvent.SessionId)
                && analyticsEvent.RunId != null
                && ActivityEventNames.Contains(analyticsEvent.EventName))
            .OrderBy(analyticsEvent => analyticsEvent.OccurredUtc)
            .ThenBy(analyticsEvent => analyticsEvent.Id)
            .ToListAsync(cancellationToken);

        return events
            .GroupBy(analyticsEvent => analyticsEvent.SessionId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => Build(group), StringComparer.Ordinal);
    }

    public static Counts Count(IReadOnlyCollection<Activity> activities)
    {
        return new Counts(
            activities.Count(activity => activity.Kind == KindGame),
            activities.Count(activity => activity.Kind == KindGame && activity.CompletedUtc.HasValue),
            activities.Count(activity => activity.Kind != KindGame),
            activities.Count(activity => activity.Kind != KindGame && activity.CompletedUtc.HasValue));
    }

    private static List<Activity> Build(IEnumerable<AnalyticsEvent> sessionEvents)
    {
        return sessionEvents
            .GroupBy(analyticsEvent => analyticsEvent.RunId!, StringComparer.Ordinal)
            .Select(run =>
            {
                List<AnalyticsEvent> rows = run.ToList();
                AnalyticsEvent first = rows[0];
                AnalyticsEvent? completed = rows.FirstOrDefault(row =>
                    row.EventName == AnalyticsEventCatalog.GameCompleted
                    || row.EventName == AnalyticsEventCatalog.QuizCompleted);

                string kind = rows.Any(row => row.EventName is AnalyticsEventCatalog.GameStarted or AnalyticsEventCatalog.GameCompleted)
                    ? KindGame
                    : rows.Any(row => row.EventName == AnalyticsEventCatalog.FlashcardsStarted)
                        ? KindFlashcards
                        : KindQuiz;

                return new Activity(
                    kind,
                    run.Key,
                    first.ContextType,
                    first.ContextId,
                    first.OccurredUtc,
                    completed?.OccurredUtc,
                    completed?.Score,
                    completed?.Total);
            })
            .OrderBy(activity => activity.StartedUtc)
            .ToList();
    }
}
