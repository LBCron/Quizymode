using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Collections;

public static class GetCollectionById
{
    public sealed record Response(
        string Id,
        string Name,
        string? Description,
        string CreatedBy,
        DateTime CreatedAt,
        int ItemCount,
        bool IsPublic,
        bool IsDiscoverable);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("collections/{id:guid}", Handler)
                .WithTags("Collections")
                .WithSummary("Get a collection by ID")
                .WithDescription("View collection by ID. Allowed if collection is public or you are the owner. Otherwise 404.")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            Guid id,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(id, db, userContext, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error.Type == ErrorType.NotFound
                    ? Results.NotFound()
                    : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        Guid id,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            Collection? collection = await db.Collections
                .FirstOrDefaultAsync(c => c.Id == id, cancellationToken);

            if (collection is null)
            {
                return Result.Failure<Response>(
                    Error.NotFound("Collection.NotFound", "Collection not found"));
            }

            if (!await CanAccessCollectionAsync(db, collection, userContext, cancellationToken))
            {
                return Result.Failure<Response>(
                    Error.NotFound("Collection.NotFound", "Collection not found"));
            }

            // Items with unapproved uploaded pictures count only for their creator (#400).
            int itemCount = await ItemVisibility.EligibleCollectionItems(db, userContext.IsAuthenticated ? userContext.UserId : null)
                .CountAsync(ci => ci.CollectionId == id, cancellationToken);

            Response response = new(
                collection.Id.ToString(),
                collection.Name,
                collection.Description,
                collection.CreatedBy,
                collection.CreatedAt,
                itemCount,
                collection.IsPublic,
                collection.IsDiscoverable);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Collection.GetFailed", "Failed to get collection.", ex));
        }
    }

    /// <summary>
    /// User can access if collection is public or they are the owner.
    /// </summary>
    internal static Task<bool> CanAccessCollectionAsync(
        ApplicationDbContext db,
        Collection collection,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(CanAccess(collection, userContext));
    }

    internal static bool CanAccess(Collection collection, IUserContext userContext)
    {
        if (collection.IsPublic)
            return true;

        if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            return false;

        return collection.CreatedBy == userContext.UserId;
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services
        }
    }
}

