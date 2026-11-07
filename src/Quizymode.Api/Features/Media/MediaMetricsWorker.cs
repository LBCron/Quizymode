using System.Diagnostics.Metrics;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Features.Media;
internal sealed class MediaMetricsWorker(IServiceScopeFactory scopes, ILogger<MediaMetricsWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Avoid database work during short-lived OpenAPI generation startup.
        await Task.Delay(TimeSpan.FromSeconds(30), ct);
        using PeriodicTimer timer = new(TimeSpan.FromMinutes(1));
        do
        {
            try
            {
                using IServiceScope scope = scopes.CreateScope(); ApplicationDbContext db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>(); DateTime now = DateTime.UtcNow;
                int pending = await db.Items.CountAsync(x => x.ImageReviewState == ItemImageReviewState.PendingReview, ct);
                DateTime? oldest = await db.ItemImageReviews.Where(x => x.Decision == null && db.Items.Any(i => i.Id == x.ItemId && i.ImageRevision == x.Revision && i.ImageReviewState == ItemImageReviewState.PendingReview)).Select(x => (DateTime?)x.SubmittedAt).MinAsync(ct);
                long retained = await db.MediaAssets.Where(x => x.PurgedAt == null).SumAsync(x => (long)x.Bytes, ct);
                int retries = await db.MediaAssets.CountAsync(x => x.PurgedAt == null && x.DeleteRetryAt != null, ct);
                MediaMetrics.Snapshot(pending, oldest is null ? 0 : (now - oldest.Value).TotalSeconds, retained, retries);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested) { logger.LogWarning("Media metrics snapshot unavailable: {FailureType}", ex.GetType().Name); }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}
