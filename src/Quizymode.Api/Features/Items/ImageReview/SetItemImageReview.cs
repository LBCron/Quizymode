using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.ImageReview;

/// <summary>
/// PUT /admin/items/{id}/image-review: an admin approves or rejects the uploaded pictures of one item revision (AC 3.25.4).
/// The decision binds to <c>expectedRevision</c> and to a still-pending state, so it can never apply to content the reviewer
/// did not see. It does not publish the item or touch its collections.
/// </summary>
public static class SetItemImageReview
{
    private const string ApproveDecision = "approve";
    private const string RejectDecision = "reject";
    private const int MaxReasonLength = 500;

    /// <param name="Decision"><c>approve</c> or <c>reject</c>.</param>
    /// <param name="ExpectedRevision">The <c>imageReview.revision</c> the reviewer looked at.</param>
    /// <param name="Reason">Required (max 500) when rejecting; optional note when approving.</param>
    public sealed record Request(string Decision, int ExpectedRevision, string? Reason = null);

    public sealed record ReviewResponse(
        string State,
        int Revision,
        string SubmittedBy,
        DateTime SubmittedAt,
        string? DecidedBy,
        DateTime? DecidedAt,
        string? Reason);

    public sealed record Response(string Id, ReviewResponse ImageReview);

    /// <summary>A refused decision that also reports where the item stands now (409).</summary>
    internal sealed record StaleDecisionError(int CurrentRevision, string CurrentState)
        : Error(ItemImageReviewRules.ReviewStaleCode, "The item's pictures changed since you loaded them. Reload and review the current revision.", ErrorType.Conflict);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(x => x.Decision)
                .Must(d => IsDecision(d, ApproveDecision) || IsDecision(d, RejectDecision))
                .WithMessage("Decision must be 'approve' or 'reject'.");

            RuleFor(x => x.ExpectedRevision)
                .GreaterThan(0)
                .WithMessage("ExpectedRevision must be the revision shown on the item's imageReview.");

            RuleFor(x => x.Reason)
                .NotEmpty()
                .When(x => IsDecision(x.Decision, RejectDecision))
                .WithMessage("Reason is required when rejecting.");

            RuleFor(x => x.Reason)
                .MaximumLength(MaxReasonLength)
                .WithMessage($"Reason must not exceed {MaxReasonLength} characters.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPut("admin/items/{id:guid}/image-review", Handler)
                .WithTags("Admin")
                .WithSummary("Approve or reject an item's uploaded pictures (Admin only)")
                .WithDescription("Decides one picture revision. 409 Item.ImageReviewStale (with currentRevision and currentState) when the item moved on; " +
                    "repeating the same decision is a 200 no-op; 409 Item.ImageAssetUnavailable when an approved picture is no longer readable. " +
                    "An admin may decide their own submission; the decision records who submitted and who decided.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status409Conflict);
        }

        private static async Task<IResult> Handler(
            Guid id,
            Request request,
            IValidator<Request> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return Results.BadRequest(validation.Errors);
            }

            Result<Response> result = await HandleAsync(id, request, db, userContext, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error switch
                {
                    StaleDecisionError stale => Results.Problem(
                        title: stale.Code,
                        detail: stale.Description,
                        statusCode: StatusCodes.Status409Conflict,
                        extensions: new Dictionary<string, object?>
                        {
                            ["currentRevision"] = stale.CurrentRevision,
                            ["currentState"] = stale.CurrentState
                        }),
                    { Type: ErrorType.NotFound } => Results.NotFound(),
                    _ => CustomResults.Problem(result)
                });
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        Guid id,
        Request request,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        IDbContextTransaction? transaction = null;
        try
        {
            string adminId = userContext.UserId ?? throw new InvalidOperationException("User ID is required for an image review decision.");
            bool approve = IsDecision(request.Decision, ApproveDecision);
            ItemImageReviewState target = approve ? ItemImageReviewState.Approved : ItemImageReviewState.Rejected;
            string decision = approve ? ItemImageReviewDecisions.Approved : ItemImageReviewDecisions.Rejected;

            transaction = await ItemImageSubmission.BeginAsync(db, cancellationToken);

            Item? item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
            if (item?.ImageReviewState is null)
            {
                return Result.Failure<Response>(Error.NotFound("Item.NotFound", "Item not found"));
            }

            if (item.ImageRevision == request.ExpectedRevision && item.ImageReviewState == target)
            {
                return Result.Success(await BuildResponseAsync(db, item, cancellationToken));
            }

            if (item.ImageRevision != request.ExpectedRevision || item.ImageReviewState != ItemImageReviewState.PendingReview)
            {
                return Result.Failure<Response>(Stale(item));
            }

            ItemImageReview? submission = await db.ItemImageReviews.AsNoTracking()
                .FirstOrDefaultAsync(r => r.ItemId == id && r.Revision == request.ExpectedRevision, cancellationToken);
            if (approve && !await AssetsStillMatchAsync(db, item, submission, cancellationToken))
            {
                return Result.Failure<Response>(Error.Conflict(
                    ItemImageReviewRules.AssetUnavailableCode,
                    "A picture is no longer available or changed since it was submitted. It can't be approved."));
            }


            // The conditional UPDATE is the decision: it only matches while this exact revision is still pending.
            int decided = await db.Items
                .Where(i => i.Id == id
                    && i.ImageRevision == request.ExpectedRevision
                    && i.ImageReviewState == ItemImageReviewState.PendingReview)
                .ExecuteUpdateAsync(setters => setters.SetProperty(i => i.ImageReviewState, target), cancellationToken);
            if (decided == 0)
            {
                if (transaction is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                }

                Item? current = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
                if (current?.ImageReviewState is null)
                {
                    return Result.Failure<Response>(Error.NotFound("Item.NotFound", "Item not found"));
                }

                // A concurrent identical decision already applied: repeating it is a no-op.
                return current.ImageRevision == request.ExpectedRevision && current.ImageReviewState == target
                    ? Result.Success(await BuildResponseAsync(db, current, cancellationToken))
                    : Result.Failure<Response>(Stale(current));
            }

            DateTime decidedAt = DateTime.UtcNow;
            string? reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
            await db.ItemImageReviews
                .Where(r => r.ItemId == id && r.Revision == request.ExpectedRevision && r.Decision == null)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(r => r.Decision, decision)
                    .SetProperty(r => r.DecidedBy, adminId)
                    .SetProperty(r => r.DecidedAt, decidedAt)
                    .SetProperty(r => r.Reason, reason)
                    .SetProperty(r => r.PolicyVersion, ItemImageReviewRules.PolicyVersion),
                    cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            Item decidedItem = (await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken))!;
            return Result.Success(await BuildResponseAsync(db, decidedItem, cancellationToken));
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Item.ImageReviewFailed", "Failed to record the picture review decision.", ex));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    private static StaleDecisionError Stale(Item item) => new(item.ImageRevision, item.ImageReviewState!.Value.ToString());

    private static bool IsDecision(string? value, string expected) =>
        string.Equals(value?.Trim(), expected, StringComparison.OrdinalIgnoreCase);

    /// <summary>Approval needs every attached picture to be a Ready, undeleted asset with the bytes the reviewer was shown.</summary>
    private static async Task<bool> AssetsStillMatchAsync(
        ApplicationDbContext db,
        Item item,
        ItemImageReview? submission,
        CancellationToken cancellationToken)
    {
        async Task<bool> SlotOk(Guid? assetId, Guid? submittedAssetId, string? submittedSha)
        {
            if (assetId is null)
            {
                return true;
            }

            if (submission is not null && submittedAssetId != assetId)
            {
                return false;
            }

            MediaAsset? asset = await db.MediaAssets.AsNoTracking().FirstOrDefaultAsync(a => a.Id == assetId.Value, cancellationToken);
            return asset is not null
                && asset.State == MediaAssetState.Ready
                && asset.DeletedAt == null
                && asset.ObjectKey != null
                && (submission is null || string.Equals(asset.Sha256, submittedSha, StringComparison.Ordinal));
        }

        return await SlotOk(item.QuestionImageAssetId, submission?.QuestionAssetId, submission?.QuestionSha256)
            && await SlotOk(item.ExplanationImageAssetId, submission?.ExplanationAssetId, submission?.ExplanationSha256);
    }

    private static async Task<Response> BuildResponseAsync(ApplicationDbContext db, Item item, CancellationToken cancellationToken)
    {
        ItemImageReview? row = await db.ItemImageReviews.AsNoTracking()
            .FirstOrDefaultAsync(r => r.ItemId == item.Id && r.Revision == item.ImageRevision, cancellationToken);
        return new Response(
            item.Id.ToString(),
            new ReviewResponse(
                item.ImageReviewState!.Value.ToString(),
                item.ImageRevision,
                row?.SubmittedBy ?? string.Empty,
                row?.SubmittedAt ?? default,
                row?.DecidedBy,
                row?.DecidedAt,
                row?.Reason));
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<Request>, Validator>();
        }
    }
}
