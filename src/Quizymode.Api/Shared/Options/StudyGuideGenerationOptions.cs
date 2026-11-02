namespace Quizymode.Api.Shared.Options;

/// <summary>
/// Settings for study guide section generation (AC 6.6): per-tier quotas, the global monthly budget, the
/// Postgres-backed job queue (poll interval, batch size, lease, attempts, free-tier delay) and LLM call limits.
/// Bound from the <c>StudyGuideGeneration</c> configuration section.
/// </summary>
internal sealed record class StudyGuideGenerationOptions
{
    public const string SectionName = "StudyGuideGeneration";

    /// <summary>Maximum number of section generations queued (cache misses) per UTC calendar month across all users.</summary>
    public int MonthlySectionBudget { get; set; } = 1000;

    public int FreeDailySections { get; set; } = 10;

    public int FreeMonthlySections { get; set; } = 60;

    public int PremiumDailySections { get; set; } = 50;

    public int PremiumMonthlySections { get; set; } = 1000;

    /// <summary>Free-tier jobs become due this many minutes after they are queued; premium jobs are due immediately.</summary>
    public int FreeTierDelayMinutes { get; set; } = 10;

    /// <summary>"Make a quiz" (#363) generates and saves a document only when at most this many sections still need questions.</summary>
    public int QuickPathMaxSections { get; set; } = 3;

    /// <summary>Free-tier delay for quick-path jobs (default none); the manual flow keeps <see cref="FreeTierDelayMinutes"/>.</summary>
    public int QuickPathFreeTierDelayMinutes { get; set; }

    /// <summary>Documents the auto-save sweep handles per worker tick.</summary>
    public int AutoSaveBatchSize { get; set; } = 20;

    /// <summary>Failed auto-save attempts before a section is marked Failed and left to the manual review flow.</summary>
    public int AutoSaveMaxAttempts { get; set; } = 3;

    public int PollIntervalSeconds { get; set; } = 15;

    public int ClaimBatchSize { get; set; } = 2;

    public int LeaseMinutes { get; set; } = 5;

    public int MaxAttempts { get; set; } = 3;

    public int MaxQuestions { get; set; } = 20;

    public int MaxTokens { get; set; } = 8000;

    public double Temperature { get; set; } = 0.2;

    public int VendorTimeoutSeconds { get; set; } = 120;

    /// <summary>LLM attempt log rows older than this are trimmed by the daily cleanup.</summary>
    public int AttemptRetentionDays { get; set; } = 90;
}
