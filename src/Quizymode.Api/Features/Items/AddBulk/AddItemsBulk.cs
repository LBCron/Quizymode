using FluentValidation;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.AddBulk;

public static class AddItemsBulk
{
    public sealed record KeywordRequest(
        string Name,
        bool IsPrivate);

    /// <param name="QuestionImage">Not supported; omit or send null. A non-null value is rejected with 400 (curated pictures are added through seed data).</param>
    /// <param name="ExplanationImage">Not supported; omit or send null. A non-null value is rejected with 400 (curated pictures are added through seed data).</param>
    public sealed record ItemRequest(
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        List<KeywordRequest>? Keywords = null,
        string? Source = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        System.Text.Json.JsonElement? QuestionImage = null,
        System.Text.Json.JsonElement? ExplanationImage = null,
        Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed record Request(
        bool IsPrivate,
        string Category,
        string Keyword1,
        string? Keyword2,
        List<KeywordRequest> Keywords,
        List<ItemRequest> Items,
        Guid? UploadId = null);

    public sealed record Response(
        int TotalRequested,
        int CreatedCount,
        int DuplicateCount,
        int FailedCount,
        List<string> DuplicateQuestions,
        List<ItemError> Errors,
        List<Guid>? CreatedItemIds = null);

    public sealed record ItemError(
        int Index,
        string Question,
        string ErrorMessage);

    public sealed class Validator : AbstractValidator<Request>
    {
        private readonly IUserContext _userContext;

        public Validator(IUserContext userContext)
        {
            _userContext = userContext;

            int maxItems = _userContext.IsAdmin ? 1000 : 100;

            RuleFor(x => x.Items)
                .NotNull()
                .WithMessage("Items is required")
                .Must(items => items is null || items.Count > 0)
                .WithMessage("At least one item is required")
                .Must(items => items is null || items.Count <= maxItems)
                .WithMessage($"Cannot create more than {maxItems} items at once");

            RuleForEach(x => x.Items)
                .SetValidator(new ItemRequestValidator());

            RuleFor(x => x.Category)
                .NotEmpty()
                .WithMessage("Category is required")
                .MaximumLength(100)
                .WithMessage("Category must not exceed 100 characters");

            RuleFor(x => x.Keyword1)
                .NotEmpty()
                .WithMessage("Keyword1 (primary topic) is required")
                .MaximumLength(30)
                .WithMessage("Keyword1 must not exceed 30 characters");

            RuleFor(x => x.Keyword2)
                .NotEmpty()
                .WithMessage("Keyword2 (subtopic) is required")
                .MaximumLength(30)
                .WithMessage("Keyword2 must not exceed 30 characters");

            RuleFor(x => x.Keywords)
                .NotNull()
                .WithMessage("Keywords list is required")
                .Must(k => k is null || k.Count <= 50)
                .WithMessage("Cannot assign more than 50 default keywords")
                .ForEach(rule => rule
                    .SetValidator(new KeywordRequestValidator()));
        }
    }

    public sealed class ItemRequestValidator : AbstractValidator<ItemRequest>
    {
        public ItemRequestValidator()
        {
            RuleFor(x => x.Question)
                .NotEmpty()
                .WithMessage("Question is required")
                .MaximumLength(1000)
                .WithMessage("Question must not exceed 1000 characters");

            this.AddSpeechSupportRules(x => x.QuestionSpeech, 1000, "QuestionSpeech");
            this.AddPictureImportRejectionRules(x => x.QuestionImage, x => x.ExplanationImage);

            RuleFor(x => x.CorrectAnswer)
                .NotEmpty()
                .WithMessage("CorrectAnswer is required")
                .MaximumLength(500)
                .WithMessage("CorrectAnswer must not exceed 500 characters");

            this.AddSpeechSupportRules(x => x.CorrectAnswerSpeech, 500, "CorrectAnswerSpeech");

            RuleFor(x => x.IncorrectAnswers)
                .NotNull()
                .WithMessage("IncorrectAnswers is required")
                .MustHaveOneToFourNonBlank()
                .MustHaveDistinctIncorrectAnswers(x => x.CorrectAnswer)
                .ForEach(rule => rule
                    .MaximumLength(500)
                    .WithMessage("Each incorrect answer must not exceed 500 characters"));

            this.AddIncorrectAnswerSpeechRules(x => x.IncorrectAnswerSpeech, req => req.IncorrectAnswers?.Count ?? 0);
            this.AddIncorrectAnswerRationaleRules(x => x.IncorrectAnswerRationale, req => req.IncorrectAnswers?.Count ?? 0);

            RuleFor(x => x.Explanation)
                .MaximumLength(4000)
                .WithMessage("Explanation must not exceed 4000 characters");

            RuleFor(x => x.Source)
                .MaximumLength(1000)
                .WithMessage("Source must not exceed 1000 characters");

            this.AddGroupLabelRules(x => x.GroupLabel);

            RuleFor(x => x.Keywords)
                .Must(keywords => keywords is null || keywords.Count <= 50)
                .WithMessage("Cannot assign more than 50 keywords to an item")
                .ForEach(rule => rule
                    .SetValidator(new KeywordRequestValidator()));

        }
    }

    public sealed class KeywordRequestValidator : AbstractValidator<KeywordRequest>
    {
        public KeywordRequestValidator()
        {
            RuleFor(x => x.Name)
                .NotEmpty()
                .WithMessage("Keyword name is required")
                .MaximumLength(30)
                .WithMessage("Keyword name must not exceed 30 characters");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("items/bulk", Handler)
                .WithTags("Items")
                .WithSummary("Create multiple items in bulk (admin only)")
                .WithDescription("Admin only. Creates many items in a single request. Each item specifies its own category; isPrivate applies to all items.")
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
            ISimHashService simHashService,
            IUserContext userContext,
            ITaxonomyItemCategoryResolver itemCategoryResolver,
            ITaxonomyRegistry taxonomyRegistry,
            IAuditService auditService,
            ILogger<Endpoint> logger,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            var validationResult = await validator.ValidateAsync(request, cancellationToken);
            if (!validationResult.IsValid)
            {
                return Results.BadRequest(validationResult.Errors);
            }

            Result<Response> result = await AddItemsBulkHandler.HandleAsync(
                request,
                db,
                simHashService,
                userContext,
                itemCategoryResolver,
                taxonomyRegistry,
                auditService,
                logger,
                cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
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

