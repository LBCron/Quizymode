using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.ReviewBoard;

public static class RejectItem
{
    public sealed record Request(string? Reason);

    public sealed record RejectItemResponse(
        string Id,
        string Category,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        DateTime CreatedAt,
        string? ReviewComments,
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
            app.MapPut("admin/items/{id:guid}/rejection", Handler)
                .WithTags("Admin")
                .WithSummary("Reject an item from the review board (Admin only)")
                .WithDescription("Rejects the item, keeps it private, clears ReadyForReview, and appends a rejection note to ReviewComments.")
                .RequireAuthorization("Admin")
                .Produces<RejectItemResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            Guid id,
            Request request,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            Result<RejectItemResponse> result = await HandleAsync(id, request, db, userContext, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => error.Error.Type == ErrorType.NotFound
                    ? CustomResults.NotFound(error.Error.Description, error.Error.Code)
                    : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<RejectItemResponse>> HandleAsync(
        Guid id,
        Request request,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        try
        {
            Item? item = await db.Items
                .Include(i => i.Category)
                .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);

            if (item is null)
            {
                return Result.Failure<RejectItemResponse>(
                    Error.NotFound("Item.NotFound", "Item not found"));
            }

            // Reject: keep it private, remove from review board, and append a rejection note
            item.ReadyForReview = false;
            item.UpdatedAt = DateTime.UtcNow;

            string adminIdentifier = userContext.UserId ?? "admin";
            string reason = string.IsNullOrWhiteSpace(request.Reason)
                ? "no reason provided"
                : request.Reason.Trim();
            string note = $"Rejected at {DateTime.UtcNow:O} by {adminIdentifier}: {reason}";

            if (string.IsNullOrWhiteSpace(item.ReviewComments))
            {
                item.ReviewComments = note;
            }
            else
            {
                item.ReviewComments = $"{item.ReviewComments}\n{note}";
            }

            await db.SaveChangesAsync(cancellationToken);

            string categoryName = item.Category?.Name ?? string.Empty;

            RejectItemResponse response = new(
                item.Id.ToString(),
                categoryName,
                item.IsPrivate,
                item.Question,
                item.CorrectAnswer,
                item.IncorrectAnswers,
                item.Explanation,
                item.CreatedAt,
                item.ReviewComments,
                item.QuestionSpeech,
                item.CorrectAnswerSpeech,
                item.IncorrectAnswerSpeech.Count > 0 ? item.IncorrectAnswerSpeech : null,
                ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt),
                ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt),
                item.IncorrectAnswerRationale.Count > 0 ? item.IncorrectAnswerRationale : null);

            return Result.Success(response);
        }
        catch (Exception ex)
        {
            return Result.Failure<RejectItemResponse>(
                Error.Problem("Items.RejectFailed", "Failed to reject item.", ex));
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

