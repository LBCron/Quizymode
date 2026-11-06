using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.AddBulk;

internal static class AddItemsBulkHandler
{
    public static async Task<Result<AddItemsBulk.Response>> HandleAsync(
        AddItemsBulk.Request request,
        ApplicationDbContext db,
        ISimHashService simHashService,
        IUserContext userContext,
        ITaxonomyItemCategoryResolver itemCategoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        IAuditService auditService,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        try
        {
            string userId = userContext.UserId ?? throw new InvalidOperationException("User ID is required for bulk item creation");

            bool effectiveIsPrivate = userContext.IsAdmin ? request.IsPrivate : true;

            List<Item> itemsToInsert = [];
            Dictionary<int, Item> itemIndexMap = new();
            List<string> duplicateQuestions = [];
            List<AddItemsBulk.ItemError> errors = [];

            Result<Category> categoryResult = await itemCategoryResolver.ResolveForItemAsync(
                request.Category,
                cancellationToken);

            if (categoryResult.IsFailure)
            {
                return Result.Failure<AddItemsBulk.Response>(
                    Error.Validation("Items.BulkInvalidCategory", categoryResult.Error!.Description));
            }

            Category category = categoryResult.Value!;

            string normalizedKeyword1 = KeywordHelper.NormalizeKeywordName(request.Keyword1);
            string normalizedKeyword2 = KeywordHelper.NormalizeKeywordName(request.Keyword2 ?? "");

            Result<(Keyword Nav1, Keyword Nav2)> navResult = await ItemNavigationAndKeywordsHelper.ResolvePublicNavigationAsync(
                db,
                taxonomyRegistry,
                category,
                request.Keyword1,
                request.Keyword2 ?? "",
                cancellationToken);

            if (navResult.IsFailure)
            {
                return Result.Failure<AddItemsBulk.Response>(navResult.Error!);
            }

            (Keyword keyword1Entity, Keyword keyword2Entity) = navResult.Value!;

            foreach (AddItemsBulk.KeywordRequest kw in request.Keywords)
            {
                string normalized = KeywordHelper.NormalizeKeywordName(kw.Name);
                if (string.IsNullOrEmpty(normalized))
                {
                    continue;
                }

                if (!KeywordHelper.IsValidKeywordNameFormat(normalized))
                {
                    return Result.Failure<AddItemsBulk.Response>(
                        Error.Validation("Items.BulkInvalidKeyword", $"Default keyword '{normalized}' is invalid. Use only letters, numbers, and hyphens (max 30 characters)."));
                }

                if (string.Equals(normalized, normalizedKeyword1, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalized, normalizedKeyword2, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
            }

            List<string> bulkDefaultExtraNames = [];
            foreach (AddItemsBulk.KeywordRequest kw in request.Keywords)
            {
                string normalized = KeywordHelper.NormalizeKeywordName(kw.Name);
                if (string.IsNullOrEmpty(normalized))
                {
                    continue;
                }

                if (bulkDefaultExtraNames.Any(x => string.Equals(x, normalized, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                if (string.Equals(normalized, keyword1Entity.Name, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normalized, keyword2Entity.Name, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                bulkDefaultExtraNames.Add(normalized);
            }

            // Callers that already hold a transaction (study-guide accept/auto-save) own commit and rollback.
            IDbContextTransaction? transaction = null;
            if (db.Database.IsRelational() && db.Database.CurrentTransaction is null)
            {
                try
                {
                    transaction = await db.Database.BeginTransactionAsync(cancellationToken);
                }
                catch (NotSupportedException)
                {
                }
            }

            try
            {
                for (int index = 0; index < request.Items.Count; index++)
                {
                    AddItemsBulk.ItemRequest itemRequest = request.Items[index];

                    try
                    {
                        bool skipItem = false;
                        if (itemRequest.Keywords is { Count: > 0 })
                        {
                            foreach (AddItemsBulk.KeywordRequest keywordRequest in itemRequest.Keywords)
                            {
                                string name = KeywordHelper.NormalizeKeywordName(keywordRequest.Name ?? string.Empty);
                                if (string.IsNullOrEmpty(name))
                                {
                                    continue;
                                }

                                if (!KeywordHelper.IsValidKeywordNameFormat(name))
                                {
                                    errors.Add(new AddItemsBulk.ItemError(index, itemRequest.Question, $"Keyword '{name}' is invalid. Use only letters, numbers, and hyphens (max 30 characters)."));
                                    skipItem = true;
                                    break;
                                }
                            }
                        }

                        if (skipItem)
                        {
                            continue;
                        }

                        string questionText = ItemSimHashInput.Normalize(itemRequest.Question);
                        string fuzzySignature = simHashService.ComputeSimHash(questionText);
                        int fuzzyBucket = simHashService.GetFuzzyBucket(fuzzySignature);

                        bool isDuplicate;
                        try
                        {
                            List<Guid> existingItemIds = itemsToInsert.Select(it => it.Id).ToList();
                            // Use .NET normalization for all scoped peers, including legacy buckets and Unicode whitespace.
                            List<Item> candidateItems = await db.Items
                                .Where(item =>
                                    item.CreatedBy == userId &&
                                    item.CategoryId == category.Id &&
                                    !existingItemIds.Contains(item.Id))
                                .ToListAsync(cancellationToken);

                            // Bulk creates text-only items: a non-null upload identity is enough to distinguish pictured peers.
                            isDuplicate = candidateItems.Any(item => ItemDuplicateRules.IsDuplicate(
                                item.Question, item.FuzzySignature,
                                ItemImageReviewRules.DuplicateIdentity(item.QuestionImageKey, item.QuestionImageAssetId, null),
                                itemRequest.Question, fuzzySignature, null));
                        }
                        catch (Exception ex)
                        {
                            logger.LogError(ex, "Bulk add: duplicate check failed for item at index {Index}", index);
                            errors.Add(new AddItemsBulk.ItemError(index, itemRequest.Question, "Unable to check for duplicates."));
                            continue;
                        }

                        if (isDuplicate)
                        {
                            duplicateQuestions.Add(itemRequest.Question);
                            continue;
                        }

                        Item item = new()
                        {
                            Id = Guid.NewGuid(),
                            IsRepoManaged = false,
                            IsPrivate = effectiveIsPrivate,
                            Question = itemRequest.Question,
                            QuestionSpeech = ItemSpeechSupportHelper.Normalize(itemRequest.QuestionSpeech, 1000),
                            CorrectAnswer = itemRequest.CorrectAnswer,
                            CorrectAnswerSpeech = ItemSpeechSupportHelper.Normalize(itemRequest.CorrectAnswerSpeech, 500),
                            IncorrectAnswers = itemRequest.IncorrectAnswers,
                            IncorrectAnswerSpeech = ItemSpeechSupportHelper.NormalizeDictionary(
                                itemRequest.IncorrectAnswerSpeech,
                                itemRequest.IncorrectAnswers.Count,
                                500),
                            IncorrectAnswerRationale = IncorrectAnswerRationaleHelper.Normalize(
                                itemRequest.IncorrectAnswerRationale,
                                itemRequest.IncorrectAnswers.Count),
                            Explanation = itemRequest.Explanation,
                            FuzzySignature = fuzzySignature,
                            FuzzyBucket = fuzzyBucket,
                            CreatedBy = userId,
                            CreatedAt = DateTime.UtcNow,
                            CategoryId = category.Id,
                            NavigationKeywordId1 = keyword1Entity.Id,
                            NavigationKeywordId2 = keyword2Entity.Id,
                            Source = string.IsNullOrWhiteSpace(itemRequest.Source) ? null : itemRequest.Source.Trim(),
                            GroupLabel = ItemGroupLabelHelper.Normalize(itemRequest.GroupLabel),
                            UploadId = request.UploadId,
                        };

                        itemsToInsert.Add(item);
                        itemIndexMap[index] = item;
                    }
                    catch (Exception ex)
                    {
                        logger.LogError(ex, "Bulk add: failed to process item at index {Index}", index);
                        errors.Add(new AddItemsBulk.ItemError(index, itemRequest.Question, "Failed to process item."));
                    }
                }

                if (itemsToInsert.Count > 0)
                {
                    db.Items.AddRange(itemsToInsert);
                    await db.SaveChangesAsync(cancellationToken);

                    List<ItemKeyword> itemKeywordsToInsert = [];
                    Dictionary<string, Keyword> keywordCache = new(StringComparer.OrdinalIgnoreCase);

                    foreach (KeyValuePair<int, Item> kvp in itemIndexMap)
                    {
                        int originalIndex = kvp.Key;
                        Item item = kvp.Value;
                        AddItemsBulk.ItemRequest itemRequest = request.Items[originalIndex];

                        List<string> orderedNames = [];

                        void AddUnique(string raw)
                        {
                            string normalized = KeywordHelper.NormalizeKeywordName(raw);
                            if (string.IsNullOrEmpty(normalized))
                            {
                                return;
                            }

                            if (orderedNames.Any(existing => string.Equals(existing, normalized, StringComparison.OrdinalIgnoreCase)))
                            {
                                return;
                            }

                            orderedNames.Add(normalized);
                        }

                        AddUnique(keyword1Entity.Name);
                        AddUnique(keyword2Entity.Name);

                        if (itemRequest.Keywords is { Count: > 0 })
                        {
                            foreach (AddItemsBulk.KeywordRequest itemKeyword in itemRequest.Keywords)
                            {
                                AddUnique(itemKeyword.Name);
                            }
                        }
                        else
                        {
                            foreach (string extra in bulkDefaultExtraNames)
                            {
                                AddUnique(extra);
                            }
                        }

                        HashSet<Guid> attached = [];

                        foreach (string normalizedName in orderedNames)
                        {
                            Keyword keyword;
                            if (string.Equals(normalizedName, keyword1Entity.Name, StringComparison.OrdinalIgnoreCase))
                            {
                                keyword = keyword1Entity;
                            }
                            else if (string.Equals(normalizedName, keyword2Entity.Name, StringComparison.OrdinalIgnoreCase))
                            {
                                keyword = keyword2Entity;
                            }
                            else if (!keywordCache.TryGetValue(normalizedName, out keyword!))
                            {
                                keyword = await ItemNavigationAndKeywordsHelper.GetOrCreateKeywordForItemAttachmentAsync(
                                    db,
                                    taxonomyRegistry,
                                    category.Name,
                                    userId,
                                    normalizedName,
                                    cancellationToken);
                                keywordCache[normalizedName] = keyword;
                            }

                            if (!attached.Add(keyword.Id))
                            {
                                continue;
                            }

                            itemKeywordsToInsert.Add(new ItemKeyword
                            {
                                Id = Guid.NewGuid(),
                                ItemId = item.Id,
                                KeywordId = keyword.Id,
                                AddedAt = DateTime.UtcNow
                            });
                        }
                    }

                    if (itemKeywordsToInsert.Count > 0)
                    {
                        db.ItemKeywords.AddRange(itemKeywordsToInsert);
                        await db.SaveChangesAsync(cancellationToken);
                    }

                    if (Guid.TryParse(userId, out Guid userIdGuid))
                    {
                        foreach (Item item in itemsToInsert)
                        {
                            await auditService.LogAsync(
                                AuditAction.ItemCreated,
                                userId: userIdGuid,
                                entityId: item.Id,
                                cancellationToken: cancellationToken);
                        }
                    }
                }

                if (transaction is not null)
                {
                    await transaction.CommitAsync(cancellationToken);
                }

                List<Guid> createdIds = itemsToInsert.Select(item => item.Id).ToList();
                return Result.Success(new AddItemsBulk.Response(
                    request.Items.Count,
                    itemsToInsert.Count,
                    duplicateQuestions.Count,
                    errors.Count,
                    duplicateQuestions,
                    errors,
                    createdIds));
            }
            catch
            {
                await TryRollbackTransactionAsync(transaction, cancellationToken);
                throw;
            }
            finally
            {
                if (transaction is not null)
                {
                    await transaction.DisposeAsync();
                }
            }
        }
        catch (Exception ex)
        {
            return Result.Failure<AddItemsBulk.Response>(
                Error.Problem("Items.BulkCreateFailed", "Failed to create items.", ex));
        }
    }

    private static async Task TryRollbackTransactionAsync(
        IDbContextTransaction? transaction,
        CancellationToken cancellationToken)
    {
        if (transaction is null)
        {
            return;
        }

        try
        {
            await transaction.RollbackAsync(cancellationToken);
        }
        catch (ObjectDisposedException)
        {
        }
    }
}
