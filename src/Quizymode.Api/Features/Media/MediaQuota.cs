using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Media;

/// <summary>
/// Durable per-account and global upload quotas (AC 3.28). Every count is read from the database, so limits hold across
/// restarts and API instances. Nothing here reads or logs picture content.
/// </summary>
internal static class MediaQuota
{
    private static readonly TimeSpan Window = TimeSpan.FromHours(24);

    /// <summary>Cheap refusal before the request body is read.</summary>
    public static async Task<MediaProblem?> CheckBeforeUploadAsync(
        ApplicationDbContext db,
        string userId,
        MediaOptions options,
        DateTime now,
        CancellationToken cancellationToken)
    {
        DateTime since = now - Window;

        int userUploads = await db.MediaAssets.CountAsync(x => x.OwnerUserId == userId && x.CreatedAt >= since, cancellationToken);
        if (userUploads >= options.MaxUploadsPerUserPerDay)
        {
            return MediaErrors.QuotaExceeded("daily upload limit", options.MaxUploadsPerUserPerDay);
        }

        long userBytes = await RetainedBytesAsync(db, userId, cancellationToken);
        if (userBytes >= options.MaxRetainedBytesPerUser)
        {
            return MediaErrors.QuotaExceeded("stored picture limit", options.MaxRetainedBytesPerUser / (1024 * 1024), "MiB");
        }

        int pending = await db.Items.CountAsync(
            x => x.CreatedBy == userId && x.ImageReviewState == ItemImageReviewState.PendingReview,
            cancellationToken);
        if (pending >= options.MaxPendingReviewsPerUser)
        {
            return MediaErrors.QuotaExceeded("pending picture review limit", options.MaxPendingReviewsPerUser);
        }

        int globalUploads = await db.MediaAssets.CountAsync(x => x.CreatedAt >= since, cancellationToken);
        if (globalUploads >= options.MaxUploadsGlobalPerDay)
        {
            return MediaErrors.GlobalCeiling;
        }

        long globalBytes = await db.MediaAssets
            .Where(x => x.DeletedAt == null && x.State != MediaAssetState.Failed)
            .SumAsync(x => (long)x.Bytes, cancellationToken);
        return globalBytes >= options.MaxRetainedBytesGlobal ? MediaErrors.GlobalCeiling : null;
    }

    /// <summary>
    /// Race-safe recheck after the row is inserted: a row is admitted only when its rank among the rows that exist
    /// (ordered by creation time) is within the limits, so concurrent uploads cannot all slip past a pre-check.
    /// Ties are both refused, which errs on the side of the limit.
    /// </summary>
    public static async Task<MediaProblem?> CheckAfterInsertAsync(
        ApplicationDbContext db,
        MediaAsset asset,
        MediaOptions options,
        CancellationToken cancellationToken)
    {
        DateTime since = asset.CreatedAt - Window;
        int rank = await db.MediaAssets.CountAsync(
            x => x.OwnerUserId == asset.OwnerUserId && x.CreatedAt >= since && x.CreatedAt <= asset.CreatedAt,
            cancellationToken);
        if (rank > options.MaxUploadsPerUserPerDay)
        {
            return MediaErrors.QuotaExceeded("daily upload limit", options.MaxUploadsPerUserPerDay);
        }

        long bytesUpToMe = await db.MediaAssets
            .Where(x => x.OwnerUserId == asset.OwnerUserId && x.DeletedAt == null && x.State != MediaAssetState.Failed
                && x.CreatedAt <= asset.CreatedAt)
            .SumAsync(x => (long)x.Bytes, cancellationToken);
        return bytesUpToMe > options.MaxRetainedBytesPerUser
            ? MediaErrors.QuotaExceeded("stored picture limit", options.MaxRetainedBytesPerUser / (1024 * 1024), "MiB")
            : null;
    }

    /// <summary>Normalized bytes the account currently retains (withdrawn and failed assets do not count).</summary>
    public static Task<long> RetainedBytesAsync(ApplicationDbContext db, string userId, CancellationToken cancellationToken) =>
        db.MediaAssets
            .Where(x => x.OwnerUserId == userId && x.DeletedAt == null && x.State != MediaAssetState.Failed)
            .SumAsync(x => (long)x.Bytes, cancellationToken);
}
