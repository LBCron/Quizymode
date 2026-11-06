namespace Quizymode.Api.Shared.Models;

/// <summary>
/// An uploaded study guide (PDF, DOCX, PPTX, or text) split into sections (AC 6.6). The original file is never stored:
/// only its SHA-256, the SHA-256 of the normalized extracted text, and the extracted section text, which expires
/// <see cref="ExpiresUtc"/> (30 days after the last activity).
/// </summary>
public sealed class StudyGuideDocument
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    /// <summary>pdf | docx | pptx | txt.</summary>
    public string FileType { get; set; } = string.Empty;

    /// <summary>Lowercase hex SHA-256 of the uploaded bytes (or of the pasted text's UTF-8 bytes).</summary>
    public string FileSha256 { get; set; } = string.Empty;

    /// <summary>Lowercase hex SHA-256 of the normalized extracted text; unique per user for duplicate detection.</summary>
    public string TextSha256 { get; set; } = string.Empty;

    public int? PageCount { get; set; }

    public string CategoryName { get; set; } = string.Empty;

    public string NavigationKeyword1 { get; set; } = string.Empty;

    public string NavigationKeyword2 { get; set; } = string.Empty;

    /// <summary>JSON array of optional extra keywords applied to every accepted item.</summary>
    public string? KeywordsJson { get; set; }

    /// <summary>The collection that accepted questions are added to (created on first accept).</summary>
    public Guid? CollectionId { get; set; }

    /// <summary>The owner marked this document as their primary source (e.g. the textbook); guide books defer to it (#372).</summary>
    public bool IsPrimarySource { get; set; }

    public DateTime CreatedUtc { get; set; }

    public DateTime LastActivityUtc { get; set; }

    public DateTime ExpiresUtc { get; set; }

    public List<StudyGuideSection> Sections { get; set; } = [];
}

/// <summary>One section of a study guide document: a run of pages, slides, or paragraphs of at most ~10 KB.</summary>
public sealed class StudyGuideSection
{
    public Guid Id { get; set; }

    public Guid DocumentId { get; set; }

    public int Index { get; set; }

    public string Label { get; set; } = string.Empty;

    public int? PageStart { get; set; }

    public int? PageEnd { get; set; }

    /// <summary>Extracted text (with page markers for PDFs/slides); null once the document's text has expired.</summary>
    public string? Text { get; set; }

    /// <summary>Lowercase hex SHA-256 of the normalized section text; the shared generation cache key.</summary>
    public string TextSha256 { get; set; } = string.Empty;

    public int SizeBytes { get; set; }

    /// <summary>The shared generation this section is attached to (set on the first generate request).</summary>
    public Guid? GenerationId { get; set; }

    public DateTime? RequestedUtc { get; set; }

    /// <summary>Set only by the "Make a quiz" quick path (#363): null = manual review, otherwise the server saves the generated questions.</summary>
    public StudyGuideAutoSave? AutoSave { get; set; }

    /// <summary>Failed auto-save attempts; the section becomes <see cref="StudyGuideAutoSave.Failed"/> after the cap.</summary>
    public int AutoSaveAttempts { get; set; }
}

/// <summary>Auto-save state of a quick-path section. Stored as a small integer.</summary>
public enum StudyGuideAutoSave
{
    Pending = 1,
    Saved = 2,
    Failed = 3
}

/// <summary>One section charged against a user's study guide quota. Deleted (refunded) when the generation fails.</summary>
public sealed class StudyGuideQuotaCharge
{
    public Guid Id { get; set; }

    public string UserId { get; set; } = string.Empty;

    public Guid SectionId { get; set; }

    public Guid GenerationId { get; set; }

    public DateTime ChargedUtc { get; set; }

    public int Cost { get; set; }
}

/// <summary>A generated candidate the document owner saved as an item.</summary>
public sealed class StudyGuideAcceptedCandidate
{
    public Guid DocumentId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid ItemId { get; set; }

    public DateTime AcceptedUtc { get; set; }
}
