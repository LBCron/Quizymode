namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>Wire shapes shared by the study guide document endpoints (AC 6.6). JSON is camelCase.</summary>
public static class StudyGuideDocumentContracts
{
    /// <summary>Tier is "Free" or "Premium"; remainingToday = min(daily left, monthly left).</summary>
    public sealed record Quota(
        string Tier,
        int DailyLimit,
        int DailyUsed,
        int MonthlyLimit,
        int MonthlyUsed,
        int RemainingToday);

    public sealed record DocumentSummary(
        string Id,
        string Title,
        string FileType,
        int SectionCount,
        int GeneratedSectionCount,
        int AcceptedCount,
        string? CollectionId,
        DateTime CreatedUtc,
        DateTime LastActivityUtc,
        DateTime ExpiresUtc,
        bool IsPrimarySource);

    public sealed record Document(
        string Id,
        string Title,
        string FileType,
        int? PageCount,
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        List<string> Keywords,
        string? CollectionId,
        DateTime CreatedUtc,
        DateTime ExpiresUtc,
        bool IsDuplicate,
        Quota Quota,
        List<Section> Sections,
        bool IsPrimarySource);

    /// <summary>
    /// Status: New | Queued | Processing | Generated | Failed. Candidates are listed only when Generated.
    /// AutoSave is null for manual review, otherwise Pending | Saved | Failed (the "Make a quiz" quick path saves for you).
    /// </summary>
    public sealed record Section(
        string Id,
        int Index,
        string Label,
        int? PageStart,
        int? PageEnd,
        string Preview,
        int SizeBytes,
        bool TextExpired,
        string Status,
        bool Cached,
        DateTime? NotBeforeUtc,
        string? Error,
        int DroppedCount,
        List<Candidate> Candidates,
        string? AutoSave);

    /// <summary>ItemId is the saved item's id, only when the candidate was accepted and that item still exists.</summary>
    public sealed record Candidate(
        string Id,
        int Index,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        string SourceQuote,
        int? Page,
        bool Accepted,
        string? ItemId);
}
