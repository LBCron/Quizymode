namespace Quizymode.Api.Shared.Models;

public sealed class Item
{
    public Guid Id { get; set; }

    public bool IsRepoManaged { get; set; }

    public bool IsPrivate { get; set; }

    public string Question { get; set; } = string.Empty;

    public ItemSpeechSupport? QuestionSpeech { get; set; }

    public string CorrectAnswer { get; set; } = string.Empty;

    public ItemSpeechSupport? CorrectAnswerSpeech { get; set; }

    // Stored as JSONB in PostgreSQL - EF Core handles this automatically
    public List<string> IncorrectAnswers { get; set; } = new(); // 0..4

    public Dictionary<int, ItemSpeechSupport> IncorrectAnswerSpeech { get; set; } = new();

    public string Explanation { get; set; } = string.Empty;

    public string FuzzySignature { get; set; } = string.Empty; // hex of 64-bit SimHash

    public int FuzzyBucket { get; set; } // top 8 bits (0..255)

    public string CreatedBy { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public bool ReadyForReview { get; set; }

    public string? Source { get; set; }

    /// <summary>
    /// Optional short group label (max 30) used by the Sort It game (#359).
    /// </summary>
    public string? GroupLabel { get; set; }

    /// <summary>
    /// Optional curated question picture key (#407), e.g. "curated:flags/fr". Set by seed sync only.
    /// </summary>
    public string? QuestionImageKey { get; set; }

    /// <summary>Alt text for <see cref="QuestionImageKey"/>; present exactly when the key is.</summary>
    public string? QuestionImageAlt { get; set; }

    /// <summary>
    /// Optional curated explanation picture key (#403), e.g. "curated:diagrams/pythagorean-theorem".
    /// Shown only after the answer is revealed. Set by seed sync only.
    /// </summary>
    public string? ExplanationImageKey { get; set; }

    /// <summary>Alt text for <see cref="ExplanationImageKey"/>; present exactly when the key is.</summary>
    public string? ExplanationImageAlt { get; set; }

    /// <summary>Starter-quiz "world" (#462), one of <c>StarterWorlds.All</c>. Set by seed sync only; null exactly when <see cref="WowLine"/> is.</summary>
    public string? StarterWorld { get; set; }

    /// <summary>One-line "wow" fact (max 140) shown after a starter answer (#462). Set by seed sync only.</summary>
    public string? WowLine { get; set; }

    /// <summary>Uploaded question picture (#400); when set, <see cref="QuestionImageKey"/> is <c>media:{assetId:N}</c>.</summary>
    public Guid? QuestionImageAssetId { get; set; }

    /// <summary>Uploaded explanation picture (#400); when set, <see cref="ExplanationImageKey"/> is <c>media:{assetId:N}</c>.</summary>
    public Guid? ExplanationImageAssetId { get; set; }

    /// <summary>Optional credit line for an uploaded question picture (max 300).</summary>
    public string? QuestionImageAttribution { get; set; }

    /// <summary>Optional credit line for an uploaded explanation picture (max 300).</summary>
    public string? ExplanationImageAttribution { get; set; }

    /// <summary>
    /// Review state of the item's uploaded pictures (#400, AC 3.25); null exactly when neither picture slot holds an upload.
    /// Pictures are shown to others only while this is null or <see cref="ItemImageReviewState.Approved"/>.
    /// </summary>
    public ItemImageReviewState? ImageReviewState { get; set; }

    /// <summary>Monotonic counter of picture submissions and removals; never reset. Decisions bind to it.</summary>
    public int ImageRevision { get; set; }

    /// <summary>
    /// Optional link to the Upload record that created this item (e.g. bulk upload from JSON).
    /// </summary>
    public Guid? UploadId { get; set; }

    /// <summary>
    /// Optional factual risk indicator 0-1: higher = more uncertainty or inferred content.
    /// </summary>
    public decimal? FactualRisk { get; set; }

    /// <summary>
    /// Optional review notes: ambiguity, assumptions, outdated info, etc.
    /// </summary>
    public string? ReviewComments { get; set; }

    // Navigation property for keywords (not mapped directly, accessed via ItemKeywords)
    public List<ItemKeyword> ItemKeywords { get; set; } = new();

    // Navigation property for category
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }

    /// <summary>Rank-1 navigation keyword (primary topic). Required for items in navigation tree.</summary>
    public Guid? NavigationKeywordId1 { get; set; }
    public Keyword? NavigationKeyword1 { get; set; }

    /// <summary>Rank-2 navigation keyword (subtopic). Required for items in navigation tree.</summary>
    public Guid? NavigationKeywordId2 { get; set; }
    public Keyword? NavigationKeyword2 { get; set; }
}
