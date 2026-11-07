using FluentValidation;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Add;

public static class AddItem
{
    public sealed record KeywordRequest(
        string Name,
        bool IsPrivate);

    /// <param name="QuestionImage">Optional uploaded picture: <c>{ assetId, altText, attribution? }</c> from POST /media/images. Keys, URLs and <c>remove</c> are rejected with 400.</param>
    /// <param name="ExplanationImage">Optional uploaded picture shown after the answer; requires explanation text. Same shape as <paramref name="QuestionImage"/>.</param>
    public sealed record Request(
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        List<KeywordRequest>? Keywords = null,
        bool ReadyForReview = false,
        string? Source = null,
        Guid? UploadId = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        ImageSlotInput? QuestionImage = null,
        ImageSlotInput? ExplanationImage = null,
        Guid? CreateRequestId = null,
        Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed record Response(
        string Id,
        string Category,
        bool IsPrivate,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        DateTime CreatedAt,
        string? Source,
        string? UploadId = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        ItemImageReference? QuestionImage = null,
        ItemImageReference? ExplanationImage = null,
        ItemImageReviewInfo? ImageReview = null,
        Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(x => x.Category)
                .NotEmpty()
                .WithMessage("Category is required");

            RuleFor(x => x.NavigationKeyword1)
                .NotEmpty()
                .WithMessage("NavigationKeyword1 (primary topic) is required")
                .MaximumLength(30)
                .WithMessage("NavigationKeyword1 must not exceed 30 characters");

            RuleFor(x => x.NavigationKeyword2)
                .NotEmpty()
                .WithMessage("NavigationKeyword2 (subtopic) is required")
                .MaximumLength(30)
                .WithMessage("NavigationKeyword2 must not exceed 30 characters");

            RuleFor(x => x.Question)
                .NotEmpty()
                .WithMessage("Question is required")
                .MaximumLength(1000)
                .WithMessage("Question must not exceed 1000 characters");

            this.AddSpeechSupportRules(x => x.QuestionSpeech, 1000, "QuestionSpeech");
            this.AddImageSlotRules(x => x.QuestionImage, "QuestionImage", allowRemove: false);
            this.AddImageSlotRules(x => x.ExplanationImage, "ExplanationImage", allowRemove: false);
            this.AddExplanationPictureRequiresTextRule(x => x.ExplanationImage, x => x.Explanation);

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

            RuleFor(x => x.Keywords)
                .Must(keywords => keywords is null || keywords.Count <= 50)
                .WithMessage("Cannot assign more than 50 keywords to an item")
                .ForEach(rule => rule
                    .SetValidator(new KeywordRequestValidator()));

            RuleFor(x => x.Source)
                .MaximumLength(1000)
                .WithMessage("Source must not exceed 1000 characters");

            this.AddGroupLabelRules(x => x.GroupLabel);

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
            app.MapPost("items", Handler)
                .WithTags("Items")
                .WithSummary("Create a new quiz item")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status201Created)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status429TooManyRequests)
                .Produces(StatusCodes.Status409Conflict);
        }

        private static async Task<IResult> Handler(
            Request request,
            IValidator<Request> validator,
            ApplicationDbContext db,
            ISimHashService simHashService,
            IUserContext userContext,
            IAuditService auditService,
            ITaxonomyItemCategoryResolver itemCategoryResolver,
            ITaxonomyRegistry taxonomyRegistry,
            CancellationToken cancellationToken)
        {
            var validationResult = await validator.ValidateAsync(request, cancellationToken);
            if (!validationResult.IsValid)
            {
                return Results.BadRequest(validationResult.Errors);
            }

            Result<Response> result = await AddItemHandler.HandleAsync(
                request,
                db,
                simHashService,
                userContext,
                auditService,
                itemCategoryResolver,
                taxonomyRegistry,
                cancellationToken);

            return result.Match(
                value => Results.Created($"/api/items/{value.Id}", value),
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

