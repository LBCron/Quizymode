using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Users;

public static class GetCurrentUser
{
    public sealed record Response(
        string Id,
        string? Name,
        string? Email,
        bool IsAdmin,
        DateTime CreatedAt,
        DateTime LastLogin);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("users/me", Handler)
                .WithTags("Users")
                .WithSummary("Get the currently authenticated user")
                .WithDescription("Returns the current user's profile information including name, email, role, and timestamps")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            Result<Response> result = await HandleAsync(db, userContext, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error.Type switch
                {
                    ErrorType.NotFound => CustomResults.NotFound(failure.Error.Description, failure.Error.Code),
                    _ => CustomResults.Problem(result)
                });
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrEmpty(userContext.UserId))
            {
                return Result.Failure<Response>(
                    Error.Validation("User.UserIdMissing", "User ID is missing"));
            }

            if (!Guid.TryParse(userContext.UserId, out Guid userId))
            {
                return Result.Failure<Response>(
                    Error.Validation("User.InvalidUserId", "Invalid user ID format"));
            }

            // Id is the primary key, so at most one row (#490: a deterministic single-row lookup).
            User? user = await db.Users
                .SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

            if (user is null)
            {
                return Result.Failure<Response>(
                    Error.NotFound("User.NotFound", "User not found. Please ensure you are authenticated."));
            }

            Response response = new(
                user.Id.ToString(),
                user.Name,
                user.Email,
                userContext.IsAdmin,
                user.CreatedAt,
                user.LastLogin);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Users.GetCurrentUserFailed", "Failed to get current user.", ex));
        }
    }
}

