using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Collections;

public static class GetCollections
{
    public sealed record Response(List<CollectionResponse> Collections);

    public sealed record CollectionResponse(string Id, string Name, string? Description, DateTime CreatedAt, int ItemCount, bool IsPublic, bool IsDiscoverable);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("collections", Handler)
                .WithTags("Collections")
                .WithSummary("Get collections for current user")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK);
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
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            string userId = userContext.UserId!;

            List<Collection> rawCollections = await db.Collections
                .AsNoTracking()
                .Where(c => c.CreatedBy == userId)
                .OrderByDescending(c => c.CreatedAt)
                .ToListAsync(cancellationToken);

            // Ensure user has at least one collection (Default) on first use (e.g. legacy users; new users get it at signup in UserUpsertMiddleware)
            if (rawCollections.Count == 0)
            {
                string? displayName = null;
                if (Guid.TryParse(userId, out Guid parsedUserId))
                {
                    var user = await db.Users
                        .Where(u => u.Id == parsedUserId)
                        .Select(u => new { u.Name, u.Subject })
                        .FirstOrDefaultAsync(cancellationToken);

                    if (user is not null && !string.Equals(user.Name, user.Subject, StringComparison.Ordinal))
                    {
                        displayName = user.Name;
                    }
                }

                Collection defaultCollection = DefaultCollectionFactory.Create(userId, displayName);
                db.Collections.Add(defaultCollection);
                await db.SaveChangesAsync(cancellationToken);
                return Result.Success(new Response(new List<CollectionResponse>
                {
                    new(defaultCollection.Id.ToString(), defaultCollection.Name, defaultCollection.Description, defaultCollection.CreatedAt, 0, false, false)
                }));
            }

            // Batch-load item counts with a single GROUP BY instead of a correlated subquery per collection
            List<Guid> collectionIds = rawCollections.Select(c => c.Id).ToList();
            // Items with unapproved uploaded pictures count only for their creator (#400).
            Dictionary<Guid, int> itemCounts = await ItemVisibility.EligibleCollectionItems(db, userId)
                .Where(ci => collectionIds.Contains(ci.CollectionId))
                .GroupBy(ci => ci.CollectionId)
                .Select(g => new { CollectionId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.CollectionId, x => x.Count, cancellationToken);

            List<CollectionResponse> collections = rawCollections
                .Select(c => new CollectionResponse(
                    c.Id.ToString(),
                    c.Name,
                    c.Description,
                    c.CreatedAt,
                    itemCounts.GetValueOrDefault(c.Id),
                    c.IsPublic,
                    c.IsDiscoverable))
                .ToList();

            return Result.Success(new Response(collections));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Collections.GetFailed", "Failed to retrieve collections.", ex));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services
        }
    }
}
