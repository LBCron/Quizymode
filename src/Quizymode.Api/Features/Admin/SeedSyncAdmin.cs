using FluentValidation;
using FluentValidation.Results;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

public static class SeedSyncAdmin
{
    public sealed record SeedItemRequest(
        Guid ItemId,
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string? Explanation = null,
        List<string>? Keywords = null,
        string? Source = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        ItemImageReference? QuestionImage = null,
        ItemImageReference? ExplanationImage = null,
        string? StarterWorld = null,
        string? WowLine = null);

    public sealed record SeedCollectionRequest(
        Guid CollectionId,
        string Name,
        string? Description,
        List<Guid> ItemIds);

    public sealed record ManifestRequest(
        string SeedSet,
        List<SeedItemRequest> Items,
        List<SeedCollectionRequest> Collections,
        int DeltaPreviewLimit = 200);

    public sealed record SourceContext(
        string RepositoryOwner,
        string RepositoryName,
        string GitRef,
        string ResolvedCommitSha,
        string ItemsPath,
        int SourceFileCount,
        string CollectionsPath,
        int CollectionSourceFileCount,
        int TotalFiles = 0,
        int ProcessedFiles = 0,
        int NextFileOffset = 0,
        bool IsComplete = true);

    public sealed record Request(
        int SchemaVersion,
        string RepositoryOwner,
        string RepositoryName,
        string GitRef,
        int DeltaPreviewLimit = 200,
        string? SinceCommitSha = null,
        int FileOffset = 0,
        int FileBatchSize = 50);

    public sealed record LocalRequest(int DeltaPreviewLimit = 200);

    public sealed record ChangeResponse(
        Guid ItemId,
        string Action,
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        string Question,
        List<string> ChangedFields);

    public sealed record PreviewResponse(
        string RepositoryOwner,
        string RepositoryName,
        string GitRef,
        string ResolvedCommitSha,
        string ItemsPath,
        int SourceFileCount,
        string CollectionsPath,
        int CollectionSourceFileCount,
        string SeedSet,
        int TotalItemsInPayload,
        int ExistingItemCount,
        int AffectedItemCount,
        int CreatedCount,
        int UpdatedCount,
        int DeletedCount,
        int UnchangedCount,
        int TotalCollectionsInPayload,
        int ExistingCollectionCount,
        int AffectedCollectionCount,
        int CollectionCreatedCount,
        int CollectionUpdatedCount,
        int CollectionDeletedCount,
        int CollectionUnchangedCount,
        int TotalFiles,
        int ProcessedFiles,
        int NextFileOffset,
        bool IsComplete,
        long DurationMs,
        bool HasMoreChanges,
        List<ChangeResponse> Changes);

    public sealed record ApplyResponse(
        string RepositoryOwner,
        string RepositoryName,
        string GitRef,
        string ResolvedCommitSha,
        string ItemsPath,
        int SourceFileCount,
        string CollectionsPath,
        int CollectionSourceFileCount,
        string SeedSet,
        int TotalItemsInPayload,
        int ExistingItemCount,
        int AffectedItemCount,
        int CreatedCount,
        int UpdatedCount,
        int DeletedCount,
        int UnchangedCount,
        int TotalCollectionsInPayload,
        int ExistingCollectionCount,
        int AffectedCollectionCount,
        int CollectionCreatedCount,
        int CollectionUpdatedCount,
        int CollectionDeletedCount,
        int CollectionUnchangedCount,
        int TotalFiles,
        int ProcessedFiles,
        int NextFileOffset,
        bool IsComplete,
        long DurationMs,
        Guid? HistoryRunId,
        DateTime? HistoryRecordedUtc,
        bool HasMoreChanges,
        List<ChangeResponse> Changes);

    public sealed record HistoryItemResponse(
        Guid ItemId,
        string Action,
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        string Question,
        List<string> ChangedFields);

    public sealed record HistoryRunResponse(
        Guid RunId,
        DateTime CreatedUtc,
        string? TriggeredByUserId,
        string RepositoryOwner,
        string RepositoryName,
        string GitRef,
        string ResolvedCommitSha,
        string ItemsPath,
        string SeedSet,
        int SourceFileCount,
        int TotalItemsInPayload,
        int ExistingItemCount,
        int AffectedItemCount,
        int CreatedCount,
        int UpdatedCount,
        int DeletedCount,
        int UnchangedCount,
        bool HasMoreChanges,
        List<HistoryItemResponse> Changes);

    public sealed record HistoryResponse(List<HistoryRunResponse> Runs);

    internal static ValidationResult ValidateManifest(ManifestRequest request)
    {
        return new ManifestValidator().Validate(request);
    }

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(x => x.SchemaVersion)
                .Equal(2)
                .WithMessage("SchemaVersion must be 2.");

            RuleFor(x => x.RepositoryOwner)
                .NotEmpty()
                .WithMessage("RepositoryOwner is required.")
                .MaximumLength(100)
                .WithMessage("RepositoryOwner must not exceed 100 characters.");

            RuleFor(x => x.RepositoryName)
                .NotEmpty()
                .WithMessage("RepositoryName is required.")
                .MaximumLength(100)
                .WithMessage("RepositoryName must not exceed 100 characters.");

            RuleFor(x => x.GitRef)
                .NotEmpty()
                .WithMessage("GitRef is required.")
                .MaximumLength(200)
                .WithMessage("GitRef must not exceed 200 characters.");

            RuleFor(x => x.DeltaPreviewLimit)
                .InclusiveBetween(0, 500)
                .WithMessage("DeltaPreviewLimit must be between 0 and 500.");

            RuleFor(x => x.FileOffset)
                .GreaterThanOrEqualTo(0)
                .WithMessage("FileOffset must be >= 0.");

            RuleFor(x => x.FileBatchSize)
                .InclusiveBetween(1, 200)
                .WithMessage("FileBatchSize must be between 1 and 200.");

            RuleFor(x => x.SinceCommitSha)
                .MaximumLength(200)
                .When(x => x.SinceCommitSha is not null)
                .WithMessage("SinceCommitSha must not exceed 200 characters.");
        }
    }

    private sealed class ManifestValidator : AbstractValidator<ManifestRequest>
    {
        public ManifestValidator()
        {
            RuleFor(x => x.SeedSet)
                .NotEmpty()
                .WithMessage("SeedSet is required.")
                .MaximumLength(200)
                .WithMessage("SeedSet must not exceed 200 characters.");

            RuleFor(x => x.DeltaPreviewLimit)
                .InclusiveBetween(0, 500)
                .WithMessage("DeltaPreviewLimit must be between 0 and 500.");

            RuleFor(x => x.Items)
                .NotNull()
                .WithMessage("Items is required.")
                .Must(items => items is null || items.Count <= 20000)
                .WithMessage("Cannot sync more than 20000 items at once.")
                .Must(items => items is null || items.All(i => i is not null))
                .WithMessage("Items must not contain null entries.")
                .Must(HaveUniqueItemIds)
                .WithMessage("ItemId values must be unique within a sync request.");

            RuleFor(x => x.Collections)
                .NotNull()
                .WithMessage("Collections is required.")
                .Must(collections => collections is null || collections.Count <= 2000)
                .WithMessage("Cannot sync more than 2000 collections at once.")
                .Must(collections => collections is null || collections.All(c => c is not null))
                .WithMessage("Collections must not contain null entries.")
                .Must(HaveUniqueCollectionIds)
                .WithMessage("CollectionId values must be unique within a sync request.");

            RuleFor(x => x)
                .Must(request => request.Items is null || request.Collections is null || request.Items.Count > 0 || request.Collections.Count > 0)
                .WithMessage("At least one item or collection is required.");

            RuleForEach(x => x.Items)
                .SetValidator(new SeedItemValidator());

            RuleForEach(x => x.Collections)
                .SetValidator(new SeedCollectionValidator());
        }

        private static bool HaveUniqueItemIds(List<SeedItemRequest>? items)
        {
            if (items is null)
            {
                return true;
            }

            return items.Where(i => i is not null).Select(i => i.ItemId).Distinct().Count() == items.Count(i => i is not null);
        }

        private static bool HaveUniqueCollectionIds(List<SeedCollectionRequest>? collections)
        {
            if (collections is null)
            {
                return true;
            }

            return collections.Where(c => c is not null).Select(c => c.CollectionId).Distinct().Count() == collections.Count(c => c is not null);
        }
    }

    private sealed class SeedItemValidator : AbstractValidator<SeedItemRequest>
    {
        public SeedItemValidator()
        {
            RuleFor(x => x.ItemId)
                .NotEmpty()
                .WithMessage("ItemId is required.");

            RuleFor(x => x.Category)
                .NotEmpty()
                .WithMessage("Category is required.")
                .MaximumLength(100)
                .WithMessage("Category must not exceed 100 characters.");

            RuleFor(x => x.NavigationKeyword1)
                .NotEmpty()
                .WithMessage("NavigationKeyword1 is required.")
                .Must(KeywordHelper.IsValidKeywordNameFormat)
                .WithMessage(x => $"NavigationKeyword1 '{x.NavigationKeyword1}' is invalid: use only letters, numbers, and hyphens (max 30 characters).");

            RuleFor(x => x.NavigationKeyword2)
                .NotEmpty()
                .WithMessage("NavigationKeyword2 is required.")
                .Must(KeywordHelper.IsValidKeywordNameFormat)
                .WithMessage(x => $"NavigationKeyword2 '{x.NavigationKeyword2}' is invalid: use only letters, numbers, and hyphens (max 30 characters).");

            RuleFor(x => x.Question)
                .NotEmpty()
                .WithMessage("Question is required.")
                .MaximumLength(1000)
                .WithMessage("Question must not exceed 1000 characters.");

            RuleFor(x => x.CorrectAnswer)
                .NotEmpty()
                .WithMessage("CorrectAnswer is required.")
                .MaximumLength(500)
                .WithMessage("CorrectAnswer must not exceed 500 characters.");

            this.AddSpeechSupportRules(x => x.QuestionSpeech, 1000, "QuestionSpeech");
            this.AddSpeechSupportRules(x => x.CorrectAnswerSpeech, 500, "CorrectAnswerSpeech");
            this.AddQuestionImageRules(x => x.QuestionImage);
            this.AddExplanationImageRules(x => x.ExplanationImage, x => x.Explanation);

            RuleFor(x => x.StarterWorld)
                .Must(world => Starter.StarterWorlds.IsValid(world!.Trim()))
                .When(x => !string.IsNullOrWhiteSpace(x.StarterWorld))
                .WithMessage($"StarterWorld must be one of: {string.Join(", ", Starter.StarterWorlds.All)}.");

            RuleFor(x => x.WowLine)
                .Must(line => line!.Trim().Length <= Starter.StarterWorlds.MaxWowLineLength)
                .When(x => !string.IsNullOrWhiteSpace(x.WowLine))
                .WithMessage($"WowLine must not exceed {Starter.StarterWorlds.MaxWowLineLength} characters.");

            RuleFor(x => x.WowLine)
                .Must(line => !line!.Any(char.IsControl))
                .When(x => !string.IsNullOrWhiteSpace(x.WowLine))
                .WithMessage("WowLine must be a single line without control characters.");

            RuleFor(x => x)
                .Must(x => string.IsNullOrWhiteSpace(x.StarterWorld) == string.IsNullOrWhiteSpace(x.WowLine))
                .WithName("StarterWorld")
                .WithMessage("StarterWorld and WowLine must be provided together.");

            RuleFor(x => x.IncorrectAnswers)
                .NotNull()
                .WithMessage("IncorrectAnswers is required.")
                .MustHaveOneToFourNonBlank()
                .MustHaveDistinctIncorrectAnswers(x => x.CorrectAnswer)
                .ForEach(rule => rule
                    .NotEmpty()
                    .WithMessage("Incorrect answers cannot be empty.")
                    .MaximumLength(500)
                    .WithMessage("Each incorrect answer must not exceed 500 characters."));

            this.AddIncorrectAnswerSpeechRules(x => x.IncorrectAnswerSpeech, req => req.IncorrectAnswers?.Count ?? 0);

            RuleFor(x => x.Explanation)
                .MaximumLength(4000)
                .When(x => x.Explanation is not null)
                .WithMessage("Explanation must not exceed 4000 characters.");

            RuleFor(x => x.Source)
                .MaximumLength(1000)
                .When(x => x.Source is not null)
                .WithMessage("Source must not exceed 1000 characters.");

            RuleFor(x => x.Keywords)
                .Must(keywords => keywords is null || keywords.Count <= 50)
                .WithMessage("Cannot assign more than 50 keywords to an item.");

            RuleForEach(x => x.Keywords!)
                .NotEmpty()
                .WithMessage("Keyword names cannot be empty.")
                .Must(KeywordHelper.IsValidKeywordNameFormat)
                .WithMessage((_, kw) => $"Keyword '{kw}' is invalid: use only letters, numbers, and hyphens (max 30 characters).");
        }
    }

    private sealed class SeedCollectionValidator : AbstractValidator<SeedCollectionRequest>
    {
        public SeedCollectionValidator()
        {
            RuleFor(x => x.CollectionId)
                .NotEmpty()
                .WithMessage("CollectionId is required.");

            RuleFor(x => x.Name)
                .NotEmpty()
                .WithMessage("Collection name is required.")
                .MaximumLength(120)
                .WithMessage("Collection name must not exceed 120 characters.");

            RuleFor(x => x.Description)
                .MaximumLength(1000)
                .When(x => x.Description is not null)
                .WithMessage("Collection description must not exceed 1000 characters.");

            RuleFor(x => x.ItemIds)
                .NotNull()
                .WithMessage("Collection itemIds are required.")
                .Must(itemIds => itemIds is null || itemIds.Count > 0)
                .WithMessage("Collections must reference at least one item.")
                .Must(itemIds => itemIds is null || itemIds.Distinct().Count() == itemIds.Count)
                .WithMessage("Collection itemIds must be unique within a collection.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("admin/seed-sync/preview", PreviewHandler)
                .WithTags("Admin")
                .WithSummary("Preview a repo-managed GitHub sync (Admin only)")
                .WithDescription("Fetches canonical repo-managed items and public collections from GitHub at a specific ref and returns the upsert delta.")
                .RequireAuthorization("Admin")
                .Produces<PreviewResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);

            app.MapPost("admin/seed-sync/apply", ApplyHandler)
                .WithTags("Admin")
                .WithSummary("Apply a repo-managed GitHub sync (Admin only)")
                .WithDescription("Fetches canonical repo-managed items and public collections from GitHub at a specific ref and upserts them.")
                .RequireAuthorization("Admin")
                .Produces<ApplyResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);

            app.MapGet("admin/seed-sync/history", HistoryHandler)
                .WithTags("Admin")
                .WithSummary("Get recent repo-managed seed sync history (Admin only)")
                .WithDescription("Returns the most recent persisted seed sync runs and their affected item changes.")
                .RequireAuthorization("Admin")
                .Produces<HistoryResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);

            app.MapPost("admin/seed-sync/local/preview", LocalPreviewHandler)
                .WithTags("Admin")
                .WithSummary("Preview a local filesystem seed sync (Admin only)")
                .WithDescription("Reads seed items from the server's local seed-dev path and returns the upsert delta without applying it.")
                .RequireAuthorization("Admin")
                .Produces<PreviewResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);

            app.MapPost("admin/seed-sync/local/apply", LocalApplyHandler)
                .WithTags("Admin")
                .WithSummary("Apply a local filesystem seed sync (Admin only)")
                .WithDescription("Reads seed items from the server's local seed-dev path and upserts them.")
                .RequireAuthorization("Admin")
                .Produces<ApplyResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> PreviewHandler(
            Request request,
            IValidator<Request> validator,
            SeedSyncAdminService service,
            CancellationToken cancellationToken)
        {
            ValidationResult validationResult = await validator.ValidateAsync(request, cancellationToken);
            if (!validationResult.IsValid)
            {
                return Results.BadRequest(validationResult.Errors);
            }

            Result<PreviewResponse> result = await service.PreviewAsync(request, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> ApplyHandler(
            Request request,
            IValidator<Request> validator,
            SeedSyncAdminService service,
            CancellationToken cancellationToken)
        {
            ValidationResult validationResult = await validator.ValidateAsync(request, cancellationToken);
            if (!validationResult.IsValid)
            {
                return Results.BadRequest(validationResult.Errors);
            }

            Result<ApplyResponse> result = await service.ApplyAsync(request, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> LocalPreviewHandler(
            LocalRequest request,
            SeedSyncAdminService service,
            CancellationToken cancellationToken)
        {
            if (request.DeltaPreviewLimit < 0 || request.DeltaPreviewLimit > 500)
            {
                return Results.BadRequest("DeltaPreviewLimit must be between 0 and 500.");
            }

            Result<PreviewResponse> result = await service.PreviewLocalAsync(request, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> LocalApplyHandler(
            LocalRequest request,
            SeedSyncAdminService service,
            CancellationToken cancellationToken)
        {
            if (request.DeltaPreviewLimit < 0 || request.DeltaPreviewLimit > 500)
            {
                return Results.BadRequest("DeltaPreviewLimit must be between 0 and 500.");
            }

            Result<ApplyResponse> result = await service.ApplyLocalAsync(request, cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> HistoryHandler(
            int? take,
            int? changesPerRun,
            SeedSyncAdminService service,
            CancellationToken cancellationToken)
        {
            int resolvedTake = take ?? 5;
            int resolvedChangesPerRun = changesPerRun ?? 10;

            if (resolvedTake <= 0 || resolvedTake > 20)
            {
                return Results.BadRequest("take must be between 1 and 20.");
            }

            if (resolvedChangesPerRun < 0 || resolvedChangesPerRun > 100)
            {
                return Results.BadRequest("changesPerRun must be between 0 and 100.");
            }

            Result<HistoryResponse> result = await service.GetHistoryAsync(
                resolvedTake,
                resolvedChangesPerRun,
                cancellationToken);
            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<Request>, Validator>();
            services.AddScoped<SeedSyncAdminService>();
            services.AddScoped<LocalSeedLoader>();
        }
    }
}
