using Quizymode.Api.Shared.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Http.Logging;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Extraction;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>
/// POST /study-guides/documents (multipart/form-data): upload a PDF, DOCX, PPTX, or text/Markdown file, or paste text,
/// with a topic. The text is extracted and split into sections; the original file is not stored. Re-uploading the same
/// normalized text returns the existing document (200, <c>isDuplicate = true</c>).
/// </summary>
public static class CreateStudyGuideDocument
{
    public const string RateLimitPolicy = "study-guide-documents";

    public const int MaxKeywords = 10;

    public const int MaxTitleLength = 200;

    public sealed record Request(
        string? Text,
        string? Title,
        string? Category,
        string? NavigationKeyword1,
        string? NavigationKeyword2,
        List<string>? Keywords);

    internal sealed record UploadedFile(byte[] Content, string? FileName);

    internal sealed record Outcome(StudyGuideDocumentContracts.Document Document, bool Created);

    internal sealed class Validator : AbstractValidator<Request>
    {
        public Validator(IOptions<StudyGuideDocumentOptions> options)
        {
            int maxTextBytes = options.Value.MaxTextBytes;

            RuleFor(x => x.Text)
                .Must(text => text is null || Encoding.UTF8.GetByteCount(text) <= maxTextBytes)
                .WithMessage($"Study guide text must not exceed {maxTextBytes / 1024} KB.");

            RuleFor(x => x.Title)
                .MaximumLength(MaxTitleLength)
                .WithMessage($"Title must not exceed {MaxTitleLength} characters.");

            RuleFor(x => x.Category)
                .NotEmpty()
                .WithMessage("Category is required.")
                .MaximumLength(100)
                .WithMessage("Category must not exceed 100 characters.");

            RuleFor(x => x.NavigationKeyword1)
                .NotEmpty()
                .WithMessage("Primary topic is required.")
                .MaximumLength(30)
                .WithMessage("Primary topic must not exceed 30 characters.");

            RuleFor(x => x.NavigationKeyword2)
                .NotEmpty()
                .WithMessage("Subtopic is required.")
                .MaximumLength(30)
                .WithMessage("Subtopic must not exceed 30 characters.");

            RuleFor(x => x.Keywords)
                .Must(keywords => keywords is null || keywords.Count <= MaxKeywords)
                .WithMessage($"Cannot add more than {MaxKeywords} keywords.");

            RuleForEach(x => x.Keywords)
                .Must(keyword => KeywordHelper.IsValidKeywordNameFormat(KeywordHelper.NormalizeKeywordName(keyword ?? string.Empty)))
                .WithMessage("Keywords may contain only letters, numbers, and hyphens (max 30 characters).");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("study-guides/documents", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Upload a study guide file or pasted text and split it into sections")
                .WithDescription("multipart/form-data with either file (PDF, DOCX, PPTX, TXT, MD; at most 20 MB) or text, plus " +
                    "category, navigationKeyword1, navigationKeyword2, optional title and keywords (repeated or comma-separated). " +
                    "Returns 201 with the document, or 200 with isDuplicate=true when this user already uploaded the same text.")
                .RequireAuthorization()
                .RequireRateLimiting(RateLimitPolicy)
                .DisableAntiforgery()
                .WithMetadata(new RequestSizeLimitAttribute(new StudyGuideDocumentOptions().MaxFileBytes + 1024 * 1024))
                .Produces<StudyGuideDocumentContracts.Document>(StatusCodes.Status201Created)
                .Produces<StudyGuideDocumentContracts.Document>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status413PayloadTooLarge)
                .Produces(StatusCodes.Status429TooManyRequests);
        }

        private static async Task<IResult> Handler(
            IFormFile? file,
            [FromForm] string? text,
            [FromForm] string? title,
            [FromForm] string? category,
            [FromForm] string? navigationKeyword1,
            [FromForm] string? navigationKeyword2,
            [FromForm] string? keywords,
            HttpRequest httpRequest,
            IValidator<Request> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            ITextModerationService moderation,
            ITaxonomyItemCategoryResolver categoryResolver,
            ITaxonomyRegistry taxonomyRegistry,
            IStudyGuideTextExtractor extractor,
            IOptions<StudyGuideDocumentOptions> documentOptions,
            IOptions<StudyGuideGenerationOptions> generationOptions,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            StudyGuideDocumentForm.Parsed form = await StudyGuideDocumentForm.ReadAsync(
                file,
                text,
                title,
                category,
                navigationKeyword1,
                navigationKeyword2,
                keywords,
                httpRequest,
                validator,
                documentOptions.Value,
                cancellationToken);
            if (form.Rejection is not null)
            {
                return form.Rejection;
            }

            Result<Outcome> result = await HandleAsync(
                form.Request!,
                form.Upload,
                db,
                userContext.UserId,
                moderation,
                categoryResolver,
                taxonomyRegistry,
                extractor,
                documentOptions.Value,
                generationOptions.Value,
                timeProvider.GetUtcNow().UtcDateTime,
                cancellationToken);

            return result.Match(
                value => value.Created
                    ? Results.Created($"/study-guides/documents/{value.Document.Id}", value.Document)
                    : Results.Ok(value.Document),
                _ => StudyGuideDocumentResults.Problem(result));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddOptions<StudyGuideDocumentOptions>().Bind(configuration.GetSection(StudyGuideDocumentOptions.SectionName));
            services.AddOptions<StudyGuideGenerationOptions>().Bind(configuration.GetSection(StudyGuideGenerationOptions.SectionName));
            services.TryAddSingleton(TimeProvider.System);
            services.AddSingleton<ILlmVendorRegistry>(_ => new LlmVendorRegistry(configuration));
            services.AddSingleton<LlmVendorCooldowns>();
            services.AddSingleton<IStudyGuideTextExtractor, StudyGuideTextExtractor>();
#pragma warning disable EXTEXP0001 // RemoveAllResilienceHandlers is marked experimental; it is the supported opt-out from ServiceDefaults.
            services.AddHttpClient<IOpenAiCompatibleChatClient, OpenAiCompatibleChatClient>((provider, client) =>
                {
                    StudyGuideGenerationOptions options = provider.GetRequiredService<IOptions<StudyGuideGenerationOptions>>().Value;
                    client.Timeout = TimeSpan.FromSeconds(Math.Clamp(options.VendorTimeoutSeconds, 10, 600));
                })
                // LLM calls run far longer than the default resilience pipeline allows (10 s per attempt, 30 s total, 3 retries),
                // and retries can repeat billable requests. Rely on HttpClient.Timeout and the app's own vendor fallback (#206).
                .RemoveAllResilienceHandlers()
                .RedactLoggedHeaders(["Authorization"]);
#pragma warning restore EXTEXP0001
            services.AddScoped<StudyGuideGenerationQueue>();
            services.AddScoped<SectionGenerationProcessor>();
            services.AddScoped<StudyGuideAutoSaver>();
            services.AddHostedService<StudyGuideGenerationWorker>();
            services.AddScoped<IValidator<Request>, Validator>();
            services.AddScoped<IValidator<GenerateStudyGuideSections.Request>, GenerateStudyGuideSections.Validator>();
            services.AddScoped<IValidator<AcceptStudyGuideCandidates.Request>, AcceptStudyGuideCandidates.Validator>();
            services.AddScoped<IValidator<SetStudyGuideDocumentPrimarySource.Request>, SetStudyGuideDocumentPrimarySource.Validator>();
        }
    }

    internal static async Task<Result<Outcome>> HandleAsync(
        Request request,
        UploadedFile? file,
        ApplicationDbContext db,
        string userId,
        ITextModerationService moderation,
        ITaxonomyItemCategoryResolver categoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        IStudyGuideTextExtractor extractor,
        StudyGuideDocumentOptions documentOptions,
        StudyGuideGenerationOptions generationOptions,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        bool hasText = !string.IsNullOrWhiteSpace(request.Text);
        if (hasText == (file is not null))
        {
            return Result.Failure<Outcome>(StudyGuideDocumentErrors.FileOrTextRequired);
        }

        Result<StudyGuideTopic> topicResult = await StudyGuideTopic.ResolveAsync(
            request.Category ?? string.Empty,
            request.NavigationKeyword1 ?? string.Empty,
            request.NavigationKeyword2 ?? string.Empty,
            request.Keywords,
            categoryResolver,
            taxonomyRegistry,
            cancellationToken);
        if (topicResult.IsFailure)
        {
            return Result.Failure<Outcome>(topicResult.Error);
        }

        StudyGuideTopic topic = topicResult.Value;

        Result<ExtractedDocument> extracted = file is not null
            ? await extractor.ExtractAsync(file.Content, cancellationToken)
            : extractor.FromText(request.Text!);
        if (extracted.IsFailure)
        {
            return Result.Failure<Outcome>(extracted.Error);
        }

        ExtractedDocument document = extracted.Value;
        string fullText = document.FullText;
        string title = BuildTitle(request.Title, file?.FileName, fullText);

        List<string?> moderated = [title, fullText];
        moderated.AddRange(topic.Keywords);
        if (moderation.Evaluate(moderated.ToArray()).Outcome == TextModerationOutcome.Blocked)
        {
            return Result.Failure<Outcome>(StudyGuideDocumentErrors.ProfanityBlocked);
        }

        List<SectionDraft> drafts = StudyGuideSectioner.Build(document, documentOptions.SectionTargetBytes, documentOptions.SectionMaxBytes);
        if (drafts.Count == 0)
        {
            return Result.Failure<Outcome>(StudyGuideDocumentErrors.Empty);
        }

        string textHash = StudyGuideTextHash.ComputeHash(fullText);
        DateTime expiresUtc = nowUtc.AddDays(Math.Max(1, documentOptions.RetentionDays));

        StudyGuideDocument? existing = await db.StudyGuideDocuments
            .FirstOrDefaultAsync(d => d.UserId == userId && d.TextSha256 == textHash, cancellationToken);
        if (existing is not null)
        {
            await RefreshDuplicateAsync(db, existing, drafts, nowUtc, expiresUtc, cancellationToken);
            return Result.Success(new Outcome(await BuildResponseAsync(db, existing, userId, generationOptions, nowUtc, true, cancellationToken), false));
        }

        StudyGuideDocument entity = new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = title,
            FileType = document.FileType,
            FileSha256 = Convert.ToHexString(SHA256.HashData(file?.Content ?? Encoding.UTF8.GetBytes(request.Text!))).ToLowerInvariant(),
            TextSha256 = textHash,
            PageCount = document.PageCount,
            CategoryName = topic.CategoryName,
            NavigationKeyword1 = topic.NavigationKeyword1,
            NavigationKeyword2 = topic.NavigationKeyword2,
            KeywordsJson = topic.Keywords.Count > 0 ? JsonSerializer.Serialize(topic.Keywords) : null,
            CreatedUtc = nowUtc,
            LastActivityUtc = nowUtc,
            ExpiresUtc = expiresUtc,
            Sections = drafts
                .Select(draft => new StudyGuideSection
                {
                    Id = Guid.NewGuid(),
                    Index = draft.Index,
                    Label = draft.Label,
                    PageStart = draft.PageStart,
                    PageEnd = draft.PageEnd,
                    Text = draft.Text,
                    TextSha256 = draft.TextSha256,
                    SizeBytes = draft.SizeBytes
                })
                .ToList()
        };

        db.StudyGuideDocuments.Add(entity);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Concurrent upload of the same text by the same user: the unique (UserId, TextSha256) index won the race.
            db.ChangeTracker.Clear();
            StudyGuideDocument? raced = await db.StudyGuideDocuments
                .FirstOrDefaultAsync(d => d.UserId == userId && d.TextSha256 == textHash, cancellationToken);
            if (raced is null)
            {
                throw;
            }

            return Result.Success(new Outcome(await BuildResponseAsync(db, raced, userId, generationOptions, nowUtc, true, cancellationToken), false));
        }

        return Result.Success(new Outcome(await BuildResponseAsync(db, entity, userId, generationOptions, nowUtc, false, cancellationToken), true));
    }

    private static async Task RefreshDuplicateAsync(
        ApplicationDbContext db,
        StudyGuideDocument existing,
        List<SectionDraft> drafts,
        DateTime nowUtc,
        DateTime expiresUtc,
        CancellationToken cancellationToken)
    {
        existing.LastActivityUtc = nowUtc;
        existing.ExpiresUtc = expiresUtc;

        // Restore expired section text when the re-uploaded text sections identically.
        Dictionary<int, SectionDraft> byIndex = drafts.ToDictionary(draft => draft.Index);
        List<StudyGuideSection> expired = await db.StudyGuideSections
            .Where(section => section.DocumentId == existing.Id && section.Text == null)
            .ToListAsync(cancellationToken);
        foreach (StudyGuideSection section in expired)
        {
            if (byIndex.TryGetValue(section.Index, out SectionDraft? draft) && draft.TextSha256 == section.TextSha256)
            {
                section.Text = draft.Text;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static async Task<StudyGuideDocumentContracts.Document> BuildResponseAsync(
        ApplicationDbContext db,
        StudyGuideDocument document,
        string userId,
        StudyGuideGenerationOptions options,
        DateTime nowUtc,
        bool isDuplicate,
        CancellationToken cancellationToken)
    {
        StudyGuideQuotaSnapshot quota = await StudyGuideQuota.GetAsync(db, userId, options, nowUtc, cancellationToken);
        return await GetStudyGuideDocument.BuildAsync(db, document, quota, isDuplicate, cancellationToken);
    }

    internal static string BuildTitle(string? requestedTitle, string? fileName, string text)
    {
        string? candidate = requestedTitle?.Trim();
        if (string.IsNullOrEmpty(candidate) && !string.IsNullOrWhiteSpace(fileName))
        {
            candidate = Path.GetFileNameWithoutExtension(Path.GetFileName(fileName.Replace('\\', '/'))).Trim();
        }

        if (string.IsNullOrEmpty(candidate))
        {
            candidate = text.Split('\n')
                .Select(line => line.Trim().TrimStart('#').Trim())
                .FirstOrDefault(line => line.Length > 0);
        }

        if (string.IsNullOrEmpty(candidate))
        {
            candidate = "Study guide";
        }

        return candidate.Length <= MaxTitleLength ? candidate : candidate[..MaxTitleLength].TrimEnd();
    }
}

/// <summary>A validated taxonomy topic plus normalized extra keywords, shared by the study guide document endpoints.</summary>
internal sealed record StudyGuideTopic(string CategoryName, string NavigationKeyword1, string NavigationKeyword2, List<string> Keywords)
{
    /// <summary>AC 6.6.2: the category resolves, (nav1, nav2) is a valid taxonomy path, keywords are normalized and deduplicated.</summary>
    public static async Task<Result<StudyGuideTopic>> ResolveAsync(
        string category,
        string navigationKeyword1,
        string navigationKeyword2,
        IEnumerable<string>? keywords,
        ITaxonomyItemCategoryResolver categoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        CancellationToken cancellationToken)
    {
        Result<Category> categoryResult = await categoryResolver.ResolveForItemAsync(category, cancellationToken);
        if (categoryResult.IsFailure)
        {
            return Result.Failure<StudyGuideTopic>(Error.Validation("StudyGuideDocument.InvalidCategory", categoryResult.Error.Description));
        }

        string categoryName = categoryResult.Value.Name;
        string nav1 = KeywordHelper.NormalizeKeywordName(navigationKeyword1).ToLowerInvariant();
        string nav2 = KeywordHelper.NormalizeKeywordName(navigationKeyword2).ToLowerInvariant();
        if (!taxonomyRegistry.IsValidNavigationPath(categoryName, nav1, nav2))
        {
            return Result.Failure<StudyGuideTopic>(Error.Validation(
                "StudyGuideDocument.InvalidNavigationPath",
                $"'{nav1}' / '{nav2}' is not a valid topic path for category '{categoryName}'."));
        }

        List<string> normalized = (keywords ?? [])
            .Select(keyword => KeywordHelper.NormalizeKeywordName(keyword).ToLowerInvariant())
            .Where(keyword => keyword.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(keyword =>
                !string.Equals(keyword, nav1, StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(keyword, nav2, StringComparison.OrdinalIgnoreCase))
            .ToList();

        return Result.Success(new StudyGuideTopic(categoryName, nav1, nav2, normalized));
    }
}
