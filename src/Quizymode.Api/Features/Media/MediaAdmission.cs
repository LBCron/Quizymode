using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Features.Media;

internal static class MediaAdmission
{
    internal static string Hash(string input) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(input)));
    internal static async Task<(MediaUploadClaim? Claim, IResult? Error)> ReserveAsync(ApplicationDbContext db, string owner, string key, byte[] source, MediaOptions options, DateTime now, CancellationToken ct)
    {
        if (key.Length > 128 || key.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-'))
            return (null, Results.Problem(statusCode: 400, title: "Media.InvalidIdempotencyKey", detail: "Use a request key of at most 128 letters, numbers and hyphens."));
        string id = Hash(owner + ":" + key); string digest = Convert.ToHexStringLower(SHA256.HashData(source));
        await using IDbContextTransaction? transaction = await ItemImageSubmission.BeginAsync(db, ct);
        MediaControl? control = await db.MediaControls.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1, ct);
        if (control?.UploadsEnabled == false) return (null, MediaErrors.StorageUnavailable.ToResult());
        MediaUploadClaim? prior = await db.MediaUploadClaims.SingleOrDefaultAsync(x => x.Id == id, ct);
        bool isNew = prior is null;
        if (prior is not null)
        {
            if (prior.SourceSha256 != digest) return (null, Results.Problem(statusCode: 409, title: "Media.RequestKeyReused", detail: "This request key belongs to a different picture."));
            if (await db.MediaAssets.AnyAsync(x => x.Id == prior.AssetId && (x.DeletedAt != null || x.PurgedAt != null), ct)) return (null, MediaErrors.Withdrawn.ToResult());
            MediaAsset? ready = await db.MediaAssets.AsNoTracking().SingleOrDefaultAsync(x => x.Id == prior.AssetId && x.State == MediaAssetState.Ready && x.DeletedAt == null, ct);
            if (ready is not null) return (null, Results.Created($"/media/images/{ready.Id}/content", new UploadImage.Response(ready.Id, "Ready", ready.Width, ready.Height, ready.Bytes, ready.Format, ready.Sha256, ready.ProcessingVersion, ready.CreatedAt)));
            if (prior.State == "Processing" && prior.LeaseUntil > now) return (null, Results.Problem(statusCode: 409, title: "Media.UploadInProgress", detail: "This upload is still processing. Retry shortly with the same request key."));
            if (prior.Attempts >= 3) return (null, Results.Problem(statusCode: 409, title: "Media.RetryLimit", detail: "Choose the picture again to start a new upload."));
        }
        else
        {
            prior = new MediaUploadClaim { Id = id, OwnerUserId = owner, SourceSha256 = digest, AssetId = Guid.NewGuid(), CreatedAt = now };
        }
        // Every decode admission, including an expired/failed claim retry, rechecks current owner capacity.
        // Completed replays above need no new reservation and therefore remain available at the limit.
        int hourly = await db.MediaUploadAttempts.CountAsync(x => x.OwnerUserId == owner && x.CreatedAt > now.AddHours(-1), ct);
        int daily = await db.MediaUploadAttempts.CountAsync(x => x.OwnerUserId == owner && x.CreatedAt > now.AddDays(-1), ct);
        int pending = await db.Items.CountAsync(x => x.CreatedBy == owner && x.ImageReviewState == ItemImageReviewState.PendingReview, ct);
        long retained = await db.MediaAssets.Where(x => x.OwnerUserId == owner && x.PurgedAt == null).SumAsync(x => (long)x.Bytes, ct);
        int reserved = await db.MediaUploadClaims.CountAsync(x => x.Id != id && x.OwnerUserId == owner && x.State == "Processing" && x.LeaseUntil > now, ct);
        if (hourly >= options.MaxUploadsPerHour || daily >= options.MaxUploadsPerDay || pending >= options.MaxPendingReviewItems || retained + (reserved + 1L) * options.MaxOutputBytes > options.MaxRetainedBytes)
            return (null, Results.Problem(statusCode: 429, title: pending >= options.MaxPendingReviewItems ? "Media.PendingReviewQuota" : retained + (reserved + 1L) * options.MaxOutputBytes > options.MaxRetainedBytes ? "Media.StorageQuota" : "Media.UploadQuota", detail: "Picture allowance reached. Resolve pending reviews or remove unused pictures, or retry after the upload window resets."));
        // Global daily ceiling (AC 3.28.2); counted under the same advisory lock that commits this attempt, so concurrent requests cannot overshoot it.
        if (await db.MediaUploadAttempts.CountAsync(x => x.CreatedAt > now.AddDays(-1), ct) >= options.MaxUploadsGlobalPerDay)
            return (null, MediaErrors.GlobalCeiling.ToResult());
        long globalBytes = await db.MediaAssets.Where(x => x.PurgedAt == null).SumAsync(x => (long)x.Bytes, ct);
        int globalReserved = await db.MediaUploadClaims.CountAsync(x => x.Id != id && x.State == "Processing" && x.LeaseUntil > now, ct);
        if (globalReserved >= options.MaxGlobalUploads) return (null, Results.Problem(statusCode: 429, title: "Media.GlobalBusy", detail: "Picture processing is busy. Retry shortly."));
        if (globalBytes + (globalReserved + 1L) * options.MaxOutputBytes > options.MaxGlobalRetainedBytes) return (null, Results.Problem(statusCode: 429, title: "Media.GlobalStorageQuota", detail: "Picture storage allowance reached. Retry after maintenance."));
        if (!isNew)
        {
            prior.Attempts++;
        }
        if (isNew) db.MediaUploadClaims.Add(prior);
        prior.State = "Processing"; prior.LeaseUntil = now.AddMinutes(5);
        db.MediaUploadAttempts.Add(new MediaUploadAttempt { Id = Guid.NewGuid(), OwnerUserId = owner, CreatedAt = now });
        await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct);
        return (prior, null);
    }
    internal static Task FinishAsync(ApplicationDbContext db, string id, string state) => db.MediaUploadClaims.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.State, state), CancellationToken.None);
}
