using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Collections;

public static class DeleteCollection
{
    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapDelete("collections/{id}", Handler)
                .WithTags("Collections")
                .WithSummary("Delete a collection")
                .RequireAuthorization()
                .Produces(StatusCodes.Status204NoContent)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            string id,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            Result result = await HandleAsync(id, db, userContext, cancellationToken);

            return result.Match(
                () => Results.NoContent(),
                failure => failure.Error.Code == CollectionWriteAccess.ForbiddenCode
                    ? CollectionWriteAccess.ForbiddenResult(failure.Error)
                    : failure.Error.Type == ErrorType.NotFound
                        ? Results.NotFound()
                        : CustomResults.Problem(result));
        }
    }

    public static async Task<Result> HandleAsync(
        string id,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            if (!Guid.TryParse(id, out Guid collectionId))
            {
                return Result.Failure(
                    Error.Validation("Collection.InvalidId", "Invalid collection ID format"));
            }

            Collection? collection = await db.Collections
                .FirstOrDefaultAsync(c => c.Id == collectionId, cancellationToken);

            if (collection is null)
            {
                return Result.Failure(
                    Error.NotFound("Collection.NotFound", $"Collection with id {id} not found"));
            }

            Error? accessError = CollectionWriteAccess.Check(
                collection, userContext, collectionId, "You can only delete your own collections.");
            if (accessError is not null)
            {
                return Result.Failure(accessError);
            }

            var bookmarks = await db.CollectionBookmarks
                .Where(b => b.CollectionId == collectionId)
                .ToListAsync(cancellationToken);
            if (bookmarks.Count > 0)
            {
                db.CollectionBookmarks.RemoveRange(bookmarks);
            }

            var shares = await db.CollectionShares
                .Where(s => s.CollectionId == collectionId)
                .ToListAsync(cancellationToken);
            if (shares.Count > 0)
            {
                db.CollectionShares.RemoveRange(shares);
            }

            // Test-date plans (#364) have no FK; every user's plan for this collection goes with it.
            List<StudyPlan> studyPlans = await db.StudyPlans
                .Where(p => p.CollectionId == collectionId)
                .ToListAsync(cancellationToken);
            if (studyPlans.Count > 0)
            {
                db.StudyPlans.RemoveRange(studyPlans);
            }

            // Remove related collection items first
            List<CollectionItem> collectionItems = await db.CollectionItems
                .Where(ci => ci.CollectionId == collectionId)
                .ToListAsync(cancellationToken);

            if (collectionItems.Count > 0)
            {
                db.CollectionItems.RemoveRange(collectionItems);
            }

            db.Collections.Remove(collection);
            await db.SaveChangesAsync(cancellationToken);

            return Result.Success();
        }
        catch (Exception ex)
        {
            return Result.Failure(
                Error.Problem("Collections.DeleteFailed", "Failed to delete collection.", ex));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services needed for this feature.
        }
    }
}


