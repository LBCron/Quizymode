namespace Quizymode.Api.Shared.Models;

/// <summary>
/// The allowlist of engagement events and the optional fields each one may carry. Anything not
/// listed here is rejected, which keeps the event table from turning into a free-form payload store.
/// </summary>
public static class AnalyticsEventCatalog
{
    public const string QuickQuizStarted = "quick_quiz_started";
    public const string QuizCompleted = "quiz_completed";
    public const string SignupPromptViewed = "signup_prompt_viewed";
    public const string SignupPromptClicked = "signup_prompt_clicked";
    public const string SignupFormStarted = "signup_form_started";
    public const string SignupSubmitted = "signup_submitted";
    public const string SignupConfirmationShown = "signup_confirmation_shown";
    public const string SignupConfirmed = "signup_confirmed";
    public const string SignInCompleted = "sign_in_completed";
    public const string GuestStateImported = "guest_state_imported";

    // Study engagement (ANALYTICS-007). A quiz run starts with QuickQuizStarted and ends with QuizCompleted.
    public const string QuestionAnswered = "question_answered";
    public const string FlashcardsStarted = "flashcards_started";
    public const string FlashcardRevealed = "flashcard_revealed";
    public const string FlashcardGraded = "flashcard_graded";
    public const string QuizResultShared = "quiz_result_shared";

    // Global search (#321). Neither event carries query text; neither is a funnel step.
    public const string SearchPerformed = "search_performed";
    public const string SearchResultClicked = "search_result_clicked";

    // Topic suggestion (#322/#323). No event carries text; none is a funnel step. The context is the topic path
    // (category/l1/l2) and is omitted when the saved item is private.
    public const string TopicSuggestionShown = "topic_suggestion_shown";
    public const string TopicSuggestionAccepted = "topic_suggestion_accepted";
    public const string TopicSuggestionOverridden = "topic_suggestion_overridden";

    // Games (#352/#353). Run-scoped; neither event carries item text or elapsed time and neither is a funnel step.
    public const string GameStarted = "game_started";
    public const string GameCompleted = "game_completed";

    // Start page (#462). One per run: the card or button tapped on the end screen. Not a funnel step.
    public const string StarterNextClicked = "starter_next_clicked";

    /// <summary>Optional fields an event may carry beyond name, session, path, and context.</summary>
    [Flags]
    public enum EventFields
    {
        None = 0,
        RunId = 1,
        Score = 2,
        Total = 4,
        ItemId = 8,
        Position = 16,
        IsCorrect = 32
    }

    /// <param name="Allowed">Fields the event may carry; any other optional field is a validation error.</param>
    /// <param name="Required">Fields the event must carry.</param>
    public sealed record EventRule(EventFields Allowed, EventFields Required);

    public static readonly IReadOnlyDictionary<string, EventRule> Rules = new Dictionary<string, EventRule>(StringComparer.Ordinal)
    {
        // Run-scoped: the run id makes the server-side dedupe key, so one run stores one start and one completion.
        [QuickQuizStarted] = new(EventFields.RunId | EventFields.Total, EventFields.RunId),
        [QuizCompleted] = new(EventFields.RunId | EventFields.Score | EventFields.Total, EventFields.RunId | EventFields.Score | EventFields.Total),
        [SignupPromptViewed] = new(EventFields.None, EventFields.None),
        [SignupPromptClicked] = new(EventFields.None, EventFields.None),
        [SignupFormStarted] = new(EventFields.None, EventFields.None),
        [SignupSubmitted] = new(EventFields.None, EventFields.None),
        [SignupConfirmationShown] = new(EventFields.None, EventFields.None),
        [SignupConfirmed] = new(EventFields.None, EventFields.None),
        [SignInCompleted] = new(EventFields.None, EventFields.None),
        [GuestStateImported] = new(EventFields.None, EventFields.None),
        // Item-level: the dedupe key adds the item id, so one run stores one answer or reveal per item.
        [QuestionAnswered] = new(
            EventFields.RunId | EventFields.ItemId | EventFields.Position | EventFields.IsCorrect,
            EventFields.RunId | EventFields.ItemId | EventFields.Position | EventFields.IsCorrect),
        [FlashcardsStarted] = new(EventFields.RunId | EventFields.Total, EventFields.RunId),
        [FlashcardRevealed] = new(
            EventFields.RunId | EventFields.ItemId | EventFields.Position,
            EventFields.RunId | EventFields.ItemId | EventFields.Position),
        // Self-graded flashcard (#251): IsCorrect is true for "Got it". Not a funnel step.
        [FlashcardGraded] = new(
            EventFields.RunId | EventFields.ItemId | EventFields.Position | EventFields.IsCorrect,
            EventFields.RunId | EventFields.ItemId | EventFields.Position | EventFields.IsCorrect),
        // A completed run's result was shared (#253): one per run. Not a funnel step.
        [QuizResultShared] = new(
            EventFields.RunId | EventFields.Score | EventFields.Total,
            EventFields.RunId | EventFields.Score | EventFields.Total),
        // One per committed search (result click, Enter, See all, or the /search page loading); Total is the
        // number of results shown. The query text is never sent.
        [SearchPerformed] = new(EventFields.Total, EventFields.Total),
        // Position is the 1-based rank of the clicked result; the context is the public target (never a private one).
        [SearchResultClicked] = new(EventFields.Position, EventFields.Position),
        // Run-scoped (one per form session). Total is the number of chips shown; the context is the chips' reason.
        [TopicSuggestionShown] = new(EventFields.RunId | EventFields.Total, EventFields.RunId | EventFields.Total),
        // A saved item used a suggested chip; Position is the chip's 1-based rank.
        [TopicSuggestionAccepted] = new(EventFields.RunId | EventFields.Position, EventFields.RunId | EventFields.Position),
        // A saved item used a topic other than the suggested chips.
        [TopicSuggestionOverridden] = new(EventFields.RunId, EventFields.RunId),
        // Games: Total is the pair count; Score is the pairs matched without a miss on that pair's question.
        [GameStarted] = new(EventFields.RunId | EventFields.Total, EventFields.RunId | EventFields.Total),
        [GameCompleted] = new(
            EventFields.RunId | EventFields.Score | EventFields.Total,
            EventFields.RunId | EventFields.Score | EventFields.Total),
        // Start page end screen: Position 1-3 is an explore-next card, 4 is "Another random five", 5 is "Explore all
        // topics"; the context id is next:{world} for cards. One per run per session.
        [StarterNextClicked] = new(EventFields.RunId | EventFields.Position, EventFields.RunId | EventFields.Position)
    };

    /// <summary>The initial conversion funnel, in step order, as reported to admins.</summary>
    public static readonly IReadOnlyList<string> FunnelSteps =
    [
        QuickQuizStarted,
        QuizCompleted,
        SignupPromptViewed,
        SignupPromptClicked,
        SignupFormStarted,
        SignupSubmitted,
        SignupConfirmationShown,
        SignupConfirmed,
        SignInCompleted,
        GuestStateImported
    ];

    public static readonly IReadOnlySet<string> ContextTypes = new HashSet<string>(StringComparer.Ordinal)
    {
        "auth",
        "category",
        "collection",
        "daily",
        "flashcards",
        "game",
        "home",
        "item",
        "learn",
        "mine",
        "quiz",
        "review",
        "search",
        "topic"
    };

    public const int MaxScoreOrTotal = 500;

    /// <summary>
    /// Flashcard decks may hold as many cards as one items page returns (the items PageSize cap), which the
    /// web client mirrors as EXPLORE_MAX_ITEMS. Only flashcard events use this larger bound.
    /// </summary>
    public const int MaxFlashcardDeckSize = 1000;

    /// <summary>
    /// Quiz runs may hold as many questions as one items page returns (the GetItems pageSize cap), which the
    /// Quiz size control mirrors. Quiz-run events use this larger bound for position, score, and total (#395).
    /// </summary>
    public const int MaxQuizRunSize = 1000;
}
