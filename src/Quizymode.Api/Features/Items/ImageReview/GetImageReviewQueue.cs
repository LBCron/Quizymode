using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.ImageReview;

/// <summary>
/// GET /admin/items/image-review: the admin picture review queue (#401, AC 3.26). Lists items by picture review state
/// (default PendingReview), oldest submission first. It is independent of the item's own publication review, privacy and visibility.
/// </summary>
public static class GetImageReviewQueue
{
    private const int DefaultPageSize = 25;
    private const int MaxPageSize = 100;

    /// <param name="State">PendingReview (default), Approved, Rejected or Withdrawn.</param>
    public sealed record QueryRequest(string? State = null, int Page = 1, int PageSize = DefaultPageSize);

    public sealed record ReviewResponse(
        string State,
        int Revision,
        string? SubmittedBy,
        string? SubmittedByDisplay,
        DateTime? SubmittedAt,
        string? DecidedBy,
        DateTime? DecidedAt,
        string? Reason);

    public sealed record QueueItem(
        string Id,
        string Category,
        bool IsPrivate,
        bool ReadyForReview,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        string CreatedBy,
        ItemImageReference? QuestionImage,
        ItemImageReference? ExplanationImage,
        ReviewResponse ImageReview,
        long? AgeSeconds);

    public sealed record Response(
        List<QueueItem> Items,
        int TotalCount,
        int Page,
        int PageSize,
        int TotalPages,
        DateTime? OldestSubmittedAt);

    public sealed class Validator : AbstractValidator<QueryRequest>
    {
        public Validator()
        {
            RuleFor(x => x.State)
                .Must(s => s is null || TryParseState(s, out _))
                .WithMessage("State must be one of PendingReview, Approved, Rejected, Withdrawn.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/items/image-review", Handler)
                .WithTags("Admin")
                .WithSummary("Get the picture review queue (Admin only)")
                .WithDescription("Items by picture review state (default PendingReview), oldest submission first, regardless of the item's own review or visibility.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);
        }

        private static async Task<IResult> Handler(
            IValidator<QueryRequest> validator,
            ApplicationDbContext db,
            string? state = null,
            int page = 1,
            int pageSize = DefaultPageSize,
            CancellationToken cancellationToken = default)
        {
            QueryRequest request = new(state, page, pageSize);
            FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return Results.BadRequest(validation.Errors);
            }

            Result<Response> result = await HandleAsync(request, db, DateTime.UtcNow, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        try
        {
            ItemImageReviewState state = ItemImageReviewState.PendingReview;
            if (request.State is not null && !TryParseState(request.State, out state))
            {
                return Result.Failure<Response>(Error.Validation("Item.ImageReviewQueueInvalidState", "Unknown picture review state."));
            }

            int page = Math.Max(1, request.Page);
            int pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);

            // LEFT join: an item without its audit row (tolerated by SetItemImageReview) is still listed, first.
            var query =
                from item in db.Items.AsNoTracking()
                where item.ImageReviewState == state
                join review in db.ItemImageReviews.AsNoTracking()
                    on new { item.Id, Revision = item.ImageRevision } equals new { Id = review.ItemId, review.Revision }
                    into reviews
                from review in reviews.DefaultIfEmpty()
                select new { Item = item, Review = review };

            int totalCount = await query.CountAsync(cancellationToken);
            DateTime? oldest = totalCount == 0
                ? null
                : await query.MinAsync(x => x.Review == null ? (DateTime?)null : x.Review.SubmittedAt, cancellationToken);

            var rows = await query
                .OrderBy(x => x.Review == null ? 0 : 1)
                .ThenBy(x => x.Review!.SubmittedAt)
                .ThenBy(x => x.Item.Id)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(x => new
                {
                    x.Item.Id,
                    Category = x.Item.Category != null ? x.Item.Category.Name : string.Empty,
                    x.Item.IsPrivate,
                    x.Item.ReadyForReview,
                    x.Item.Question,
                    x.Item.CorrectAnswer,
                    x.Item.IncorrectAnswers,
                    x.Item.Explanation,
                    x.Item.CreatedBy,
                    x.Item.QuestionImageKey,
                    x.Item.QuestionImageAlt,
                    x.Item.QuestionImageAttribution,
                    x.Item.ExplanationImageKey,
                    x.Item.ExplanationImageAlt,
                    x.Item.ExplanationImageAttribution,
                    x.Item.ImageRevision,
                    SubmittedBy = x.Review == null ? null : x.Review.SubmittedBy,
                    SubmittedAt = x.Review == null ? (DateTime?)null : x.Review.SubmittedAt,
                    DecidedBy = x.Review == null ? null : x.Review.DecidedBy,
                    DecidedAt = x.Review == null ? null : x.Review.DecidedAt,
                    Reason = x.Review == null ? null : x.Review.Reason
                })
                .ToListAsync(cancellationToken);

            // One batched lookup so reviewers see who submitted without raw ids (same source as the audit log view).
            List<Guid> submitterIds = rows
                .Select(r => r.SubmittedBy)
                .Where(s => s is not null && Guid.TryParse(s, out _))
                .Select(s => Guid.Parse(s!))
                .Distinct()
                .ToList();
            Dictionary<Guid, string?> displayById = submitterIds.Count == 0
                ? new Dictionary<Guid, string?>()
                : await db.Users.AsNoTracking()
                    .Where(u => submitterIds.Contains(u.Id))
                    .Select(u => new { u.Id, Display = u.Email ?? u.Name })
                    .ToDictionaryAsync(u => u.Id, u => u.Display, cancellationToken);

            List<QueueItem> items = rows.Select(r =>
            {
                string? display = r.SubmittedBy is not null && Guid.TryParse(r.SubmittedBy, out Guid submitterId)
                    ? displayById.GetValueOrDefault(submitterId)
                    : null;
                return new QueueItem(
                    r.Id.ToString(),
                    r.Category,
                    r.IsPrivate,
                    r.ReadyForReview,
                    r.Question,
                    r.CorrectAnswer,
                    r.IncorrectAnswers,
                    r.Explanation,
                    r.CreatedBy,
                    ItemImageReferenceHelper.FromColumns(r.QuestionImageKey, r.QuestionImageAlt, r.QuestionImageAttribution),
                    ItemImageReferenceHelper.FromColumns(r.ExplanationImageKey, r.ExplanationImageAlt, r.ExplanationImageAttribution),
                    new ReviewResponse(state.ToString(), r.ImageRevision, r.SubmittedBy, display, r.SubmittedAt, r.DecidedBy, r.DecidedAt, r.Reason),
                    r.SubmittedAt is null ? null : Math.Max(0L, (long)(nowUtc - r.SubmittedAt.Value).TotalSeconds));
            }).ToList();

            return Result.Success(new Response(
                items,
                totalCount,
                page,
                pageSize,
                (int)Math.Ceiling(totalCount / (double)pageSize),
                oldest));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Item.ImageReviewQueueFailed", "Failed to retrieve the picture review queue.", ex));
        }
    }

    private static bool TryParseState(string value, out ItemImageReviewState state) =>
        Enum.TryParse(value.Trim(), ignoreCase: true, out state)
        && Enum.IsDefined(state)
        && !int.TryParse(value.Trim(), out _);

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<QueryRequest>, Validator>();
        }
    }
}
