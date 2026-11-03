using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.SetVisibility;

public static class SetItemVisibility
{
    public sealed record Request(bool IsPrivate);

    public sealed record Response(
        string Id,
        bool IsPrivate);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPut("items/{id}/visibility", Handler)
                .WithTags("Items")
                .WithSummary("Set item visibility (global vs private)")
                .WithDescription("Admin endpoint to promote or demote items between global and private.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status409Conflict);
        }

        private static async Task<IResult> Handler(
            string id,
            Request request,
            ApplicationDbContext db,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(id, request, db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error.Type == ErrorType.NotFound
                    ? Results.NotFound()
                    : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        string id,
        Request request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        try
        {
            if (!Guid.TryParse(id, out Guid itemId))
            {
                return Result.Failure<Response>(
                    Error.Validation("Item.InvalidId", "Invalid item ID format"));
            }

            Item? item = await db.Items
                .FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);

            if (item is null)
            {
                return Result.Failure<Response>(
                    Error.NotFound("Item.NotFound", $"Item with id {id} not found"));
            }

            // Pictures must be approved before a private item is published (AC 3.25.6).
            if (ItemImageReviewRules.BlocksPublish(item.IsPrivate, request.IsPrivate, item.ImageReviewState))
            {
                return Result.Failure<Response>(ItemImageReviewRules.ReviewRequired());
            }

            item.IsPrivate = request.IsPrivate;
            item.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);

            Response response = new(
                item.Id.ToString(),
                item.IsPrivate);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Item.SetVisibilityFailed", "Failed to set item visibility.", ex));
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


