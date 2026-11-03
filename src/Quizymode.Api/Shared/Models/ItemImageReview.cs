namespace Quizymode.Api.Shared.Models;

/// <summary>
/// One submission of an item's uploaded pictures for review (#400, AC 3.25), keyed by (<see cref="ItemId"/>, <see cref="Revision"/>).
/// Kept as an audit trail, so it has no foreign key to the item and survives item deletion.
/// </summary>
public sealed class ItemImageReview
{
    public Guid Id { get; set; }

    public Guid ItemId { get; set; }

    /// <summary>The <see cref="Item.ImageRevision"/> this submission created.</summary>
    public int Revision { get; set; }

    /// <summary>Lowercase hex SHA-256 over the canonical content the reviewer saw (see ItemImageReviewRules.ComputeContentHash).</summary>
    public string ContentHash { get; set; } = string.Empty;

    public Guid? QuestionAssetId { get; set; }

    public string? QuestionSha256 { get; set; }

    public Guid? ExplanationAssetId { get; set; }

    public string? ExplanationSha256 { get; set; }

    /// <summary>User id of whoever saved the content that created this revision.</summary>
    public string SubmittedBy { get; set; } = string.Empty;

    public DateTime SubmittedAt { get; set; }

    /// <summary>Approved | Rejected | Superseded; null while undecided.</summary>
    public string? Decision { get; set; }

    public string? DecidedBy { get; set; }

    public DateTime? DecidedAt { get; set; }

    public string? Reason { get; set; }

    /// <summary>Picture policy version in force when the decision was made.</summary>
    public string? PolicyVersion { get; set; }
}

internal static class ItemImageReviewDecisions
{
    public const string Approved = "Approved";
    public const string Rejected = "Rejected";
    public const string Superseded = "Superseded";
}
