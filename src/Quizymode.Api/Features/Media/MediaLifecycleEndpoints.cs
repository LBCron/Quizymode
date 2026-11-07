using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Features.Media;

public static class MediaLifecycleEndpoints
{
    private static readonly string[] Categories = ["sexual", "violence", "hate", "harassment", "privacy", "rights", "misleading", "other"];
    public sealed record ReportRequest(string Slot, string Category, int ExpectedRevision, Guid? CollectionId = null);
    public sealed record WithdrawRequest(Guid ItemId, int ExpectedRevision, string Category);
    public sealed record ControlRequest(bool UploadsEnabled, bool DeliveryEnabled, bool AdvisoryEnabled);
    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("items/{id:guid}/image-reports", ReportAsync).WithTags("Media").AllowAnonymous();
            app.MapGet("admin/media/reports", async (ApplicationDbContext db, IUserContext user, CancellationToken ct) =>
                !user.IsAdmin ? Results.Forbid() : Results.Ok(await db.MediaReports.AsNoTracking().Where(x => x.ResolvedAt == null).OrderBy(x => x.CreatedAt).Take(100).Select(x => new { x.Id, x.ItemId, x.AssetId, x.Revision, x.Slot, x.Category, x.CreatedAt }).ToListAsync(ct))).WithTags("Admin").RequireAuthorization();
            app.MapPost("admin/media/reports/{id:guid}/dismiss", async (Guid id, ApplicationDbContext db, IUserContext user, CancellationToken ct) =>
            {
                if (!user.IsAdmin) return Results.Forbid();
                int changed = await db.MediaReports.Where(x => x.Id == id && x.ResolvedAt == null).ExecuteUpdateAsync(set => set.SetProperty(x => x.ResolvedAt, DateTime.UtcNow), ct);
                return changed == 0 ? Results.NotFound() : Results.Ok();
            }).WithTags("Admin").RequireAuthorization();
            app.MapPost("admin/media/{assetId:guid}/withdraw", WithdrawAsync).WithTags("Admin").RequireAuthorization();
            app.MapGet("admin/media/controls", async (ApplicationDbContext db, IUserContext user, CancellationToken ct) =>
                !user.IsAdmin ? Results.Forbid() : Results.Ok(ToControls(await db.MediaControls.AsNoTracking().SingleOrDefaultAsync(x => x.Id == 1, ct) ?? new MediaControl()))).WithTags("Admin").RequireAuthorization();
            app.MapPut("admin/media/controls", ControlsAsync).WithTags("Admin").RequireAuthorization();
        }
    }
    private static ControlRequest ToControls(MediaControl value) => new(value.UploadsEnabled, value.DeliveryEnabled, value.AdvisoryEnabled);
    private static async Task<IResult> ReportAsync(Guid id, ReportRequest request, HttpContext context, ApplicationDbContext db, IUserContext user, CancellationToken ct)
    {
        if (!Categories.Contains(request.Category) || request.Slot is not ("question" or "explanation")) return Results.BadRequest();
        Item? item = await db.Items.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
        bool creator = item is not null && user.IsAuthenticated && item.CreatedBy == user.UserId;
        bool allowed = item is not null && ItemVisibility.CanAccessById(item, user);
        if (request.CollectionId is Guid collectionId)
        {
            Collection? collection = await db.Collections.AsNoTracking().SingleOrDefaultAsync(x => x.Id == collectionId, ct);
            allowed = collection is not null && GetCollectionById.CanAccess(collection, user) && await db.CollectionItems.AnyAsync(x => x.CollectionId == collectionId && x.ItemId == id, ct) && (creator || item?.ImageReviewState == ItemImageReviewState.Approved);
        }
        Guid? assetId = request.Slot == "question" ? item?.QuestionImageAssetId : item?.ExplanationImageAssetId;
        if (!allowed || item is null || assetId is null || item.ImageRevision != request.ExpectedRevision || (!creator && !user.IsAdmin && item.ImageReviewState != ItemImageReviewState.Approved)) return Results.NotFound();
        DateTime now = DateTime.UtcNow;
        await using var transaction = await ItemImageSubmission.BeginAsync(db, ct);
        if (!await db.Items.AnyAsync(x => x.Id == id && x.ImageRevision == request.ExpectedRevision && (creator || user.IsAdmin || x.ImageReviewState == ItemImageReviewState.Approved), ct)) return Results.NotFound();
        MediaControl? reportControl = await db.MediaControls.SingleOrDefaultAsync(x => x.Id == 1, ct);
        if (reportControl is null) { reportControl = new MediaControl(); db.MediaControls.Add(reportControl); }
        string abuse = Convert.ToHexStringLower(System.Security.Cryptography.HMACSHA256.HashData(Convert.FromHexString(reportControl.ReportSalt), System.Text.Encoding.UTF8.GetBytes(now.ToString("yyyy-MM-dd") + ":" + (user.UserId ?? context.Connection.RemoteIpAddress?.ToString() ?? "anonymous"))));
        if (await db.MediaReports.AnyAsync(x => x.AbuseKey == abuse && x.ItemId == id && x.Revision == request.ExpectedRevision && x.Slot == request.Slot, ct)) return Results.Accepted();
        if (await db.MediaReports.CountAsync(x => x.AbuseKey == abuse && x.CreatedAt > now.AddDays(-1), ct) >= 10) return Results.StatusCode(429);
        db.MediaReports.Add(new MediaReport { Id = Guid.NewGuid(), ItemId = id, AssetId = assetId.Value, Revision = request.ExpectedRevision, Slot = request.Slot, Category = request.Category, AbuseKey = abuse, CreatedAt = now });
        await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct);
        MediaMetrics.Reports.Add(1, new KeyValuePair<string, object?>("category", request.Category));
        return Results.Accepted();
    }
    private static async Task<IResult> WithdrawAsync(Guid assetId, WithdrawRequest request, ApplicationDbContext db, IUserContext user, CancellationToken ct)
    {
        if (!user.IsAdmin) return Results.Forbid();
        if (!Categories.Contains(request.Category)) return Results.BadRequest();
        await using var transaction = await ItemImageSubmission.BeginAsync(db, ct);
        Item? item = await db.Items.AsNoTracking().SingleOrDefaultAsync(x => x.Id == request.ItemId, ct);
        if (item is null || (item.QuestionImageAssetId != assetId && item.ExplanationImageAssetId != assetId)) return Results.NotFound();
        MediaAsset? asset = await db.MediaAssets.SingleOrDefaultAsync(x => x.Id == assetId, ct);
        if (asset is null) return Results.NotFound();
        if (asset.DeletedAt is not null) return Results.Ok(new { state = "Withdrawn" });
        if (item.ImageRevision != request.ExpectedRevision) return Results.Problem(statusCode: 409, title: "Item.ImageReviewStale", detail: "Pictures changed. Reload before withdrawing.");
        DateTime now = DateTime.UtcNow;
        int affectedItems = await MediaRevocation.ApplyAsync(db, asset, user.UserId!, request.Category, now, ct);
        await db.MediaReports.Where(x => x.AssetId == assetId && x.ResolvedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.ResolvedAt, now), ct);
        await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct);
        MediaMetrics.Withdrawals.Add(1); return Results.Ok(new { state = "Withdrawn", affectedItems });
    }
    private static async Task<IResult> ControlsAsync(ControlRequest request, ApplicationDbContext db, IUserContext user, CancellationToken ct)
    {
        if (!user.IsAdmin) return Results.Forbid();
        await using var transaction = await ItemImageSubmission.BeginAsync(db, ct);
        MediaControl? control = await db.MediaControls.SingleOrDefaultAsync(x => x.Id == 1, ct);
        if (control is null) { control = new MediaControl(); db.MediaControls.Add(control); }
        control.UploadsEnabled = request.UploadsEnabled; control.DeliveryEnabled = request.DeliveryEnabled; control.AdvisoryEnabled = request.AdvisoryEnabled; control.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct);
        return Results.Ok(ToControls(control));
    }
}
