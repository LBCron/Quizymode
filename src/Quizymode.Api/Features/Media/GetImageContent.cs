using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Media;

/// <summary>
/// GET /media/images/{id}/content: streams the normalized WebP through the API (the bucket is private). Only the owner or an
/// admin may read a Ready asset; every other case, including unknown ids, is the same empty 404 (AC 3.24).
/// </summary>
public static class GetImageContent
{
    private const string LoggerCategory = "Quizymode.Api.Features.Media.GetImageContent";

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("media/images/{id:guid}/content", Handler)
                .WithTags("Media")
                .WithSummary("Download the normalized WebP of a picture")
                .WithDescription("Owner or admin only. Fetch with the bearer token and display from a blob URL. Other users, unknown ids, and " +
                    "assets that are not Ready get 404.")
                .RequireAuthorization()
                .Produces<byte[]>(StatusCodes.Status200OK, MediaObjectKey.ContentType)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound)
                .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        }

        private static async Task<IResult> Handler(
            Guid id,
            ApplicationDbContext db,
            IUserContext userContext,
            IMediaObjectStore store,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            if (!store.IsAvailable)
            {
                return MediaErrors.StorageUnavailable.ToResult();
            }

            ILogger logger = loggerFactory.CreateLogger(LoggerCategory);
            MediaAsset? asset = await db.MediaAssets
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == id && x.State == MediaAssetState.Ready && x.DeletedAt == null, cancellationToken);
            if (asset is null
                || asset.ObjectKey is null
                || (asset.OwnerUserId != userContext.UserId && !userContext.IsAdmin))
            {
                return Results.NotFound();
            }

            MediaObjectContent? content;
            try
            {
                content = await store.OpenReadAsync(asset.ObjectKey, cancellationToken);
            }
            catch (MediaStorageException ex)
            {
                logger.LogError(ex, "Media storage read failed: AssetId={AssetId}", asset.Id);
                return MediaErrors.StorageFailed.ToResult();
            }

            if (content is null)
            {
                logger.LogWarning("Ready media asset has no readable object: AssetId={AssetId}", asset.Id);
                return Results.NotFound();
            }

            return new MediaContentResult(content);
        }
    }

    /// <summary>Writes the private-image response headers, streams the object, and always disposes it.</summary>
    internal sealed class MediaContentResult(MediaObjectContent content) : IResult
    {
        public async Task ExecuteAsync(HttpContext httpContext)
        {
            using (content)
            {
                HttpResponse response = httpContext.Response;
                response.StatusCode = StatusCodes.Status200OK;
                response.ContentType = MediaObjectKey.ContentType;
                response.Headers.CacheControl = "private, no-store, no-transform";
                response.Headers.XContentTypeOptions = "nosniff";
                response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
                response.Headers["Cross-Origin-Resource-Policy"] = "same-site";
                if (content.Length > 0)
                {
                    response.ContentLength = content.Length;
                }

                await content.Stream.CopyToAsync(response.Body, httpContext.RequestAborted);
            }
        }
    }
}
