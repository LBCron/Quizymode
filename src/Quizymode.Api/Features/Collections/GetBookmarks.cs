using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Collections;

public static class GetBookmarks
{
    public sealed record Response(List<BookmarkItem> Collections);

    public sealed record BookmarkItem(
        string Id,
        string Name,
        string CreatedBy,
        DateTime CreatedAt,
        int ItemCount);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("collections/bookmarks", Handler)
                .WithTags("Collections")
                .WithSummary("Get collections bookmarked by current user")
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
            var userId = userContext.UserId!;

            // Only collections the caller can still access (public, or owned by the caller); mirrors GetCollectionById.CanAccess.
            var bookmarks = await db.CollectionBookmarks
                .Where(b => b.UserId == userId)
                .Where(b => db.Collections.Any(c => c.Id == b.CollectionId && (c.IsPublic || c.CreatedBy == userId)))
                .OrderByDescending(b => b.CreatedAt)
                .Select(b => b.CollectionId)
                .ToListAsync(cancellationToken);

            if (bookmarks.Count == 0)
            {
                return Result.Success(new Response(new List<BookmarkItem>()));
            }

            var collections = await db.Collections
                .Where(c => bookmarks.Contains(c.Id) && (c.IsPublic || c.CreatedBy == userId))
                .ToListAsync(cancellationToken);

            var itemCounts = await ItemVisibility.EligibleCollectionItems(db, userId)
                .Where(ci => bookmarks.Contains(ci.CollectionId))
                .GroupBy(ci => ci.CollectionId)
                .Select(g => new { CollectionId = g.Key, Count = g.Count() })
                .ToListAsync(cancellationToken);

            var countMap = itemCounts.ToDictionary(x => x.CollectionId, x => x.Count);

            var orderMap = bookmarks
                .Select((id, index) => new { Id = id, Index = index })
                .ToDictionary(x => x.Id, x => x.Index);

            var items = collections
                .OrderBy(c => orderMap.GetValueOrDefault(c.Id, int.MaxValue))
                .Select(c => new BookmarkItem(
                    c.Id.ToString(),
                    c.Name,
                    c.CreatedBy,
                    c.CreatedAt,
                    countMap.GetValueOrDefault(c.Id, 0)))
                .ToList();

            return Result.Success(new Response(items));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Collections.GetBookmarksFailed", "Failed to get bookmarks.", ex));
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
