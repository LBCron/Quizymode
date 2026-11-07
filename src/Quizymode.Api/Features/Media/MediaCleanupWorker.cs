using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Features.Media;

/// <summary>Ships dark. Production requires an explicit owner scope or separately approved general cleanup setting.</summary>
internal sealed class MediaCleanupWorker(IServiceScopeFactory scopes, IOptions<MediaOptions> options, IMediaObjectStore store, IHostEnvironment environment, ILogger<MediaCleanupWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using PeriodicTimer timer = new(TimeSpan.FromMinutes(15));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (options.Value.CleanupEnabled && store.IsAvailable && (environment.IsDevelopment() || environment.IsEnvironment("Testing") || options.Value.CleanupAllOwnersApproved || !string.IsNullOrWhiteSpace(options.Value.CleanupOwnerUserId)))
                { using IServiceScope scope = scopes.CreateScope(); await RunOnceAsync(scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(), store, options.Value, DateTime.UtcNow, stoppingToken); }
            }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested) { logger.LogError(ex, "Media cleanup failed; retained tombstones will retry."); MediaMetrics.Cleanup.Add(1, new KeyValuePair<string, object?>("outcome", "failure")); }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }

    internal static async Task<int> RunOnceAsync(ApplicationDbContext db, IMediaObjectStore store, MediaOptions options, DateTime now, CancellationToken ct)
    {
        string? owner = options.CleanupOwnerUserId;
        DateTime abandoned = now.AddDays(-options.UnattachedRetentionDays);
        DateTime withdrawn = now.AddDays(-options.WithdrawnRetentionDays);
        DateTime rejected = now.AddDays(-options.RejectedRetentionDays);
        List<Guid> candidates = await db.MediaAssets.AsNoTracking()
            .Where(a => (owner == null || a.OwnerUserId == owner) && a.PurgedAt == null
                && !db.MediaUploadClaims.Any(c => c.AssetId == a.Id && c.State == "Processing" && c.LeaseUntil > now)
                && (a.DeleteRetryAt == null || a.DeleteRetryAt <= now) && a.CreatedAt < abandoned
                && (a.DeletedAt != null
                    ? a.DeleteAttempts > 0 || a.DeletedAt <= withdrawn
                    : !db.Items.Any(i => (i.QuestionImageAssetId == a.Id || i.ExplanationImageAssetId == a.Id) && i.ImageReviewState != ItemImageReviewState.Rejected && i.ImageReviewState != ItemImageReviewState.Withdrawn)
                        && !db.ItemImageReviews.Any(r => r.Decision == null && (r.QuestionAssetId == a.Id || r.ExplanationAssetId == a.Id) && db.Items.Any(i => i.Id == r.ItemId && i.ImageRevision == r.Revision && i.ImageReviewState != ItemImageReviewState.Withdrawn && (i.QuestionImageAssetId == a.Id || i.ExplanationImageAssetId == a.Id)))
                        && !db.Items.Any(i => (i.QuestionImageAssetId == a.Id || i.ExplanationImageAssetId == a.Id) && i.ImageReviewState == ItemImageReviewState.Rejected
                            && !db.ItemImageReviews.Any(r => r.ItemId == i.Id && r.Revision == i.ImageRevision && r.Decision == "Rejected" && r.DecidedAt != null && r.DecidedAt <= rejected && (r.QuestionAssetId == a.Id || r.ExplanationAssetId == a.Id)))))
            // Apply due-proof before the batch bound; protected rows must not starve later eligible assets.
            .OrderBy(a => a.CreatedAt).Take(50).Select(a => a.Id).ToListAsync(ct);
        int deleted = 0;
        foreach (Guid id in candidates)
        {
            MediaAsset? asset;
            await using (var transaction = await ItemImageSubmission.BeginAsync(db, ct))
            {
                asset = await db.MediaAssets.SingleOrDefaultAsync(a => a.Id == id && a.PurgedAt == null, ct);
                if (asset is null || await db.MediaUploadClaims.AnyAsync(c => c.AssetId == id && c.State == "Processing" && c.LeaseUntil > now, ct)) continue;
                List<Item> references = await db.Items.Where(i => i.QuestionImageAssetId == id || i.ExplanationImageAssetId == id).ToListAsync(ct);
                bool currentUndecided = await db.ItemImageReviews.AnyAsync(r => r.Decision == null && (r.QuestionAssetId == id || r.ExplanationAssetId == id) && db.Items.Any(i => i.Id == r.ItemId && i.ImageRevision == r.Revision && i.ImageReviewState != ItemImageReviewState.Withdrawn && (i.QuestionImageAssetId == id || i.ExplanationImageAssetId == id)), ct);
                bool liveReferences = references.Any(i => i.ImageReviewState != ItemImageReviewState.Rejected && i.ImageReviewState != ItemImageReviewState.Withdrawn);
                bool rejectedDue = true;
                foreach (Item reference in references.Where(i => i.ImageReviewState == ItemImageReviewState.Rejected))
                {
                    // Only this current rejected submission determines its clock; withdrawal audits of siblings do not.
                    if (!await db.ItemImageReviews.AnyAsync(r => r.ItemId == reference.Id && r.Revision == reference.ImageRevision && r.Decision == "Rejected" && r.DecidedAt != null && r.DecidedAt <= rejected && (r.QuestionAssetId == id || r.ExplanationAssetId == id), ct)) rejectedDue = false;
                }
                bool eligible = !currentUndecided && !liveReferences && rejectedDue;
                if (asset.DeletedAt is not null ? asset.DeleteAttempts == 0 && asset.DeletedAt > withdrawn : !eligible) continue;
                if (references.Any(i => i.ImageReviewState == ItemImageReviewState.Rejected)) await MediaRevocation.ApplyAsync(db, asset, "media-retention", "Expired rejected picture", now, ct);
                asset.DeletedAt ??= now; asset.DeleteAttempts++;
                // Commit the revocation BEFORE any destructive storage operation. Attach/approval share this lock.
                await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct);
            }
            try
            {
                string key = asset.ObjectKey ?? MediaObjectKey.Build(asset.Id, asset.Sha256);
                MediaObjectKey.EnsureValid(key); await store.DeleteAsync(key, ct);
                asset.PurgedAt = now; asset.DeleteRetryAt = null; deleted++;
                MediaMetrics.Cleanup.Add(1, new KeyValuePair<string, object?>("outcome", "deleted"));
            }
            catch (MediaStorageException) { asset.DeleteRetryAt = now.AddMinutes(Math.Min(1440, 15 * Math.Pow(2, Math.Min(asset.DeleteAttempts, 6)))); MediaMetrics.Cleanup.Add(1, new KeyValuePair<string, object?>("outcome", "retry")); }
            await db.SaveChangesAsync(ct);
        }
        // Persist pagination across restarts. Unknown-owner orphans are never deleted in owner-scoped mode.
        MediaControl control;
        await using (var controlTransaction = await ItemImageSubmission.BeginAsync(db, ct))
        {
            control = await db.MediaControls.SingleOrDefaultAsync(x => x.Id == 1, ct) ?? new MediaControl();
            if (db.Entry(control).State == EntityState.Detached) db.MediaControls.Add(control);
            await db.SaveChangesAsync(ct); if (controlTransaction is not null) await controlTransaction.CommitAsync(ct);
        }
        MediaObjectPage page = await store.ListAsync(control.CleanupCursor, ct);
        if (owner is null)
            foreach (MediaObjectEntry entry in page.Objects.Where(x => x.LastModified < abandoned))
            {
                MediaObjectKey.EnsureValid(entry.Key);
                Guid objectId = Guid.ParseExact(entry.Key.Split('/')[2], "N");
                if (!await db.MediaAssets.AnyAsync(a => a.Id == objectId, ct))
                { await store.DeleteAsync(entry.Key, ct); MediaMetrics.Cleanup.Add(1, new KeyValuePair<string, object?>("outcome", "orphan")); }
            }
        control.CleanupCursor = page.ContinuationToken;
        // Rotate verification by UpdatedAt so a bounded run eventually checks every live asset.
        List<Guid> verifyIds = await db.MediaAssets.AsNoTracking().Where(a => (owner == null || a.OwnerUserId == owner) && a.State == MediaAssetState.Ready && a.DeletedAt == null).OrderBy(a => a.UpdatedAt).Take(20).Select(a => a.Id).ToListAsync(ct);
        foreach (Guid verifyId in verifyIds)
        {
            await using var verification = await ItemImageSubmission.BeginAsync(db, ct);
            MediaAsset? live = await db.MediaAssets.SingleOrDefaultAsync(a => a.Id == verifyId && a.DeletedAt == null, ct);
            if (live?.ObjectKey is null) continue;
            using MediaObjectContent? content = await store.OpenReadAsync(live.ObjectKey, ct);
            if (content is null)
            {
                await MediaRevocation.ApplyAsync(db, live, "media-reconciliation", "Normalized object unavailable", now, ct);
                MediaMetrics.Cleanup.Add(1, new KeyValuePair<string, object?>("outcome", "missing"));
            }
            else live.UpdatedAt = now;
            await db.SaveChangesAsync(ct); if (verification is not null) await verification.CommitAsync(ct);
        }
        await db.MediaUploadClaims.Where(x => (owner == null || x.OwnerUserId == owner) && x.CreatedAt < now.AddDays(-30) && (x.State != "Processing" || x.LeaseUntil < now)).ExecuteDeleteAsync(ct);
        await db.MediaUploadAttempts.Where(x => (owner == null || x.OwnerUserId == owner) && x.CreatedAt < now.AddDays(-30)).ExecuteDeleteAsync(ct);
        await db.MediaIngressAttempts.Where(x => (owner == null || x.OwnerUserId == owner) && x.CreatedAt < now.AddDays(-30) && (x.CompletedAt != null || x.LeaseUntil < now)).ExecuteDeleteAsync(ct);
        if (owner is null) await db.MediaReports.Where(x => x.CreatedAt < now.AddDays(-30)).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);
        return deleted;
    }
}
