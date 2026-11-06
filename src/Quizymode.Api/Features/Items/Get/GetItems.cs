using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Get;

/// <summary>
/// Feature for retrieving quiz items with support for filtering, pagination, and collection-based queries.
/// Implements comprehensive querying capabilities allowing clients to filter by category, visibility, keywords, and collections.
/// </summary>
public static class GetItems
{
    /// <summary>
    /// Request DTO containing all query parameters for filtering and paginating items.
    /// Category: Filter by category name (case-insensitive match).
    /// IsPrivate: Filter by visibility - null = all visible, true = only private items, false = only global items.
    /// Keywords: Filter by keyword names (comma-separated string parsed into list).
    /// CollectionId: Filter items belonging to a specific collection (requires authentication and ownership).
    /// IsRandom: If true, returns random selection; if false or null, returns paginated ordered results.
    /// Page: 1-based page number for pagination.
    /// PageSize: Number of items per page (must be between 1 and 1000).
    /// </summary>
    public sealed record QueryRequest(
        string? Category,
        bool? IsPrivate,
        List<string>? Keywords,
        Guid? CollectionId,
        bool? IsRandom,
        int Page = 1,
        int PageSize = 10,
        List<string>? NavigationKeywords = null);

    public sealed record Response(
        List<ItemResponse> Items,
        int TotalCount,
        int Page,
        int PageSize,
        int TotalPages);

    public sealed record ItemResponse(
        string Id,
        string Category,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        DateTime CreatedAt,
        List<KeywordResponse> Keywords,
        List<CollectionResponse> Collections,
        string? Source,
        string? UploadId = null,
        decimal? FactualRisk = null,
        string? ReviewComments = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        ItemImageReference? QuestionImage = null,
        ItemImageReference? ExplanationImage = null,
        ItemImageReviewInfo? ImageReview = null,
        Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed record KeywordResponse(
        string Id,
        string Name,
        bool IsPrivate);

    public sealed record CollectionResponse(
        string Id,
        string Name,
        DateTime CreatedAt);

    /// <summary>
    /// API endpoint for querying items with filtering and pagination support.
    /// Exposes GET /api/items endpoint with query parameters for all filter options.
    /// </summary>
    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("items", Handler)
                .WithTags("Items")
                .WithSummary("Get quiz items with filtering and pagination")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);
        }

        /// <summary>
        /// HTTP handler for the items endpoint. Validates pagination parameters before processing.
        /// Parses comma-separated keywords string into a list. Delegates business logic to GetItemsHandler.
        /// </summary>
        private static async Task<IResult> Handler(
            string? category,
            bool? isPrivate,
            string? keywords,
            string? nav,
            Guid? collectionId,
            bool? isRandom,
            int page = 1,
            int pageSize = 10,
            ApplicationDbContext db = null!,
            IUserContext userContext = null!,
            CancellationToken cancellationToken = default)
        {
            if (page < 1)
            {
                return CustomResults.BadRequest("Page must be greater than 0");
            }

            if (pageSize < 1 || pageSize > 1000)
            {
                return CustomResults.BadRequest("PageSize must be between 1 and 1000");
            }

            List<string>? keywordList = null;
            if (!string.IsNullOrEmpty(keywords))
            {
                keywordList = keywords.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(k => !string.IsNullOrWhiteSpace(k))
                    .ToList();
            }

            List<string>? navigationKeywordList = null;
            if (!string.IsNullOrEmpty(nav))
            {
                navigationKeywordList = nav.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(k => !string.IsNullOrWhiteSpace(k))
                    .ToList();
            }

            var request = new QueryRequest(category, isPrivate, keywordList, collectionId, isRandom, page, pageSize, navigationKeywordList);
            Result<Response> result = await GetItemsHandler.HandleAsync(request, db, userContext, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services needed for this feature
        }
    }
}

