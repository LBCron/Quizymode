using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.ReviewBoard;

public static class ApproveItem
{
    public sealed record ApproveItemResponse(
        string Id,
        string Category,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        DateTime CreatedAt,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        ItemImageReference? QuestionImage = null,
        ItemImageReference? ExplanationImage = null,
        Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPut("admin/items/{id:guid}/approval", Handler)
                .WithTags("Admin")
                .WithSummary("Approve an item for review (Admin only)")
                .WithDescription("No request body. Approves the item (makes it public and removes from review board).")
                .RequireAuthorization("Admin")
                .Produces<ApproveItemResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status409Conflict);
        }

        private static async Task<IResult> Handler(
            Guid id,
            ApplicationDbContext db,
            CancellationToken cancellationToken)
        {
            Result<ApproveItemResponse> result = await HandleAsync(id, db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => error.Error.Type == ErrorType.NotFound
                    ? CustomResults.NotFound(error.Error.Description, error.Error.Code)
                    : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<ApproveItemResponse>> HandleAsync(
        Guid id,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        try
        {
            Item? item = await db.Items
                .Include(i => i.Category)
                .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);

            if (item is null)
            {
                return Result.Failure<ApproveItemResponse>(Error.NotFound("Item.NotFound", "Item not found"));
            }

            // Pictures must be approved before a private item is published (AC 3.25.6); this is policy, the access gate is the security boundary.
            if (ItemImageReviewRules.BlocksPublish(item.IsPrivate, false, item.ImageReviewState))
            {
                return Result.Failure<ApproveItemResponse>(ItemImageReviewRules.ReviewRequired());
            }

            // Approve: make it global and remove from review board
            item.IsPrivate = false;
            item.ReadyForReview = false;
            item.UpdatedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(cancellationToken);

            // Get category name from Category navigation
            string categoryName = item.Category?.Name ?? string.Empty;

            ApproveItemResponse response = new ApproveItemResponse(
                item.Id.ToString(),
                categoryName,
                item.IsPrivate,
                item.Question,
                item.CorrectAnswer,
                item.IncorrectAnswers,
                item.Explanation,
                item.CreatedAt,
                item.QuestionSpeech,
                item.CorrectAnswerSpeech,
                item.IncorrectAnswerSpeech.Count > 0 ? item.IncorrectAnswerSpeech : null,
                ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt, item.QuestionImageAttribution),
                ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt, item.ExplanationImageAttribution),
                item.IncorrectAnswerRationale.Count > 0 ? item.IncorrectAnswerRationale : null);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<ApproveItemResponse>(
                Error.Problem("Items.ApproveFailed", "Failed to approve item.", ex));
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

