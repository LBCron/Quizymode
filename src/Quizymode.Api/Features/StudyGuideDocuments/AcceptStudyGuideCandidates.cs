using System.Text.Json;
using Quizymode.Api.Shared.Http;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>
/// POST /study-guides/documents/{id}/accept: save selected (optionally edited) generated questions as the owner's private
/// items (or public items when an admin sets Publish) through the standard bulk item-creation path, and add them to the document's collection. The first accept
/// creates the collection (link access on, not listed in Discover). Already-saved candidates are skipped.
/// </summary>
public static class AcceptStudyGuideCandidates
{
    public const int MaxCandidatesPerRequest = 200;
    public const int MaxCollectionNameLength = 200;
    public const int MaxCollectionDescriptionLength = 2000;
    public const int MaxExplanationLength = 4000;

    public sealed record CandidateEdit(
        Guid Id,
        string? Question,
        string? CorrectAnswer,
        List<string>? IncorrectAnswers,
        string? Explanation);

    public sealed record Request(List<CandidateEdit>? Candidates, string? CollectionName = null, bool Publish = false);

    public sealed record Response(
        string CollectionId,
        int CreatedCount,
        int DuplicateCount,
        int FailedCount,
        List<string> ItemIds);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            // The name is trimmed before use, so measure the trimmed value.
            RuleFor(x => x.CollectionName)
                .Must(name => name!.Trim().Length <= MaxCollectionNameLength)
                .WithMessage($"Collection name must not exceed {MaxCollectionNameLength} characters.")
                .When(x => x.CollectionName is not null && x.CollectionName.Trim().Length > 0);

            RuleFor(x => x.Candidates)
                .NotNull()
                .WithMessage("Select at least one question.")
                .Must(candidates => candidates is not null && candidates.Count is > 0 and <= MaxCandidatesPerRequest)
                .WithMessage($"Select between 1 and {MaxCandidatesPerRequest} questions.");

            RuleForEach(x => x.Candidates).ChildRules(candidate =>
            {
                candidate.RuleFor(c => c.Id).NotEmpty().WithMessage("Candidate id is required.");
                candidate.RuleFor(c => c.Question)
                    .NotEmpty().WithMessage("Question cannot be empty.")
                    .MaximumLength(1000).WithMessage("Question must not exceed 1000 characters.")
                    .When(c => c.Question is not null);
                candidate.RuleFor(c => c.CorrectAnswer)
                    .NotEmpty().WithMessage("Correct answer cannot be empty.")
                    .MaximumLength(500).WithMessage("Correct answer must not exceed 500 characters.")
                    .When(c => c.CorrectAnswer is not null);
                candidate.RuleFor(c => c.IncorrectAnswers)
                    .Must(answers => answers is not null && answers.Count is >= 1 and <= 4)
                    .WithMessage("Provide 1 to 4 incorrect answers.")
                    .When(c => c.IncorrectAnswers is not null);
                candidate.RuleForEach(c => c.IncorrectAnswers)
                    .NotEmpty().WithMessage("Incorrect answers cannot be empty.")
                    .MaximumLength(500).WithMessage("Each incorrect answer must not exceed 500 characters.");
                candidate.RuleFor(c => c.Explanation)
                    .MaximumLength(3500).WithMessage("Explanation must not exceed 3500 characters.")
                    .When(c => c.Explanation is not null);
            });
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("study-guides/documents/{id:guid}/accept", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Save selected generated questions as my private items (admins may publish them) and add them to the study guide's collection")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            Guid id,
            Request request,
            IValidator<Request> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            ISimHashService simHashService,
            ITaxonomyItemCategoryResolver itemCategoryResolver,
            ITaxonomyRegistry taxonomyRegistry,
            IAuditService auditService,
            ITextModerationService moderation,
            IOptions<StudyGuideDocumentOptions> documentOptions,
            TimeProvider timeProvider,
            ILogger<Endpoint> logger,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            if (request.Publish && !userContext.IsAdmin)
            {
                return CustomResults.Forbidden("Only admins can publish generated questions.");
            }

            FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return Results.BadRequest(validation.Errors);
            }

            Result<Response?> result = await HandleAsync(
                id,
                request,
                db,
                userContext,
                simHashService,
                itemCategoryResolver,
                taxonomyRegistry,
                auditService,
                moderation,
                documentOptions.Value.RetentionDays,
                timeProvider.GetUtcNow().UtcDateTime,
                cancellationToken,
                logger);

            return result.Match(
                value => value is null ? Results.NotFound() : Results.Ok(value),
                _ => StudyGuideDocumentResults.Problem(result));
        }
    }

    /// <summary>
    /// Runs the accept as one transaction (items, accepted rows, collection links and <c>document.CollectionId</c> commit together),
    /// serialised per document by a Postgres advisory lock so a manual accept and the auto-save sweep cannot race. The manual
    /// call waits for the lock. The auto-save call (<paramref name="autoSaveSectionIds"/> not null) skips the document with
    /// <see cref="StudyGuideDocumentErrors.Conflict"/> when the lock is busy, skips blocked or invalid candidates instead of
    /// failing the batch, and marks those sections' auto-save as Saved in the same commit.
    /// </summary>
    internal static async Task<Result<Response?>> HandleAsync(
        Guid id,
        Request request,
        ApplicationDbContext db,
        IUserContext userContext,
        ISimHashService simHashService,
        ITaxonomyItemCategoryResolver itemCategoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        IAuditService auditService,
        ITextModerationService moderation,
        int retentionDays,
        DateTime nowUtc,
        CancellationToken cancellationToken,
        ILogger? logger = null,
        IReadOnlyCollection<Guid>? autoSaveSectionIds = null)
    {
        IDbContextTransaction? ownTransaction = null;
        if (db.Database.IsRelational() && db.Database.CurrentTransaction is null)
        {
            try
            {
                ownTransaction = await db.Database.BeginTransactionAsync(cancellationToken);
            }
            catch (NotSupportedException)
            {
            }
        }

        await using IDbContextTransaction? transaction = ownTransaction;
        if (db.Database.IsNpgsql() && db.Database.CurrentTransaction is not null)
        {
            string lockKey = "study-guide-accept:" + id;
            if (autoSaveSectionIds is null)
            {
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock(hashtext({lockKey}))",
                    cancellationToken);
            }
            else
            {
                bool acquired = await db.Database
                    .SqlQuery<bool>($"SELECT pg_try_advisory_xact_lock(hashtext({lockKey})) AS \"Value\"")
                    .SingleAsync(cancellationToken);
                if (!acquired)
                {
                    return Result.Failure<Response?>(StudyGuideDocumentErrors.Conflict);
                }
            }
        }

        Result<Response?> result = await AcceptAsync(
            id,
            request,
            db,
            userContext,
            simHashService,
            itemCategoryResolver,
            taxonomyRegistry,
            auditService,
            moderation,
            retentionDays,
            nowUtc,
            cancellationToken,
            logger,
            autoSaveSectionIds);
        if (transaction is null)
        {
            return result;
        }

        if (result.IsFailure)
        {
            db.ChangeTracker.Clear();
            return result;
        }

        await transaction.CommitAsync(cancellationToken);
        return result;
    }

    private static async Task<Result<Response?>> AcceptAsync(
        Guid id,
        Request request,
        ApplicationDbContext db,
        IUserContext userContext,
        ISimHashService simHashService,
        ITaxonomyItemCategoryResolver itemCategoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        IAuditService auditService,
        ITextModerationService moderation,
        int retentionDays,
        DateTime nowUtc,
        CancellationToken cancellationToken,
        ILogger? logger,
        IReadOnlyCollection<Guid>? autoSaveSectionIds)
    {
        bool lenient = autoSaveSectionIds is not null;
        string userId = userContext.UserId!;
        bool publish = request.Publish && userContext.IsAdmin;
        StudyGuideDocument? document = await db.StudyGuideDocuments
            .FirstOrDefaultAsync(d => d.Id == id && d.UserId == userId, cancellationToken);
        if (document is null)
        {
            return Result.Success<Response?>(null);
        }

        string collectionName = document.Title;
        if (document.CollectionId is null && !string.IsNullOrWhiteSpace(request.CollectionName))
        {
            string requestedName = request.CollectionName.Trim();
            if (moderation.Evaluate(requestedName).Outcome == TextModerationOutcome.Blocked)
            {
                return Result.Failure<Response?>(Error.Validation(
                    StudyGuideDocumentErrors.ProfanityBlocked.Code,
                    "The collection name contains blocked language. Edit it and try again."));
            }

            collectionName = requestedName;
        }

        Dictionary<Guid, CandidateEdit> edits = (request.Candidates ?? [])
            .GroupBy(edit => edit.Id)
            .ToDictionary(group => group.Key, group => group.Last());
        List<Guid> candidateIds = edits.Keys.ToList();

        var sectionsByGeneration = (await db.StudyGuideSections
                .AsNoTracking()
                .Where(section => section.DocumentId == document.Id && section.GenerationId != null)
                .Select(section => new { GenerationId = section.GenerationId!.Value, section.Label, section.Index })
                .ToListAsync(cancellationToken))
            .GroupBy(section => section.GenerationId)
            .ToDictionary(group => group.Key, group => group.OrderBy(section => section.Index).Select(section => (section.Label, section.Index)).First());
        List<Guid> generationIds = sectionsByGeneration.Keys.ToList();

        List<GenerationCandidate> candidates = await db.GenerationCandidates
            .AsNoTracking()
            .Where(candidate => candidateIds.Contains(candidate.Id) && generationIds.Contains(candidate.GenerationId))
            .ToListAsync(cancellationToken);
        if (candidates.Count != candidateIds.Count)
        {
            return Result.Failure<Response?>(StudyGuideDocumentErrors.InvalidCandidates);
        }

        HashSet<Guid> alreadyAccepted = (await db.StudyGuideAcceptedCandidates
                .AsNoTracking()
                .Where(accepted => accepted.DocumentId == document.Id && candidateIds.Contains(accepted.CandidateId))
                .Select(accepted => accepted.CandidateId)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        int duplicateCount = alreadyAccepted.Count;
        List<(GenerationCandidate Candidate, AddItemsBulk.ItemRequest Item)> pending = [];
        HashSet<string> seenQuestions = new(StringComparer.OrdinalIgnoreCase);
        List<string> invalid = [];
        AddItemsBulk.ItemRequestValidator itemValidator = new();

        foreach (GenerationCandidate candidate in candidates.OrderBy(c => sectionsByGeneration[c.GenerationId].Index).ThenBy(c => c.Index))
        {
            if (alreadyAccepted.Contains(candidate.Id))
            {
                continue;
            }

            CandidateEdit edit = edits[candidate.Id];
            string question = (edit.Question ?? candidate.Question).Trim();
            string correctAnswer = (edit.CorrectAnswer ?? candidate.CorrectAnswer).Trim();
            List<string> incorrectAnswers = (edit.IncorrectAnswers ?? GetStudyGuideDocument.ReadAnswers(candidate.IncorrectAnswersJson))
                .Select(answer => answer.Trim())
                .ToList();
            string baseExplanation = (edit.Explanation ?? candidate.Explanation).Trim();

            List<string?> moderated = [question, correctAnswer, baseExplanation];
            moderated.AddRange(incorrectAnswers);
            if (moderation.Evaluate(moderated.ToArray()).Outcome == TextModerationOutcome.Blocked)
            {
                if (lenient)
                {
                    continue;
                }

                return Result.Failure<Response?>(Error.Validation(
                    StudyGuideDocumentErrors.ProfanityBlocked.Code,
                    "One or more questions contain blocked language. Edit them and try again."));
            }

            // Published items must not carry the private document title, so the "From <title>" suffix is omitted.
            string explanation = publish
                ? baseExplanation
                : BuildExplanation(baseExplanation, document.Title, sectionsByGeneration[candidate.GenerationId].Label);
            AddItemsBulk.ItemRequest item = new(
                question,
                correctAnswer,
                incorrectAnswers,
                explanation,
                IncorrectAnswerRationale: MapRationale(candidate, incorrectAnswers));
            FluentValidation.Results.ValidationResult itemValidation = itemValidator.Validate(item);
            if (!itemValidation.IsValid)
            {
                if (lenient)
                {
                    continue;
                }

                invalid.Add($"\"{Truncate(question, 60)}\": {itemValidation.Errors[0].ErrorMessage}");
                continue;
            }

            if (!seenQuestions.Add(question))
            {
                duplicateCount++;
                continue;
            }

            pending.Add((candidate, item));
        }

        if (invalid.Count > 0)
        {
            return Result.Failure<Response?>(Error.Validation(
                "StudyGuideDocument.InvalidEdit",
                string.Join(" ", invalid.Take(5))));
        }

        int createdCount = 0;
        int failedCount = 0;
        List<Guid> createdIds = [];
        if (pending.Count > 0)
        {
            List<AddItemsBulk.KeywordRequest> keywords = GetStudyGuideDocument.ReadKeywords(document)
                .Select(keyword => new AddItemsBulk.KeywordRequest(keyword, true))
                .ToList();
            AddItemsBulk.Request bulkRequest = new(
                IsPrivate: !publish,
                Category: document.CategoryName,
                Keyword1: document.NavigationKeyword1,
                Keyword2: document.NavigationKeyword2,
                Keywords: keywords,
                Items: pending.Select(entry => entry.Item).ToList(),
                UploadId: document.Id);

            Result<AddItemsBulk.Response> bulkResult = await AddItemsBulkHandler.HandleAsync(
                bulkRequest,
                db,
                simHashService,
                userContext,
                itemCategoryResolver,
                taxonomyRegistry,
                auditService,
                logger ?? NullLogger.Instance,
                cancellationToken);
            if (bulkResult.IsFailure)
            {
                return Result.Failure<Response?>(bulkResult.Error);
            }

            AddItemsBulk.Response bulk = bulkResult.Value;
            createdCount = bulk.CreatedCount;
            failedCount = bulk.FailedCount;
            duplicateCount += bulk.DuplicateCount;
            createdIds = bulk.CreatedItemIds ?? [];
        }

        Dictionary<string, Guid> createdByQuestion = createdIds.Count == 0
            ? []
            : (await db.Items
                    .AsNoTracking()
                    .Where(item => createdIds.Contains(item.Id))
                    .Select(item => new { item.Id, item.Question })
                    .ToListAsync(cancellationToken))
                .GroupBy(item => item.Question, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First().Id, StringComparer.Ordinal);

        foreach ((GenerationCandidate candidate, AddItemsBulk.ItemRequest item) in pending)
        {
            if (createdByQuestion.TryGetValue(item.Question, out Guid itemId))
            {
                db.StudyGuideAcceptedCandidates.Add(new StudyGuideAcceptedCandidate
                {
                    DocumentId = document.Id,
                    CandidateId = candidate.Id,
                    ItemId = itemId,
                    AcceptedUtc = nowUtc
                });
            }
        }

        if (lenient)
        {
            List<StudyGuideSection> toMark = await db.StudyGuideSections
                .Where(section => section.DocumentId == document.Id && autoSaveSectionIds!.Contains(section.Id))
                .ToListAsync(cancellationToken);
            foreach (StudyGuideSection section in toMark.Where(section => section.AutoSave == StudyGuideAutoSave.Pending))
            {
                section.AutoSave = StudyGuideAutoSave.Saved;
            }

            // Nothing was saved and there is no collection yet: do not create an empty one.
            if (createdIds.Count == 0 && document.CollectionId is null)
            {
                await db.SaveChangesAsync(cancellationToken);
                return Result.Success<Response?>(new Response(string.Empty, 0, duplicateCount, failedCount, []));
            }
        }

        Collection collection = await EnsureCollectionAsync(db, document, userId, collectionName, nowUtc, cancellationToken);
        HashSet<Guid> inCollection = (await db.CollectionItems
                .AsNoTracking()
                .Where(ci => ci.CollectionId == collection.Id && createdIds.Contains(ci.ItemId))
                .Select(ci => ci.ItemId)
                .ToListAsync(cancellationToken))
            .ToHashSet();
        foreach (Guid itemId in createdIds.Where(itemId => !inCollection.Contains(itemId)))
        {
            db.CollectionItems.Add(new CollectionItem
            {
                Id = Guid.NewGuid(),
                CollectionId = collection.Id,
                ItemId = itemId,
                AddedAt = nowUtc
            });
        }

        if (createdIds.Count > 0)
        {
            collection.UpdatedAt = nowUtc;
        }

        document.CollectionId = collection.Id;
        document.LastActivityUtc = nowUtc;
        document.ExpiresUtc = nowUtc.AddDays(Math.Max(1, retentionDays));
        await db.SaveChangesAsync(cancellationToken);

        return Result.Success<Response?>(new Response(
            collection.Id.ToString(),
            createdCount,
            duplicateCount,
            failedCount,
            createdIds.Select(itemId => itemId.ToString()).ToList()));
    }

    /// <summary>The document's collection if it still exists and is owned by the user; otherwise a new one.</summary>
    private static async Task<Collection> EnsureCollectionAsync(
        ApplicationDbContext db,
        StudyGuideDocument document,
        string userId,
        string collectionName,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        if (document.CollectionId is Guid collectionId)
        {
            Collection? existing = await db.Collections
                .FirstOrDefaultAsync(c => c.Id == collectionId && c.CreatedBy == userId, cancellationToken);
            if (existing is not null)
            {
                return existing;
            }
        }

        Collection collection = new()
        {
            Id = Guid.NewGuid(),
            IsRepoManaged = false,
            Name = Truncate(collectionName, MaxCollectionNameLength),
            Description = Truncate($"Generated from study guide {document.Title}", MaxCollectionDescriptionLength),
            CreatedBy = userId,
            CreatedAt = nowUtc,
            IsPublic = false,
            IsDiscoverable = false
        };
        db.Collections.Add(collection);
        return collection;
    }

    /// <summary>
    /// Carries generated "why wrong" text (#485) into the item by answer text, so an edited incorrect answer that no longer
    /// matches the generated text loses its rationale instead of attaching it to the wrong option.
    /// </summary>
    internal static Dictionary<int, string>? MapRationale(GenerationCandidate candidate, List<string> finalAnswers)
    {
        Dictionary<int, string> generated = string.IsNullOrEmpty(candidate.IncorrectAnswerRationaleJson)
            ? []
            : JsonSerializer.Deserialize<Dictionary<int, string>>(candidate.IncorrectAnswerRationaleJson) ?? [];
        if (generated.Count == 0)
        {
            return null;
        }

        List<string> generatedAnswers = GetStudyGuideDocument.ReadAnswers(candidate.IncorrectAnswersJson);
        Dictionary<int, string> mapped = [];
        foreach ((int generatedIndex, string text) in generated)
        {
            if (generatedIndex < 0 || generatedIndex >= generatedAnswers.Count)
            {
                continue;
            }

            int finalIndex = finalAnswers.FindIndex(answer => string.Equals(answer, generatedAnswers[generatedIndex], StringComparison.OrdinalIgnoreCase));
            if (finalIndex >= 0 && !string.IsNullOrWhiteSpace(text))
            {
                mapped[finalIndex] = text;
            }
        }

        return mapped.Count == 0 ? null : mapped;
    }

    internal static string BuildExplanation(string explanation, string title, string label)
    {
        string suffix = $"\n\nFrom \"{title}\", {label}";
        int room = MaxExplanationLength - suffix.Length;
        string body = explanation.Length <= room ? explanation : explanation[..Math.Max(0, room)].TrimEnd();
        return body.Length == 0 ? suffix.TrimStart('\n') : body + suffix;
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength].TrimEnd();
}
