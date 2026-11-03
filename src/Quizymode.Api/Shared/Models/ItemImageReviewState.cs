namespace Quizymode.Api.Shared.Models;

/// <summary>
/// Review state of an item's uploaded pictures (AC 3.25). Stored as text. <see cref="Withdrawn"/> is reserved for #405.
/// </summary>
public enum ItemImageReviewState
{
    PendingReview,
    Approved,
    Rejected,
    Withdrawn
}
