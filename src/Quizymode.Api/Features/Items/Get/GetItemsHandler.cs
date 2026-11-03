using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Get;

/// <summary>
/// Business logic handler for retrieving items. Orchestrates query building, execution, and response mapping.
/// Uses specialized classes (ItemQueryBuilder, ItemQueryExecutor, ItemCollectionLoader, ItemResponseMapper)
/// to maintain separation of concerns and improve testability.
/// </summary>
internal static class GetItemsHandler
{
    /// <summary>
    /// Main handler method that coordinates the entire item retrieval process:
    /// 1. Builds the filtered EF Core query using ItemQueryBuilder
    /// 2. Executes the query and gets paginated results using ItemQueryExecutor
    /// 3. Loads collection information for the returned items using ItemCollectionLoader
    /// 4. Maps domain entities to response DTOs using ItemResponseMapper
    /// 5. Calculates total pages based on total count and page size
    /// </summary>
    public static async Task<Result<GetItems.Response>> HandleAsync(
        GetItems.QueryRequest request,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            ItemQueryBuilder queryBuilder = new(db, userContext, cancellationToken);
            Result<IQueryable<Item>> queryResult = await queryBuilder.BuildQueryAsync(request);

            if (queryResult.IsFailure)
            {
                return Result.Failure<GetItems.Response>(queryResult.Error!);
            }

            IQueryable<Item> query = queryResult.Value;

            ItemQueryExecutor queryExecutor = new(db, cancellationToken);
            (int totalCount, List<Item> items) = await queryExecutor.ExecuteQueryAsync(query, request);

            List<Guid> itemIds = items.Select(i => i.Id).ToList();

            ItemCollectionLoader collectionLoader = new(db, userContext, cancellationToken);
            Dictionary<Guid, List<GetItems.CollectionResponse>> itemCollectionsMap = 
                await collectionLoader.LoadCollectionsAsync(itemIds);

            // Picture review state is shown to the creator and admins only (AC 3.25.2); the rejection reason is
            // loaded in one batched query for exactly those items.
            List<Item> reviewVisibleRejected = items
                .Where(i => i.ImageReviewState == ItemImageReviewState.Rejected && CanSeeImageReview(i, userContext))
                .ToList();
            Dictionary<Guid, string?> rejectionReasons =
                await ItemImageReviewRules.LoadRejectionReasonsAsync(db, reviewVisibleRejected, cancellationToken);

            ItemResponseMapper responseMapper = new(userContext);
            List<GetItems.ItemResponse> itemResponses = items
                .Select(item => responseMapper.MapToResponse(
                    item,
                    itemCollectionsMap.GetValueOrDefault(item.Id, new List<GetItems.CollectionResponse>()),
                    CanSeeImageReview(item, userContext)
                        ? ItemImageReviewRules.InfoOf(item, rejectionReasons.GetValueOrDefault(item.Id))
                        : null))
                .ToList();

            GetItems.Response response = new GetItems.Response(
                itemResponses,
                totalCount,
                request.Page,
                request.PageSize,
                (int)Math.Ceiling((double)totalCount / request.PageSize));

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<GetItems.Response>(
                Error.Problem("Items.GetFailed", "Failed to get items.", ex));
        }
    }

    private static bool CanSeeImageReview(Item item, IUserContext userContext) =>
        userContext.IsAdmin || (userContext.IsAuthenticated && item.CreatedBy == userContext.UserId);
}
