using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.ReviewBoard;

public static class GetReviewBoardItems
{
    public sealed record Response(List<ItemResponse> Items);

    public sealed record ItemResponse(
        string Id,
        string Category,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        string CreatedBy,
        DateTime CreatedAt,
        decimal? FactualRisk = null,
        string? ReviewComments = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        ItemImageReference? QuestionImage = null,
        ItemImageReference? ExplanationImage = null,
        Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/items/review-board", Handler)
                .WithTags("Admin")
                .WithSummary("Get items ready for review (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK);
        }

        private static async Task<IResult> Handler(
            ApplicationDbContext db,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        try
        {
            var items = await db.Items
                .Where(i => i.ReadyForReview)
                .Include(i => i.Category)
                .OrderByDescending(i => i.CreatedAt)
                .ToListAsync(cancellationToken);

            var itemResponses = items.Select(i =>
            {
                string categoryName = i.Category?.Name ?? string.Empty;

                return new ItemResponse(
                    i.Id.ToString(),
                    categoryName,
                    i.IsPrivate,
                    i.Question,
                    i.CorrectAnswer,
                    i.IncorrectAnswers,
                    i.Explanation,
                    i.CreatedBy,
                    i.CreatedAt,
                    i.FactualRisk,
                    i.ReviewComments,
                    i.QuestionSpeech,
                    i.CorrectAnswerSpeech,
                    i.IncorrectAnswerSpeech.Count > 0 ? i.IncorrectAnswerSpeech : null,
                    i.GroupLabel,
                    ItemImageReferenceHelper.FromColumns(i.QuestionImageKey, i.QuestionImageAlt, i.QuestionImageAttribution, i.QuestionImageLongDescription, i.ImageRevision),
                    ItemImageReferenceHelper.FromColumns(i.ExplanationImageKey, i.ExplanationImageAlt, i.ExplanationImageAttribution, i.ExplanationImageLongDescription, i.ImageRevision),
                                        i.IncorrectAnswerRationale.Count > 0 ? i.IncorrectAnswerRationale : null);
            }).ToList();

            return Result.Success(new Response(itemResponses));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Items.GetReviewBoardFailed", "Failed to retrieve review board items.", ex));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            // No specific services needed
        }
    }
}

