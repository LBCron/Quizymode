using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Features.Media;
internal static class MediaRevocation
{
    /// <summary>Caller holds the shared media transaction lock; every reference advances with its audit identity.</summary>
    internal static async Task<int> ApplyAsync(ApplicationDbContext db, MediaAsset asset, string actor, string reason, DateTime now, CancellationToken ct)
    {
        asset.DeletedAt ??= now; asset.UpdatedAt = now;
        List<Item> references = await db.Items.Where(x => x.QuestionImageAssetId == asset.Id || x.ExplanationImageAssetId == asset.Id).ToListAsync(ct);
        List<Guid> ids = references.Select(x => x.Id).ToList();
        List<ItemImageReview> previous = await db.ItemImageReviews.AsNoTracking().Where(x => ids.Contains(x.ItemId)).ToListAsync(ct);
        foreach (Item item in references)
        {
            if (item.ImageReviewState == ItemImageReviewState.Withdrawn) continue;
            ItemImageReview? prior = previous.FirstOrDefault(x => x.ItemId == item.Id && x.Revision == item.ImageRevision);
            db.ItemImageReviews.Add(new ItemImageReview { Id = Guid.NewGuid(), ItemId = item.Id, Revision = item.ImageRevision + 1, ContentHash = prior?.ContentHash ?? new string('0', 64), QuestionAssetId = item.QuestionImageAssetId, QuestionSha256 = prior?.QuestionSha256, ExplanationAssetId = item.ExplanationImageAssetId, ExplanationSha256 = prior?.ExplanationSha256, SubmittedBy = actor, SubmittedAt = now, Decision = "Withdrawn", DecidedBy = actor, DecidedAt = now, Reason = reason, PolicyVersion = ItemImageReviewRules.PolicyVersion });
            item.ImageRevision++; item.ImageReviewState = ItemImageReviewState.Withdrawn;
        }
        return references.Count;
    }
}
