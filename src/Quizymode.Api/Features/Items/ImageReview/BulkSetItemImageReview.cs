using FluentValidation;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;

namespace Quizymode.Api.Features.Items.ImageReview;

/// <summary>
/// POST /admin/items/image-review/bulk: an admin approves or rejects the pictures of up to 25 items at once (AC 3.26.4).
/// Each item is decided exactly as PUT /admin/items/{id}/image-review decides it, with its own revision check. The batch
/// is not atomic: every item gets its own outcome, so one stale or unavailable item never blocks the others.
/// </summary>
public static class BulkSetItemImageReview
{
    public const int MaxItems = 25;
    private const int MaxReasonLength = 500;

    public sealed record ItemDecision(Guid Id, int ExpectedRevision);

    /// <param name="Decision"><c>approve</c> or <c>reject</c>.</param>
    /// <param name="Items">Each item with the <c>imageReview.revision</c> the reviewer looked at (1 to 25, no duplicates).</param>
    /// <param name="Reason">Required (max 500) when rejecting; applied to every rejected item.</param>
    public sealed record Request(string Decision, List<ItemDecision> Items, string? Reason = null);

    public sealed record ItemOutcome(Guid Id, bool Applied, string? State, int? Revision, string? ErrorCode);

    public sealed record Response(int Applied, int Failed, List<ItemOutcome> Results);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(x => x.Decision)
                .Must(d => string.Equals(d?.Trim(), "approve", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(d?.Trim(), "reject", StringComparison.OrdinalIgnoreCase))
                .WithMessage("Decision must be 'approve' or 'reject'.");

            RuleFor(x => x.Items)
                .NotNull()
                .Must(items => items is { Count: >= 1 and <= MaxItems })
                .WithMessage($"Select between 1 and {MaxItems} pictures.");

            RuleForEach(x => x.Items).ChildRules(item =>
            {
                item.RuleFor(i => i.Id).NotEmpty();
                item.RuleFor(i => i.ExpectedRevision).GreaterThan(0)
                    .WithMessage("ExpectedRevision must be the revision shown on the item's imageReview.");
            });

            RuleFor(x => x.Items)
                .Must(items => items is null || items.Select(i => i.Id).Distinct().Count() == items.Count)
                .WithMessage("Each item may appear only once.");

            RuleFor(x => x.Reason)
                .NotEmpty()
                .When(x => string.Equals(x.Decision?.Trim(), "reject", StringComparison.OrdinalIgnoreCase))
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
            app.MapPost("admin/items/image-review/bulk", Handler)
                .WithTags("Admin")
                .WithSummary("Approve or reject the pictures of up to 25 items (Admin only)")
                .WithDescription("Each item is decided like PUT /admin/items/{id}/image-review. The response lists one outcome per item: " +
                    "applied, or an error code such as Item.ImageReviewStale or Item.ImageAssetUnavailable. Items are not all-or-nothing.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);
        }

        private static async Task<IResult> Handler(
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

            List<ItemOutcome> results = [];
            foreach (ItemDecision item in request.Items)
            {
                SetItemImageReview.Request single = new(request.Decision, item.ExpectedRevision, request.Reason);
                Result<SetItemImageReview.Response> outcome = await SetItemImageReview.HandleAsync(item.Id, single, db, userContext, cancellationToken);
                results.Add(outcome.IsSuccess
                    ? new ItemOutcome(item.Id, true, outcome.Value.ImageReview.State, outcome.Value.ImageReview.Revision, null)
                    : new ItemOutcome(item.Id, false, null, null, outcome.Error.Code));
            }

            int applied = results.Count(r => r.Applied);
            return Results.Ok(new Response(applied, results.Count - applied, results));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<Request>, Validator>();
        }
    }
}
