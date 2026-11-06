using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Add;

internal static class AddItemHandler
{
    public static async Task<Result<AddItem.Response>> HandleAsync(
        AddItem.Request request,
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
            bool effectiveIsPrivate = userContext.IsAdmin ? request.IsPrivate : true;

            string questionText = ItemSimHashInput.Normalize(request.Question);
            string fuzzySignature = simHashService.ComputeSimHash(questionText);
            int fuzzyBucket = simHashService.GetFuzzyBucket(fuzzySignature);

            string userId = userContext.UserId ?? throw new InvalidOperationException("User ID is required for item creation");

            Result<Category> categoryResult = await itemCategoryResolver.ResolveForItemAsync(
                request.Category,
                cancellationToken);

            if (categoryResult.IsFailure)
            {
                return Result.Failure<AddItem.Response>(categoryResult.Error!);
            }

            Category category = categoryResult.Value!;

            string nav1Norm = KeywordHelper.NormalizeKeywordName(request.NavigationKeyword1);
            string nav2Norm = KeywordHelper.NormalizeKeywordName(request.NavigationKeyword2);

            if (request.Keywords is not null)
            {
                foreach (AddItem.KeywordRequest kw in request.Keywords)
                {
                    if (string.IsNullOrWhiteSpace(kw.Name))
                        continue;
                    string n = KeywordHelper.NormalizeKeywordName(kw.Name);
                    if (string.IsNullOrEmpty(n))
                        continue;
                    if (!KeywordHelper.IsValidKeywordNameFormat(n))
                    {
                        return Result.Failure<AddItem.Response>(
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
                return Result.Failure<AddItem.Response>(navResult.Error!);

            (Keyword navK1, Keyword navK2) = navResult.Value!;

            (PictureSlot? questionPicture, Error? questionPictureError) = await ItemImageSubmission.ResolveSlotAsync(
                db, userId, null, null, null, request.QuestionImage, cancellationToken);
            if (questionPictureError is not null)
            {
                return Result.Failure<AddItem.Response>(questionPictureError);
            }

            (PictureSlot? explanationPicture, Error? explanationPictureError) = await ItemImageSubmission.ResolveSlotAsync(
                db, userId, null, null, null, request.ExplanationImage, cancellationToken);
            if (explanationPictureError is not null)
            {
                return Result.Failure<AddItem.Response>(explanationPictureError);
            }

            // Compare all creator/category peers in .NET: SQL trimming/casing differs for Unicode and legacy buckets can be stale.
            // Duplicate identity (AC 2.1.21): the curated key, or the picture bytes for an upload; the explanation picture is not part of it.
            var candidateItems = await (
                from existing in db.Items
                where existing.CreatedBy == userId &&
                    existing.CategoryId == category.Id
                join asset in db.MediaAssets on existing.QuestionImageAssetId equals asset.Id into assets
                from asset in assets.DefaultIfEmpty()
                select new
                {
                    existing.Question,
                    existing.FuzzySignature,
                    existing.QuestionImageKey,
                    existing.QuestionImageAssetId,
                    AssetSha256 = asset == null ? null : asset.Sha256
                })
                .ToListAsync(cancellationToken);

            string? newImageIdentity = questionPicture is null ? null : ItemImageReviewRules.DuplicateIdentity(null, questionPicture.AssetId, questionPicture.Sha256);
            bool isDuplicate = candidateItems.Any(item => ItemDuplicateRules.IsDuplicate(
                item.Question, item.FuzzySignature,
                ItemImageReviewRules.DuplicateIdentity(item.QuestionImageKey, item.QuestionImageAssetId, item.AssetSha256),
                request.Question, fuzzySignature, newImageIdentity));

            if (isDuplicate)
            {
                return Result.Failure<AddItem.Response>(
                    ItemDuplicateRules.Duplicate(category.Name));
            }

            ItemSpeechSupport? questionSpeech = ItemSpeechSupportHelper.Normalize(request.QuestionSpeech, 1000);
            bool hasUpload = questionPicture is not null || explanationPicture is not null;
            string? contentHash = hasUpload
                ? ItemImageReviewRules.ComputeContentHash(
                    request.Question, request.CorrectAnswer, request.IncorrectAnswers, request.Explanation,
                    questionSpeech, questionPicture, explanationPicture)
                : null;
            ImageReviewTransition transition = ItemImageReviewRules.Plan(null, 0, hasUpload, contentHash, null);
            if (ItemImageReviewRules.BlocksPublish(true, effectiveIsPrivate, transition.State))
            {
                return Result.Failure<AddItem.Response>(ItemImageReviewRules.ReviewRequired());
            }

            transaction = await ItemImageSubmission.BeginAsync(db, cancellationToken);

            Item item = new Item
            {
                Id = Guid.NewGuid(),
                IsRepoManaged = false,
                IsPrivate = effectiveIsPrivate,
                Question = request.Question,
                QuestionSpeech = questionSpeech,
                CorrectAnswer = request.CorrectAnswer,
                CorrectAnswerSpeech = ItemSpeechSupportHelper.Normalize(request.CorrectAnswerSpeech, 500),
                IncorrectAnswers = request.IncorrectAnswers,
                IncorrectAnswerSpeech = ItemSpeechSupportHelper.NormalizeDictionary(
                    request.IncorrectAnswerSpeech,
                    request.IncorrectAnswers.Count,
                    500),
                IncorrectAnswerRationale = IncorrectAnswerRationaleHelper.Normalize(
                    request.IncorrectAnswerRationale,
                    request.IncorrectAnswers.Count),
                Explanation = request.Explanation,
                FuzzySignature = fuzzySignature,
                FuzzyBucket = fuzzyBucket,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow,
                ReadyForReview = request.ReadyForReview,
                CategoryId = category.Id,
                NavigationKeywordId1 = navK1.Id,
                NavigationKeywordId2 = navK2.Id,
                Source = string.IsNullOrWhiteSpace(request.Source) ? null : request.Source.Trim(),
                GroupLabel = ItemGroupLabelHelper.Normalize(request.GroupLabel),
                ImageReviewState = transition.State,
                ImageRevision = transition.Revision,
            };
            ItemImageSubmission.ApplySlots(item, questionPicture, explanationPicture);

            db.Items.Add(item);
            if (transition.CreatesSubmission)
            {
                db.ItemImageReviews.Add(ItemImageSubmission.NewSubmission(
                    item.Id, transition.Revision, contentHash!, questionPicture, explanationPicture, userId));
            }

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
            if (request.Keywords is not null)
            {
                foreach (AddItem.KeywordRequest kw in request.Keywords)
                    AddUniqueName(kw.Name);
            }

            if (orderedNames.Count > 0)
            {
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
                            userId,
                            normalizedName,
                            cancellationToken);
                    }

                    if (!attached.Add(keyword.Id))
                        continue;

                    itemKeywords.Add(new ItemKeyword
                    {
                        Id = Guid.NewGuid(),
                        ItemId = item.Id,
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

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            if (!string.IsNullOrEmpty(userId) && Guid.TryParse(userId, out Guid userIdGuid))
            {
                await auditService.LogAsync(
                    AuditAction.ItemCreated,
                    userId: userIdGuid,
                    entityId: item.Id,
                    cancellationToken: cancellationToken);
            }

            AddItem.Response response = new AddItem.Response(
                item.Id.ToString(),
                category.Name,
                item.IsPrivate,
                item.Question,
                item.CorrectAnswer,
                item.IncorrectAnswers,
                item.Explanation,
                item.CreatedAt,
                item.Source,
                item.UploadId?.ToString(),
                item.QuestionSpeech,
                item.CorrectAnswerSpeech,
                item.IncorrectAnswerSpeech.Count > 0 ? item.IncorrectAnswerSpeech : null,
                item.GroupLabel,
                ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt, item.QuestionImageAttribution),
                ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt, item.ExplanationImageAttribution),
                ItemImageReviewRules.InfoOf(item),
                item.IncorrectAnswerRationale.Count > 0 ? item.IncorrectAnswerRationale : null);

            return Result.Success(response);
        }
        catch (DbUpdateException ex) when (ItemImageReviewRules.IsRevisionConflict(ex))
        {
            return Result.Failure<AddItem.Response>(ItemImageReviewRules.ReviewStale());
        }
        catch (Exception ex)
        {
            return Result.Failure<AddItem.Response>(
                Error.Problem("Item.CreateFailed", "Failed to create item.", ex));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }
}
