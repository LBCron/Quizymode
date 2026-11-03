using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.GetById;

public static class GetItemById
{
    public sealed record Response(
        string Id,
        string? Category,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        DateTime CreatedAt,
        string? CreatedBy,
        List<KeywordResponse> Keywords,
        List<CollectionResponse> Collections,
        string? Source,
        string? UploadId = null,
        List<string> NavigationBreadcrumb = null!, // Navigation path for breadcrumbs: e.g. [rank1, rank2] or ["other"] when item has no rank1/rank2 keyword. Use "other" in URLs; display as "Others".
        decimal? FactualRisk = null,
        string? ReviewComments = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        ItemImageReference? QuestionImage = null,
        ItemImageReference? ExplanationImage = null,
        ItemImageReviewInfo? ImageReview = null);

    public sealed record KeywordResponse(
        string Id,
        string Name,
        bool IsPrivate);

    public sealed record CollectionResponse(
        string Id,
        string Name,
        DateTime CreatedAt);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("items/{id}", Handler)
                .WithTags("Items")
                .WithSummary("Get a single quiz item by id")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            string id,
            ApplicationDbContext db,
            IUserContext userContext = null!,
            CancellationToken cancellationToken = default)
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
        string id,
        ApplicationDbContext db,
        IUserContext userContext,
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
                .Include(i => i.Category)
                .Include(i => i.ItemKeywords)
                    .ThenInclude(ik => ik.Keyword)
                .Where(ItemVisibility.AccessibleById(userContext))
                .FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);

            if (item is null)
            {
                return Result.Failure<Response>(
                    Error.NotFound("Item.NotFound", $"Item with id {id} not found"));
            }

            // Get category name from Category navigation
            string? categoryName = item.Category?.Name;

            // Filter keywords based on visibility
            List<KeywordResponse> visibleKeywords = new();
            foreach (ItemKeyword itemKeyword in item.ItemKeywords)
            {
                Keyword keyword = itemKeyword.Keyword;
                
                // Check if keyword is visible to current user
                bool isVisible = false;
                if (!keyword.IsPrivate)
                {
                    // Global keyword - visible to everyone
                    isVisible = true;
                }
                else if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
                {
                    // Private keyword - only visible to creator
                    isVisible = keyword.CreatedBy == userContext.UserId;
                }

                if (isVisible)
                {
                    visibleKeywords.Add(new KeywordResponse(
                        keyword.Id.ToString(),
                        keyword.Name,
                        keyword.IsPrivate));
                }
            }

            // Load collections for this item using authenticated user's ID
            // Collections are filtered by authenticated userId - no collections for anonymous users
            // Admins can see all collections
            List<CollectionResponse> collections = new();
            if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
            {
                List<Collection> itemCollections = await db.CollectionItems
                    .Where(ci => ci.ItemId == itemId)
                    .Join(db.Collections, ci => ci.CollectionId, c => c.Id, (ci, c) => c)
                    .Where(c => c.CreatedBy == userContext.UserId || userContext.IsAdmin)
                    .OrderBy(c => c.Name)
                    .ToListAsync(cancellationToken);

                collections = itemCollections.Select(c => new CollectionResponse(
                    c.Id.ToString(),
                    c.Name,
                    c.CreatedAt)).ToList();
            }

            // Build navigation breadcrumb: rank1, rank2 (or "other" when item has no nav keyword for that level)
            List<string> navigationBreadcrumb = await GetNavigationBreadcrumbAsync(db, item, cancellationToken);

            // Review state is shown to the creator and admins only (AC 3.25.2); so is the rejection reason.
            bool canSeeImageReview = userContext.IsAdmin || (userContext.IsAuthenticated && item.CreatedBy == userContext.UserId);
            string? rejectionReason = null;
            if (canSeeImageReview && item.ImageReviewState == ItemImageReviewState.Rejected)
            {
                Dictionary<Guid, string?> reasons = await ItemImageReviewRules.LoadRejectionReasonsAsync(db, [item], cancellationToken);
                rejectionReason = reasons.GetValueOrDefault(item.Id);
            }

            Response response = new(
                item.Id.ToString(),
                categoryName,
                item.IsPrivate,
                item.Question,
                item.CorrectAnswer,
                item.IncorrectAnswers,
                item.Explanation,
                item.CreatedAt,
                item.CreatedBy,
                visibleKeywords,
                collections,
                item.Source,
                item.UploadId?.ToString(),
                navigationBreadcrumb,
                item.FactualRisk,
                item.ReviewComments,
                item.QuestionSpeech,
                item.CorrectAnswerSpeech,
                item.IncorrectAnswerSpeech.Count > 0 ? item.IncorrectAnswerSpeech : null,
                item.GroupLabel,
                ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt, item.QuestionImageAttribution),
                ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt, item.ExplanationImageAttribution),
                canSeeImageReview ? ItemImageReviewRules.InfoOf(item, rejectionReason) : null);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Item.GetFailed", "Failed to get item.", ex));
        }
    }

    /// <summary>
    /// Returns navigation path for breadcrumbs: [rank1Name, rank2Name] using "other" when item has no nav keyword at that level.
    /// </summary>
    private static async Task<List<string>> GetNavigationBreadcrumbAsync(
        ApplicationDbContext db,
        Item item,
        CancellationToken cancellationToken)
    {
        if (!item.CategoryId.HasValue)
            return new List<string>();

        if (item.NavigationKeywordId1 == null)
            return new List<string> { "other" };

        string? rank1Name = await db.Keywords
            .Where(k => k.Id == item.NavigationKeywordId1)
            .Select(k => k.Name)
            .FirstOrDefaultAsync(cancellationToken);
        if (rank1Name == null)
            return new List<string> { "other" };

        if (item.NavigationKeywordId2 == null)
            return new List<string> { rank1Name };

        string? rank2Name = await db.Keywords
            .Where(k => k.Id == item.NavigationKeywordId2)
            .Select(k => k.Name)
            .FirstOrDefaultAsync(cancellationToken);
        if (rank2Name != null)
            return new List<string> { rank1Name, rank2Name };
        return new List<string> { rank1Name };
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services needed for this feature.
        }
    }
}


