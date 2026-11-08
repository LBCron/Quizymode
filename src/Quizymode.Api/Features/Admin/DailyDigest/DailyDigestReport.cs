namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>
/// Aggregate-only digest numbers (#509). A null section means "unavailable" (the query failed), which is different from zero.
/// The whole report is persisted as JSON so every send attempt renders identical text.
/// </summary>
internal sealed record DigestReport(
    string Kind,
    DateOnly ReportDate,
    string TimeZone,
    DateTime StartUtc,
    DateTime EndUtc,
    DaySummary Current,
    BaselineSummary? Baseline,
    WaitingSection? Waiting,
    DigestHealth? Health,
    List<string> PreviousDigests,
    string? NewVersion,
    DateTime ComputedUtc)
{
    public const string KindDaily = "Daily";
    public const string KindWindow = "Window";

    /// <summary>True when every section of the current window failed, so there is nothing worth sending.</summary>
    public bool AllUnavailable => Current.Visits is null && Current.Accounts is null && Current.Quizzes is null
        && Current.Sources is null && Current.Problems is null && Waiting is null && Health is null;
}

internal sealed record DaySummary(
    VisitsSection? Visits,
    AccountsSection? Accounts,
    QuizSection? Quizzes,
    SourcesSection? Sources,
    ProblemsSection? Problems);

internal sealed record VisitsSection(
    int PageViews,
    int Sessions,
    int EngagedSessions,
    int Browsers,
    int SessionsWithoutBrowserId,
    int NewBrowsers,
    int ReturningBrowsers,
    int ItemSteps);

internal sealed record AccountsSection(
    int ActiveAccounts,
    int NewAccounts,
    int AnonymousSessions,
    int ConvertedSessions,
    int AuthenticatedSessions);

internal sealed record TopicCount(string Label, int Starts);

internal sealed record QuizSection(int Starts, int Completed, int Participants, List<TopicCount> Topics);

internal sealed record SourceRow(string Name, int Sessions, int EngagedSessions, int QuizStarts, int ConvertedSessions, int NewAccounts);

internal sealed record SourcesSection(List<SourceRow> Top, SourceRow LinkedIn);

internal sealed record ProblemsSection(
    int ErrorReports,
    int ErrorSessions,
    int ErrorUsers,
    int NewErrorGroups,
    int ProblemReports,
    int OtherFeedback,
    int PictureReports);

internal sealed record WaitingSection(
    int ItemsToReview,
    int PrivateKeywords,
    int Ideas,
    int Pictures,
    int? OldestPictureAgeDays,
    int NewFeedback);

internal sealed record DigestHealth(int RawPageViews, int RawEvents);

/// <summary>
/// Averages of the comparison windows. <see cref="Label"/> is "7-day avg" for a daily digest or "previous window" for
/// an ad hoc window. A value is null when no comparison window had it.
/// </summary>
internal sealed record BaselineSummary(string Label, int Days, int ExpectedDays, Dictionary<string, double?> Averages);
