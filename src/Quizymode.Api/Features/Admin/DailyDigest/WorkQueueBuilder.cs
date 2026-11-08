using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>Moderation counts shared by the admin Overview work queue and the daily digest (#509); a point-in-time snapshot.</summary>
internal static class WorkQueueBuilder
{
    internal sealed record Counts(
        int ItemsAwaitingReview,
        int PendingPrivateKeywords,
        int IdeasAwaitingModeration,
        int PicturesAwaitingReview,
        DateTime? OldestPictureSubmittedAt);

    internal static async Task<Counts> BuildAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        int picturesAwaiting = await db.Items.CountAsync(
            item => item.ImageReviewState == ItemImageReviewState.PendingReview, cancellationToken);
        DateTime? oldestPictureSubmittedAt = picturesAwaiting == 0
            ? null
            : await (from review in db.ItemImageReviews
                     join item in db.Items on review.ItemId equals item.Id
                     where item.ImageReviewState == ItemImageReviewState.PendingReview && review.Revision == item.ImageRevision
                     select (DateTime?)review.SubmittedAt).MinAsync(cancellationToken);

        return new Counts(
            await db.Items.CountAsync(item => item.ReadyForReview, cancellationToken),
            await db.Keywords.CountAsync(
                keyword => keyword.IsPrivate && keyword.IsReviewPending
                    && db.ItemKeywords.Any(itemKeyword => itemKeyword.KeywordId == keyword.Id),
                cancellationToken),
            await db.Ideas.CountAsync(idea => idea.ModerationState == IdeaModerationState.PendingReview, cancellationToken),
            picturesAwaiting,
            oldestPictureSubmittedAt);
    }
}
