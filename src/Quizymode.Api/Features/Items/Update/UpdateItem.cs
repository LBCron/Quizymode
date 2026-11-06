using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Update;

public static class UpdateItem
{
    public sealed record KeywordRequest(
        string Name,
        bool IsPrivate);

    public sealed record Request(
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string Explanation,
        bool IsPrivate,
        List<KeywordRequest>? Keywords = null,
        bool? ReadyForReview = null,
        string? Source = null,
        ItemSpeechSupport? QuestionSpeech = null,
        ItemSpeechSupport? CorrectAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? IncorrectAnswerSpeech = null,
        string? GroupLabel = null,
        ImageSlotInput? QuestionImage = null,
        ImageSlotInput? ExplanationImage = null,
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
            this.AddImageSlotRules(x => x.QuestionImage, "QuestionImage", allowRemove: true);
            this.AddImageSlotRules(x => x.ExplanationImage, "ExplanationImage", allowRemove: true);
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
            app.MapPut("items/{id}", Handler)
                .WithTags("Items")
                .WithSummary("Update an existing quiz item")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status409Conflict);
        }

        private static async Task<IResult> Handler(
            string id,
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

            Result<Response> result = await HandleAsync(
                id,
                request,
                db,
                simHashService,
                userContext,
                auditService,
                itemCategoryResolver,
                taxonomyRegistry,
                cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error.Code == ItemWriteAccess.ForbiddenCode
                    ? ItemWriteAccess.ForbiddenResult()
                    : failure.Error.Type == ErrorType.NotFound
                        ? Results.NotFound()
                        : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        string id,
        Request request,
        ApplicationDbContext db,
        ISimHashService simHashService,
        IUserContext userContext,
        IAuditService auditService,
        ITaxonomyItemCategoryResolver itemCategoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        CancellationToken cancellationToken)
    {
        IDbContextTransaction? transaction = null;
        try
        {
            if (!Guid.TryParse(id, out Guid itemId))
            {
                return Result.Failure<Response>(
                    Error.Validation("Item.InvalidId", "Invalid item ID format"));
            }

            Item? item = await db.Items
                .FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);

            if (item is null)
            {
                return Result.Failure<Response>(
                    Error.NotFound("Item.NotFound", $"Item with id {id} not found"));
            }

            Error? accessError = ItemWriteAccess.Check(item, userContext, id);
            if (accessError is not null)
            {
                return Result.Failure<Response>(accessError);
            }

            // Omitted pictures are kept by PUT; an explanation picture needs explanation text to illustrate (#403). Removing it needs none.
            if (item.ExplanationImageKey is not null
                && request.ExplanationImage?.Remove != true
                && string.IsNullOrWhiteSpace(request.Explanation))
            {
                return Result.Failure<Response>(
                    Error.Validation("Item.ExplanationRequiredForImage", ItemImageReferenceHelper.ExplanationRequiredForUpdateMessage));
            }

            string questionText = ItemSimHashInput.Normalize(request.Question);
            string fuzzySignature = simHashService.ComputeSimHash(questionText);
            int fuzzyBucket = simHashService.GetFuzzyBucket(fuzzySignature);

            bool effectiveIsPrivate = userContext.IsAdmin ? request.IsPrivate : true;

            string userId = userContext.UserId ?? throw new InvalidOperationException("User ID is required for item update");

            Result<Category> categoryResult = await itemCategoryResolver.ResolveForItemAsync(
                request.Category,
                cancellationToken);

            if (categoryResult.IsFailure)
            {
                return Result.Failure<Response>(categoryResult.Error!);
            }

            Category category = categoryResult.Value!;

            string nav1Norm = KeywordHelper.NormalizeKeywordName(request.NavigationKeyword1);
            string nav2Norm = KeywordHelper.NormalizeKeywordName(request.NavigationKeyword2);

            if (request.Keywords is not null)
            {
                foreach (KeywordRequest kw in request.Keywords)
                {
                    if (string.IsNullOrWhiteSpace(kw.Name))
                        continue;
                    string n = KeywordHelper.NormalizeKeywordName(kw.Name);
                    if (string.IsNullOrEmpty(n))
                        continue;
                    if (!KeywordHelper.IsValidKeywordNameFormat(n))
                    {
                        return Result.Failure<Response>(
                            Error.Validation("Item.InvalidKeyword", $"Keyword '{n}' is invalid. Use only letters, numbers, and hyphens (max 30 characters)."));
                    }

                    if (string.Equals(n, nav1Norm, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(n, nav2Norm, StringComparison.OrdinalIgnoreCase))
                        continue;
                }
            }

            Result<(Keyword Nav1, Keyword Nav2)> navResult = await ItemNavigationAndKeywordsHelper.ResolvePublicNavigationAsync(
                db,
                taxonomyRegistry,
                category,
                request.NavigationKeyword1,
                request.NavigationKeyword2,
                cancellationToken);

            if (navResult.IsFailure)
                return Result.Failure<Response>(navResult.Error!);

            (Keyword navK1, Keyword navK2) = navResult.Value!;

            // Uploaded pictures (#400): seed-managed items and curated slots take no picture input.
            if ((request.QuestionImage is not null || request.ExplanationImage is not null)
                && (item.IsRepoManaged
                    || (request.QuestionImage is not null && ItemImageSubmission.IsCurated(item.QuestionImageKey, item.QuestionImageAssetId))
                    || (request.ExplanationImage is not null && ItemImageSubmission.IsCurated(item.ExplanationImageKey, item.ExplanationImageAssetId))))
            {
                return Result.Failure<Response>(ItemImageReviewRules.ManagedBySeed());
            }

            // Assets must belong to the item's creator, so an admin can keep, remove or re-describe a picture but not attach their own upload.
            (PictureSlot? questionPicture, Error? questionPictureError) = await ItemImageSubmission.ResolveSlotAsync(
                db, item.CreatedBy, item.QuestionImageAssetId, item.QuestionImageAlt, item.QuestionImageAttribution,
                request.QuestionImage, cancellationToken);
            if (questionPictureError is not null)
            {
                return Result.Failure<Response>(questionPictureError);
            }

            (PictureSlot? explanationPicture, Error? explanationPictureError) = await ItemImageSubmission.ResolveSlotAsync(
                db, item.CreatedBy, item.ExplanationImageAssetId, item.ExplanationImageAlt, item.ExplanationImageAttribution,
                request.ExplanationImage, cancellationToken);
            if (explanationPictureError is not null)
            {
                return Result.Failure<Response>(explanationPictureError);
            }

            // Include all creator/category peers: older edits may have answer-derived buckets.
            var candidateItems = await (
                from existing in db.Items
                where existing.Id != itemId && existing.CreatedBy == item.CreatedBy && existing.CategoryId == category.Id
                join asset in db.MediaAssets on existing.QuestionImageAssetId equals asset.Id into assets
                from asset in assets.DefaultIfEmpty()
                select new
                {
                    existing.Question,
                    existing.FuzzySignature,
                    existing.QuestionImageKey,
                    existing.QuestionImageAssetId,
                    AssetSha256 = asset == null ? null : asset.Sha256
                }).ToListAsync(cancellationToken);

            string? newImageIdentity = questionPicture is not null
                ? ItemImageReviewRules.DuplicateIdentity(null, questionPicture.AssetId, questionPicture.Sha256)
                : ItemImageSubmission.IsCurated(item.QuestionImageKey, item.QuestionImageAssetId) ? item.QuestionImageKey : null;
            if (candidateItems.Any(existing => ItemDuplicateRules.IsDuplicate(
                existing.Question, existing.FuzzySignature,
                ItemImageReviewRules.DuplicateIdentity(existing.QuestionImageKey, existing.QuestionImageAssetId, existing.AssetSha256),
                request.Question, fuzzySignature, newImageIdentity)))
            {
                return Result.Failure<Response>(ItemDuplicateRules.Duplicate(category.Name));
            }

            ItemSpeechSupport? questionSpeech = ItemSpeechSupportHelper.Normalize(request.QuestionSpeech, 1000);
            bool hasUpload = questionPicture is not null || explanationPicture is not null;
            string? contentHash = hasUpload
                ? ItemImageReviewRules.ComputeContentHash(
                    request.Question, request.CorrectAnswer, request.IncorrectAnswers, request.Explanation,
                    questionSpeech, questionPicture, explanationPicture)
                : null;
            string? storedHash = hasUpload && item.ImageReviewState is not null
                ? await db.ItemImageReviews.AsNoTracking()
                    .Where(r => r.ItemId == itemId && r.Revision == item.ImageRevision)
                    .Select(r => r.ContentHash)
                    .FirstOrDefaultAsync(cancellationToken)
                : null;
            ImageReviewTransition transition = ItemImageReviewRules.Plan(
                item.ImageReviewState, item.ImageRevision, hasUpload, contentHash, storedHash,
                assetsChanged: questionPicture?.AssetId != item.QuestionImageAssetId || explanationPicture?.AssetId != item.ExplanationImageAssetId);
            if (ItemImageReviewRules.BlocksPublish(item.IsPrivate, effectiveIsPrivate, transition.State))
            {
                return Result.Failure<Response>(ItemImageReviewRules.ReviewRequired());
            }

            // Claim the revision first (one conditional UPDATE), so a decision or another edit that got there first is a 409, not an overwrite.
            transaction = await ItemImageSubmission.BeginAsync(db, cancellationToken);
            if (transition.Changed)
            {
                Error? claimError = await ItemImageSubmission.ClaimRevisionAsync(
                    db, item, transition, questionPicture, explanationPicture, contentHash, userId, cancellationToken);
                if (claimError is not null)
                {
                    return Result.Failure<Response>(claimError);
                }
            }
            else
            {
                ItemImageSubmission.ApplySlots(item, questionPicture, explanationPicture);
            }

            // Update item properties
            item.Question = request.Question;
            item.QuestionSpeech = questionSpeech;
            item.CorrectAnswer = request.CorrectAnswer;
            item.CorrectAnswerSpeech = ItemSpeechSupportHelper.Normalize(request.CorrectAnswerSpeech, 500);
            item.IncorrectAnswers = request.IncorrectAnswers;
            item.IncorrectAnswerSpeech = ItemSpeechSupportHelper.NormalizeDictionary(
                request.IncorrectAnswerSpeech,
                request.IncorrectAnswers.Count,
                500);
            item.IncorrectAnswerRationale = IncorrectAnswerRationaleHelper.Normalize(
                request.IncorrectAnswerRationale,
                request.IncorrectAnswers.Count);
            item.Explanation = request.Explanation;
            item.IsPrivate = effectiveIsPrivate;
            item.CategoryId = category.Id;
            item.NavigationKeywordId1 = navK1.Id;
            item.NavigationKeywordId2 = navK2.Id;
            if (request.ReadyForReview.HasValue)
            {
                item.ReadyForReview = request.ReadyForReview.Value;
            }
            item.FuzzySignature = fuzzySignature;
            item.FuzzyBucket = fuzzyBucket;
            if (request.Source is not null)
            {
                item.Source = string.IsNullOrWhiteSpace(request.Source) ? null : request.Source.Trim();
            }
            if (request.GroupLabel is not null)
            {
                item.GroupLabel = ItemGroupLabelHelper.Normalize(request.GroupLabel);
            }
            item.UpdatedAt = DateTime.UtcNow;

            if (request.Keywords is not null)
            {
                List<ItemKeyword> existingItemKeywords = await db.ItemKeywords
                    .Where(ik => ik.ItemId == itemId)
                    .ToListAsync(cancellationToken);
                db.ItemKeywords.RemoveRange(existingItemKeywords);
                await db.SaveChangesAsync(cancellationToken);

                List<string> orderedNames = [];

                void AddUniqueName(string raw)
                {
                    string n = KeywordHelper.NormalizeKeywordName(raw);
                    if (string.IsNullOrEmpty(n))
                        return;
                    if (orderedNames.Any(x => string.Equals(x, n, StringComparison.OrdinalIgnoreCase)))
                        return;
                    orderedNames.Add(n);
                }

                AddUniqueName(request.NavigationKeyword1);
                AddUniqueName(request.NavigationKeyword2);
                foreach (KeywordRequest kw in request.Keywords)
                    AddUniqueName(kw.Name);

                // #291: keywords created or reused during an edit belong to the item's creator, not an editing admin.
                string keywordOwnerId = string.IsNullOrWhiteSpace(item.CreatedBy) ? userId : item.CreatedBy;

                List<ItemKeyword> itemKeywords = [];
                HashSet<Guid> attached = [];

                foreach (string normalizedName in orderedNames)
                {
                    Keyword keyword;
                    if (string.Equals(normalizedName, navK1.Name, StringComparison.OrdinalIgnoreCase))
                        keyword = navK1;
                    else if (string.Equals(normalizedName, navK2.Name, StringComparison.OrdinalIgnoreCase))
                        keyword = navK2;
                    else
                    {
                        keyword = await ItemNavigationAndKeywordsHelper.GetOrCreateKeywordForItemAttachmentAsync(
                            db,
                            taxonomyRegistry,
                            category.Name,
                            keywordOwnerId,
                            normalizedName,
                            cancellationToken);
                    }

                    if (!attached.Add(keyword.Id))
                        continue;

                    itemKeywords.Add(new ItemKeyword
                    {
                        Id = Guid.NewGuid(),
                        ItemId = itemId,
                        KeywordId = keyword.Id,
                        AddedAt = DateTime.UtcNow
                    });
                }

                if (itemKeywords.Count > 0)
                {
                    db.ItemKeywords.AddRange(itemKeywords);
                    await db.SaveChangesAsync(cancellationToken);
                }
            }

            await db.SaveChangesAsync(cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            // Log audit entry
            if (!string.IsNullOrEmpty(userId) && Guid.TryParse(userId, out Guid userIdGuid))
            {
                await auditService.LogAsync(
                    AuditAction.ItemUpdated,
                    userId: userIdGuid,
                    entityId: itemId,
                    cancellationToken: cancellationToken);
            }

            string? rejectionReason = null;
            if (item.ImageReviewState == ItemImageReviewState.Rejected)
            {
                Dictionary<Guid, string?> reasons = await ItemImageReviewRules.LoadRejectionReasonsAsync(db, [item], cancellationToken);
                rejectionReason = reasons.GetValueOrDefault(item.Id);
            }

            Response response = new(
                item.Id.ToString(),
                category.Name,
                item.IsPrivate,
                item.Question,
                item.CorrectAnswer,
                item.IncorrectAnswers,
                item.Explanation,
                item.CreatedAt,
                item.Source,
                item.QuestionSpeech,
                item.CorrectAnswerSpeech,
                item.IncorrectAnswerSpeech.Count > 0 ? item.IncorrectAnswerSpeech : null,
                item.GroupLabel,
                ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt, item.QuestionImageAttribution),
                ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt, item.ExplanationImageAttribution),
                ItemImageReviewRules.InfoOf(item, rejectionReason),
                item.IncorrectAnswerRationale.Count > 0 ? item.IncorrectAnswerRationale : null);

            return Result.Success(response);
        }
        catch (DbUpdateException ex) when (ItemImageReviewRules.IsRevisionConflict(ex))
        {
            return Result.Failure<Response>(ItemImageReviewRules.ReviewStale());
        }
        catch (Exception ex)
        {
            return Result.Failure<Response>(
                Error.Problem("Item.UpdateFailed", "Failed to update item.", ex));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
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


