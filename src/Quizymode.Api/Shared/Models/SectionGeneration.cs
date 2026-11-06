namespace Quizymode.Api.Shared.Models;

public enum SectionGenerationStatus
{
    Pending = 0,
    Processing = 1,
    Completed = 2,
    Failed = 3
}

public enum StudyGuideTier
{
    Free = 0,
    Premium = 1
}

/// <summary>
/// A system-owned, shared generation job and cache entry for one section text (AC 6.6). Keyed by
/// (<see cref="TextSha256"/>, <see cref="Mode"/>, <see cref="PromptVersion"/>) so identical section text from any user
/// is generated once. Doubles as the Postgres job queue row: due when Pending and <see cref="NotBeforeUtc"/> has passed,
/// or when Processing and the <see cref="LeaseUntilUtc"/> lease has expired.
/// </summary>
public sealed class SectionGeneration
{
    public const string GuideOnlyMode = "GuideOnly";

    /// <summary>Mode for the clinical scenario question style (#368); cached separately from <see cref="GuideOnlyMode"/>.</summary>
    public const string ClinicalScenarioMode = "ClinicalScenario";

    /// <summary>Maps a validated question style (<c>Recall</c>, <c>ClinicalScenario</c> or null) to its cache mode.</summary>
    public static string ModeFor(string? questionStyle) =>
        string.Equals(questionStyle, "ClinicalScenario", StringComparison.Ordinal) ? ClinicalScenarioMode : GuideOnlyMode;

    /// <summary>Current prompt version for <see cref="GuideOnlyMode"/>.</summary>
    public const int CurrentPromptVersion = 1;

    public Guid Id { get; set; }

    public string TextSha256 { get; set; } = string.Empty;

    public string Mode { get; set; } = GuideOnlyMode;

    public int PromptVersion { get; set; } = CurrentPromptVersion;

    public SectionGenerationStatus Status { get; set; }

    public StudyGuideTier Tier { get; set; }

    public DateTime NotBeforeUtc { get; set; }

    public DateTime? LeaseUntilUtc { get; set; }

    public int Attempts { get; set; }

    public string? Vendor { get; set; }

    public string? Model { get; set; }

    public int? InputTokens { get; set; }

    public int? OutputTokens { get; set; }

    public int DroppedCount { get; set; }

    /// <summary>User-safe failure reason (at most 500 characters).</summary>
    public string? Error { get; set; }

    /// <summary>Section text to process; cleared once the generation completes or fails.</summary>
    public string? SourceText { get; set; }

    public DateTime CreatedUtc { get; set; }

    /// <summary>When this generation was last queued (created or retried); counts toward the global monthly budget.</summary>
    public DateTime QueuedUtc { get; set; }

    public DateTime? CompletedUtc { get; set; }

    public List<GenerationCandidate> Candidates { get; set; } = [];
}

/// <summary>A generated question that passed validation and the source-quote check.</summary>
public sealed class GenerationCandidate
{
    public Guid Id { get; set; }

    public Guid GenerationId { get; set; }

    public int Index { get; set; }

    public string Question { get; set; } = string.Empty;

    public string CorrectAnswer { get; set; } = string.Empty;

    public string IncorrectAnswersJson { get; set; } = "[]";

    public string Explanation { get; set; } = string.Empty;

    public string SourceQuote { get; set; } = string.Empty;

    public int? Page { get; set; }
}
