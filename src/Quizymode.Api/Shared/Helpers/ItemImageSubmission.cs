using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>
/// Database side of item picture review (#400, AC 3.25), shared by POST /items and PUT /items/{id}: resolving slot input to
/// owned Ready assets, writing slot columns, and claiming a new revision.
/// </summary>
internal static class ItemImageSubmission
{
    private static readonly string[] ClaimedProperties =
    [
        nameof(Item.ImageRevision), nameof(Item.ImageReviewState),
        nameof(Item.QuestionImageAssetId), nameof(Item.QuestionImageKey), nameof(Item.QuestionImageAlt), nameof(Item.QuestionImageAttribution),
        nameof(Item.ExplanationImageAssetId), nameof(Item.ExplanationImageKey), nameof(Item.ExplanationImageAlt), nameof(Item.ExplanationImageAttribution)
    ];

    /// <summary>A slot that holds a curated (seed-managed) picture rather than an upload.</summary>
    public static bool IsCurated(string? key, Guid? assetId) => key is not null && assetId is null;

    public static string? NormalizeAttribution(string? attribution) =>
        string.IsNullOrWhiteSpace(attribution) ? null : attribution.Trim();

    /// <summary>
    /// Resolves one slot. Null input keeps the current upload; <c>remove</c> clears it; an <c>assetId</c> sets or replaces it and
    /// must name a Ready, undeleted asset owned by <paramref name="ownerUserId"/> (the item's creator). Every unusable asset is the same
    /// <see cref="ItemImageReviewRules.AssetInvalid"/> error.
    /// </summary>
    public static async Task<(PictureSlot? Slot, Error? Error)> ResolveSlotAsync(
        ApplicationDbContext db,
        string ownerUserId,
        Guid? currentAssetId,
        string? currentAlt,
        string? currentAttribution,
        ImageSlotInput? input,
        CancellationToken cancellationToken)
    {
        if (input is null)
        {
            if (currentAssetId is null)
            {
                return (null, null);
            }

            string currentSha = await db.MediaAssets.AsNoTracking()
                .Where(a => a.Id == currentAssetId.Value)
                .Select(a => a.Sha256)
                .FirstAsync(cancellationToken);
            return (new PictureSlot(currentAssetId.Value, currentSha, currentAlt ?? string.Empty, currentAttribution), null);
        }

        if (input.Remove == true)
        {
            return (null, null);
        }

        if (input.AssetId is not Guid assetId)
        {
            return (null, ItemImageReviewRules.AssetInvalid());
        }

        string? sha = await db.MediaAssets.AsNoTracking()
            .Where(a => a.Id == assetId
                && a.OwnerUserId == ownerUserId
                && a.State == MediaAssetState.Ready
                && a.DeletedAt == null)
            .Select(a => a.Sha256)
            .FirstOrDefaultAsync(cancellationToken);
        if (sha is null)
        {
            return (null, ItemImageReviewRules.AssetInvalid());
        }

        return (new PictureSlot(assetId, sha, (input.AltText ?? string.Empty).Trim(), NormalizeAttribution(input.Attribution)), null);
    }

    /// <summary>Writes the two slots onto the item, leaving a curated slot untouched.</summary>
    public static void ApplySlots(Item item, PictureSlot? question, PictureSlot? explanation)
    {
        if (!IsCurated(item.QuestionImageKey, item.QuestionImageAssetId))
        {
            item.QuestionImageAssetId = question?.AssetId;
            item.QuestionImageKey = question is null ? null : ItemImageReviewRules.KeyOf(question.AssetId);
            item.QuestionImageAlt = question?.AltText;
            item.QuestionImageAttribution = question?.Attribution;
        }

        if (!IsCurated(item.ExplanationImageKey, item.ExplanationImageAssetId))
        {
            item.ExplanationImageAssetId = explanation?.AssetId;
            item.ExplanationImageKey = explanation is null ? null : ItemImageReviewRules.KeyOf(explanation.AssetId);
            item.ExplanationImageAlt = explanation?.AltText;
            item.ExplanationImageAttribution = explanation?.Attribution;
        }
    }

    public static ItemImageReview NewSubmission(
        Guid itemId,
        int revision,
        string contentHash,
        PictureSlot? question,
        PictureSlot? explanation,
        string submittedBy) => new()
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            Revision = revision,
            ContentHash = contentHash,
            QuestionAssetId = question?.AssetId,
            QuestionSha256 = question?.Sha256,
            ExplanationAssetId = explanation?.AssetId,
            ExplanationSha256 = explanation?.Sha256,
            SubmittedBy = submittedBy,
            SubmittedAt = DateTime.UtcNow
        };

    /// <summary>
    /// Opens the write transaction for Add/Update unless the caller already holds one. Returns null when the provider has no
    /// transactions (the unit-test in-memory provider).
    /// </summary>
    public static async Task<IDbContextTransaction?> BeginAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        if (!db.Database.IsRelational() || db.Database.CurrentTransaction is not null)
        {
            return null;
        }

        try
        {
            return await db.Database.BeginTransactionAsync(cancellationToken);
        }
        catch (NotSupportedException)
        {
            return null;
        }
    }

    /// <summary>
    /// Claims the next revision of an existing item: one conditional UPDATE on <c>ImageRevision = N</c> that writes the new
    /// revision, state and both slots together (the review-state check constraint requires them to move as one). Another
    /// edit or a decision that got there first leaves zero rows, so this save is refused with
    /// <see cref="ItemImageReviewRules.ReviewStale"/> instead of overwriting it. On success the tracked item is brought in line
    /// and its original values are reset, so the later SaveChanges does not write these columns a second time.
    /// </summary>
    public static async Task<Error?> ClaimRevisionAsync(
        ApplicationDbContext db,
        Item item,
        ImageReviewTransition transition,
        PictureSlot? question,
        PictureSlot? explanation,
        string? contentHash,
        string submittedBy,
        CancellationToken cancellationToken)
    {
        int expectedRevision = item.ImageRevision;
        ApplySlots(item, question, explanation);
        item.ImageRevision = transition.Revision;
        item.ImageReviewState = transition.State;

        int claimed = await db.Items
            .Where(i => i.Id == item.Id && i.ImageRevision == expectedRevision)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(i => i.ImageRevision, item.ImageRevision)
                .SetProperty(i => i.ImageReviewState, item.ImageReviewState)
                .SetProperty(i => i.QuestionImageAssetId, item.QuestionImageAssetId)
                .SetProperty(i => i.QuestionImageKey, item.QuestionImageKey)
                .SetProperty(i => i.QuestionImageAlt, item.QuestionImageAlt)
                .SetProperty(i => i.QuestionImageAttribution, item.QuestionImageAttribution)
                .SetProperty(i => i.ExplanationImageAssetId, item.ExplanationImageAssetId)
                .SetProperty(i => i.ExplanationImageKey, item.ExplanationImageKey)
                .SetProperty(i => i.ExplanationImageAlt, item.ExplanationImageAlt)
                .SetProperty(i => i.ExplanationImageAttribution, item.ExplanationImageAttribution),
                cancellationToken);
        if (claimed == 0)
        {
            return ItemImageReviewRules.ReviewStale();
        }

        EntityEntry<Item> entry = db.Entry(item);
        foreach (string name in ClaimedProperties)
        {
            PropertyEntry property = entry.Property(name);
            property.OriginalValue = property.CurrentValue;
        }

        await db.ItemImageReviews
            .Where(r => r.ItemId == item.Id && r.Revision == expectedRevision && r.Decision == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(r => r.Decision, ItemImageReviewDecisions.Superseded), cancellationToken);

        if (transition.CreatesSubmission)
        {
            db.ItemImageReviews.Add(NewSubmission(item.Id, transition.Revision, contentHash!, question, explanation, submittedBy));
        }

        return null;
    }
}
