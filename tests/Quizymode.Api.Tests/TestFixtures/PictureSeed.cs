using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Tests.TestFixtures;

/// <summary>Seeding helpers for uploaded-picture items (#400), shared by the SQLite and PostgreSQL tests.</summary>
internal static class PictureSeed
{
    public static string Sha(char c = 'a') => new(c, 64);

    public static string ObjectKeyOf(MediaAsset asset) => $"normalized/v1/{asset.Id:N}/{asset.Sha256}.webp";

    public static MediaAsset AddAsset(
        ApplicationDbContext db,
        string ownerUserId,
        string? sha256 = null,
        MediaAssetState state = MediaAssetState.Ready,
        bool deleted = false)
    {
        Guid id = Guid.NewGuid();
        string sha = sha256 ?? Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        MediaAsset asset = new()
        {
            Id = id,
            OwnerUserId = ownerUserId,
            State = state,
            ObjectKey = state == MediaAssetState.Processing ? null : $"normalized/v1/{id:N}/{sha}.webp",
            Sha256 = sha,
            Width = 10,
            Height = 10,
            Bytes = 100,
            Format = "webp",
            SourceFormat = "png",
            SourceBytes = 200,
            ProcessingVersion = 1,
            FailureCode = state == MediaAssetState.Failed ? "Media.Unreadable" : null,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            DeletedAt = deleted ? DateTime.UtcNow : null
        };
        db.MediaAssets.Add(asset);
        return asset;
    }

    /// <summary>
    /// An item holding an uploaded question picture (and optionally an explanation picture) in <paramref name="state"/>, revision 1,
    /// with its submission row (decided when the state is Approved or Rejected).
    /// </summary>
    public static Item AddPictureItem(
        ApplicationDbContext db,
        Category category,
        string creator,
        bool isPrivate,
        ItemImageReviewState state,
        MediaAsset question,
        MediaAsset? explanation = null)
    {
        Item item = VisibilitySeed.AddItem(db, category, creator, isPrivate);
        item.Explanation = explanation is null ? string.Empty : "Because";
        item.QuestionImageAssetId = question.Id;
        item.QuestionImageKey = $"media:{question.Id:N}";
        item.QuestionImageAlt = "A question picture";
        if (explanation is not null)
        {
            item.ExplanationImageAssetId = explanation.Id;
            item.ExplanationImageKey = $"media:{explanation.Id:N}";
            item.ExplanationImageAlt = "An explanation picture";
        }

        item.ImageReviewState = state;
        item.ImageRevision = 1;
        string? decision = state switch
        {
            ItemImageReviewState.Approved => "Approved",
            ItemImageReviewState.Rejected => "Rejected",
            _ => null
        };
        db.ItemImageReviews.Add(new ItemImageReview
        {
            Id = Guid.NewGuid(),
            ItemId = item.Id,
            Revision = 1,
            ContentHash = new string('c', 64),
            QuestionAssetId = question.Id,
            QuestionSha256 = question.Sha256,
            ExplanationAssetId = explanation?.Id,
            ExplanationSha256 = explanation?.Sha256,
            SubmittedBy = creator,
            SubmittedAt = DateTime.UtcNow,
            Decision = decision,
            DecidedBy = decision is null ? null : "admin-id",
            DecidedAt = decision is null ? null : DateTime.UtcNow
        });
        return item;
    }
}
