using Quizymode.Api.Shared.Http;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Extraction;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>
/// POST /study-guides/documents/quick (multipart/form-data, same fields as create): the "Make a quiz" path (#363). Creates the
/// document exactly like create, then, when at most <c>QuickPathMaxSections</c> sections still have nothing saved, queues their
/// generation through <see cref="GenerateStudyGuideSections"/> (the single owner of quota, budget and caching) flagged to
/// auto-save. The server saves the questions privately when generation finishes (<see cref="StudyGuideAutoSaver"/>), so closing
/// the tab loses nothing. Outcome: Generating | Ready | NeedsChoice | OverAllowance | Unavailable. Everything after the document
/// exists is a 2xx so the client can open the document page with one explanatory line.
/// </summary>
public static class QuickStudyGuideDocument
{
    public const string Generating = "Generating";
    public const string Ready = "Ready";
    public const string NeedsChoice = "NeedsChoice";
    public const string OverAllowance = "OverAllowance";
    public const string Unavailable = "Unavailable";

    private const string NoQuestionsMessage =
        "We couldn't make any questions from these notes. Try a longer or more detailed section.";

    public sealed record Response(
        StudyGuideDocumentContracts.Document Document,
        string Outcome,
        string Message,
        int QueuedCount,
        int CachedCount,
        int ChargedSections,
        string? CollectionName);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("study-guides/documents/quick", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Make a quiz: upload or paste notes, generate and save the questions privately")
                .WithDescription("multipart/form-data identical to POST /study-guides/documents. Returns 201 (or 200 with document.isDuplicate=true) " +
                    "with outcome Generating (questions save automatically when generation finishes), Ready (already saved; open Learn), " +
                    "NeedsChoice (too many sections or nothing to make; pick sections on the document page), OverAllowance (not enough daily or " +
                    "monthly sections left; nothing was charged) or Unavailable (generation is paused or unavailable; nothing was charged). " +
                    "message is the one short line to show. 503 StudyGuideDocument.Disabled before anything is created when no vendor in the caller's tier route has an API key.")
                .RequireAuthorization()
                .RequireRateLimiting(CreateStudyGuideDocument.RateLimitPolicy)
                .DisableAntiforgery()
                .WithMetadata(new RequestSizeLimitAttribute(new StudyGuideDocumentOptions().MaxFileBytes + 1024 * 1024))
                .Produces<Response>(StatusCodes.Status201Created)
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status413PayloadTooLarge)
                .Produces(StatusCodes.Status429TooManyRequests)
                .Produces(StatusCodes.Status503ServiceUnavailable);
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
            IValidator<CreateStudyGuideDocument.Request> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            ITextModerationService moderation,
            ITaxonomyItemCategoryResolver categoryResolver,
            ITaxonomyRegistry taxonomyRegistry,
            IStudyGuideTextExtractor extractor,
            ILlmVendorRegistry vendors,
            StudyGuideAutoSaver autoSaver,
            IOptions<StudyGuideDocumentOptions> documentOptions,
            IOptions<StudyGuideGenerationOptions> generationOptions,
            TimeProvider timeProvider,
            ILogger<Endpoint> logger,
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

            // Before anything is created, like generate's own check: a disabled route never leaves a half-made document.
            StudyGuideTier tier = await StudyGuideQuota.GetTierAsync(db, userContext.UserId, cancellationToken);
            if (!await LlmProviderSettingsStore.IsTierRouteAvailableAsync(db, vendors, tier, cancellationToken))
            {
                return StudyGuideDocumentResults.Problem(Result.Failure(StudyGuideDocumentErrors.Disabled));
            }

            DateTime nowUtc = timeProvider.GetUtcNow().UtcDateTime;
            Result<CreateStudyGuideDocument.Outcome> created = await CreateStudyGuideDocument.HandleAsync(
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
                nowUtc,
                cancellationToken);
            if (created.IsFailure)
            {
                return StudyGuideDocumentResults.Problem(created);
            }

            Response response = await RunAsync(
                created.Value.Document,
                db,
                userContext.UserId,
                vendors,
                autoSaver,
                generationOptions.Value,
                documentOptions.Value.RetentionDays,
                nowUtc,
                logger,
                cancellationToken);

            return created.Value.Created
                ? Results.Created($"/study-guides/documents/{response.Document.Id}", response)
                : Results.Ok(response);
        }
    }

    /// <summary>Decides and starts the quick path for an existing document; never fails once the document exists.</summary>
    internal static async Task<Response> RunAsync(
        StudyGuideDocumentContracts.Document document,
        ApplicationDbContext db,
        string userId,
        ILlmVendorRegistry vendors,
        StudyGuideAutoSaver autoSaver,
        StudyGuideGenerationOptions options,
        int retentionDays,
        DateTime nowUtc,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        int cap = Math.Max(1, options.QuickPathMaxSections);

        // D8: only sections with nothing saved yet and not already auto-saved.
        List<StudyGuideDocumentContracts.Section> targets = document.Sections
            .Where(section => section.AutoSave != nameof(StudyGuideAutoSave.Saved) && !section.Candidates.Any(candidate => candidate.Accepted))
            .ToList();

        Response result;
        if (targets.Count == 0)
        {
            result = document.CollectionId is not null && document.Sections.Any(section => section.Candidates.Any(candidate => candidate.Accepted))
                ? await FinishAsync(document, db, options, nowUtc, 0, 0, 0, cancellationToken)
                : new Response(document, NeedsChoice, NoQuestionsMessage, 0, 0, 0, null);
        }
        else if (targets.Count > cap)
        {
            result = new Response(
                document,
                NeedsChoice,
                $"This has {targets.Count} sections. A quick quiz covers up to {cap}, so pick the ones you want below.",
                0,
                0,
                0,
                null);
        }
        else
        {
            result = await GenerateAsync(document, targets, db, userId, vendors, autoSaver, options, retentionDays, nowUtc, cancellationToken);
        }

        logger.LogInformation(
            "StudyGuideQuick: document {DocumentId} outcome {Outcome}, charged {Charged}, cached {Cached}, queued {Queued}.",
            document.Id,
            result.Outcome,
            result.ChargedSections,
            result.CachedCount,
            result.QueuedCount);
        return result;
    }

    private static async Task<Response> GenerateAsync(
        StudyGuideDocumentContracts.Document document,
        List<StudyGuideDocumentContracts.Section> targets,
        ApplicationDbContext db,
        string userId,
        ILlmVendorRegistry vendors,
        StudyGuideAutoSaver autoSaver,
        StudyGuideGenerationOptions options,
        int retentionDays,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        Guid documentId = Guid.Parse(document.Id);
        GenerateStudyGuideSections.Request request = new(targets.Select(section => Guid.Parse(section.Id)).ToList());

        Result<GenerateStudyGuideSections.Response?> generated = await GenerateStudyGuideSections.HandleAsync(
            documentId, request, db, userId, vendors, options, retentionDays, nowUtc, cancellationToken, autoSave: true, quickPath: true);
        if (generated.IsFailure && generated.Error.Code == StudyGuideDocumentErrors.Conflict.Code)
        {
            generated = await GenerateStudyGuideSections.HandleAsync(
                documentId, request, db, userId, vendors, options, retentionDays, nowUtc, cancellationToken, autoSave: true, quickPath: true);
        }

        if (generated.IsFailure)
        {
            string outcome = generated.Error.Code == StudyGuideDocumentErrors.QuotaExceededCode
                ? OverAllowance
                : generated.Error.Code == StudyGuideDocumentErrors.SectionExpired.Code
                    ? NeedsChoice
                    : Unavailable;
            string message = generated.Error.Code == StudyGuideDocumentErrors.Conflict.Code
                ? "We couldn't start your quiz just now. Please try again."
                : generated.Error.Description;
            return new Response(document, outcome, message, 0, 0, 0, null);
        }

        GenerateStudyGuideSections.Response value = generated.Value
            ?? new GenerateStudyGuideSections.Response(0, 0, 0, document.Quota);

        // Everything was already generated (cached): save now so Learn can open straight away. A failure here is not an
        // error; the worker sweep retries and the client simply waits on the document page.
        if (value.QueuedCount == 0)
        {
            await autoSaver.SaveDocumentAsync(documentId, cancellationToken);
        }

        return await FinishAsync(document, db, options, nowUtc, value.QueuedCount, value.CachedCount, value.ChargedSections, cancellationToken);
    }

    /// <summary>Rebuilds the document and derives Ready / Generating / NeedsChoice from what is saved or still pending.</summary>
    private static async Task<Response> FinishAsync(
        StudyGuideDocumentContracts.Document before,
        ApplicationDbContext db,
        StudyGuideGenerationOptions options,
        DateTime nowUtc,
        int queued,
        int cached,
        int charged,
        CancellationToken cancellationToken)
    {
        Guid documentId = Guid.Parse(before.Id);
        db.ChangeTracker.Clear();
        StudyGuideDocument entity = await db.StudyGuideDocuments.AsNoTracking().FirstAsync(d => d.Id == documentId, cancellationToken);
        StudyGuideQuotaSnapshot quota = await StudyGuideQuota.GetAsync(db, entity.UserId, options, nowUtc, cancellationToken);
        StudyGuideDocumentContracts.Document document = await GetStudyGuideDocument.BuildAsync(db, entity, quota, before.IsDuplicate, cancellationToken);

        bool anySaved = document.Sections.Any(section => section.Candidates.Any(candidate => candidate.Accepted));
        bool anyPending = document.Sections.Any(section => section.AutoSave == nameof(StudyGuideAutoSave.Pending));
        string? collectionName = null;
        if (anySaved && entity.CollectionId is Guid collectionId)
        {
            collectionName = await db.Collections
                .AsNoTracking()
                .Where(collection => collection.Id == collectionId)
                .Select(collection => collection.Name)
                .FirstOrDefaultAsync(cancellationToken);
        }

        if (anyPending)
        {
            return new Response(document, Generating, "Making your quiz. Questions save automatically when they're ready.", queued, cached, charged, collectionName);
        }

        return anySaved && collectionName is not null
            ? new Response(document, Ready, "Your quiz is ready.", queued, cached, charged, collectionName)
            : new Response(document, NeedsChoice, NoQuestionsMessage, queued, cached, charged, null);
    }
}
