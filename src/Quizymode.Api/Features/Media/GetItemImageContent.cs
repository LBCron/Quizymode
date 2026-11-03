using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Media;

/// <summary>
/// Item-bound picture delivery (AC 3.25.5): the only way anyone other than the uploader or an admin can read an uploaded
/// picture. The caller is authorized against the item (or the collection holding it) and the picture's review state, never
/// against the asset id. Anonymous callers are allowed; every refusal, and every curated, empty or unknown slot, is the same
/// empty 404.
/// </summary>
public static class GetItemImageContent
{
    private const string LoggerCategory = "Quizymode.Api.Features.Media.GetItemImageContent";

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("items/{id:guid}/images/{slot}", ItemHandler)
                .WithTags("Media")
                .WithSummary("Download an item's uploaded question or explanation picture")
                .WithDescription("slot is 'question' or 'explanation'. The creator and admins can read any state; everyone else, including anonymous callers, " +
                    "only an Approved picture of an item they can see. Everything else, including curated pictures, is 404. Responses are private and no-store.")
                .AllowAnonymous()
                .Produces<byte[]>(StatusCodes.Status200OK, MediaObjectKey.ContentType)
                .Produces(StatusCodes.Status404NotFound)
                .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

            app.MapGet("collections/{collectionId:guid}/items/{itemId:guid}/images/{slot}", CollectionHandler)
                .WithTags("Media")
                .WithSummary("Download an uploaded picture of an item through a collection that holds it")
                .WithDescription("Allowed when the caller can open the collection (public, share link, or owner), the item is in it, and the picture is Approved " +
                    "(or the caller created the item). Everything else is 404. Responses are private and no-store.")
                .AllowAnonymous()
                .Produces<byte[]>(StatusCodes.Status200OK, MediaObjectKey.ContentType)
                .Produces(StatusCodes.Status404NotFound)
                .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        }

        private static async Task<IResult> ItemHandler(
            Guid id,
            string slot,
            ApplicationDbContext db,
            IUserContext userContext,
            IMediaObjectStore store,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            Item? item = await LoadItemAsync(db, id, cancellationToken);
            if (item is null || !CanReadFromItem(item, userContext))
            {
                return Results.NotFound();
            }

            return await DeliverAsync(db, item, slot, store, loggerFactory, cancellationToken);
        }

        private static async Task<IResult> CollectionHandler(
            Guid collectionId,
            Guid itemId,
            string slot,
            ApplicationDbContext db,
            IUserContext userContext,
            IMediaObjectStore store,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            Collection? collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, cancellationToken);
            if (collection is null || !GetCollectionById.CanAccess(collection, userContext))
            {
                return Results.NotFound();
            }

            bool inCollection = await db.CollectionItems.AnyAsync(
                ci => ci.CollectionId == collectionId && ci.ItemId == itemId, cancellationToken);
            Item? item = inCollection ? await LoadItemAsync(db, itemId, cancellationToken) : null;
            if (item is null || !(IsCreator(item, userContext) || item.ImageReviewState == ItemImageReviewState.Approved))
            {
                return Results.NotFound();
            }

            return await DeliverAsync(db, item, slot, store, loggerFactory, cancellationToken);
        }

        private static Task<Item?> LoadItemAsync(ApplicationDbContext db, Guid id, CancellationToken cancellationToken) =>
            db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);

        private static bool IsCreator(Item item, IUserContext userContext) =>
            userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId) && item.CreatedBy == userContext.UserId;

        /// <summary>The creator and admins read any state; everyone else needs an item they can see and an Approved picture.</summary>
        private static bool CanReadFromItem(Item item, IUserContext userContext) =>
            userContext.IsAdmin
            || IsCreator(item, userContext)
            || (ItemVisibility.CanAccessById(item, userContext) && item.ImageReviewState == ItemImageReviewState.Approved);

        private static async Task<IResult> DeliverAsync(
            ApplicationDbContext db,
            Item item,
            string slot,
            IMediaObjectStore store,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            Guid? assetId = slot switch
            {
                "question" => item.QuestionImageAssetId,
                "explanation" => item.ExplanationImageAssetId,
                _ => null
            };
            if (assetId is null)
            {
                return Results.NotFound();
            }

            MediaAsset? asset = await db.MediaAssets
                .AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == assetId.Value && a.State == MediaAssetState.Ready && a.DeletedAt == null, cancellationToken);
            if (asset?.ObjectKey is null)
            {
                return Results.NotFound();
            }

            if (!store.IsAvailable)
            {
                return MediaErrors.StorageUnavailable.ToResult();
            }

            ILogger logger = loggerFactory.CreateLogger(LoggerCategory);
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

            return new GetImageContent.MediaContentResult(content);
        }
    }
}
