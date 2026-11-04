using System.Data;
using System.Data.Common;
using System.Diagnostics;
using FluentValidation.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Services.Taxonomy.Suggestions;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Taxonomy;

namespace Quizymode.Api.Features.Admin;

internal sealed class SeedSyncAdminService(
    ApplicationDbContext db,
    ITaxonomyRegistry taxonomyRegistry,
    IGitHubSeedSource gitHubSeedSource,
    LocalSeedLoader localSeedLoader,
    IUserContext userContext,
    ITopicSuggestionInvalidator? topicSuggestionInvalidator = null)
{
    private const string SeederUserId = "seeder";
    private readonly IGitHubSeedSource _gitHubSeedSource = gitHubSeedSource;
    private readonly LocalSeedLoader _localSeedLoader = localSeedLoader;
    private readonly IUserContext _userContext = userContext;

    public async Task<Result<SeedSyncAdmin.PreviewResponse>> PreviewAsync(
        SeedSyncAdmin.Request request,
        CancellationToken cancellationToken)
    {
        try
        {
            Stopwatch sw = Stopwatch.StartNew();
            Result<LoadedGitHubSeedManifest> loadResult = await _gitHubSeedSource.LoadManifestAsync(request, cancellationToken);
            if (loadResult.IsFailure)
            {
                return Result.Failure<SeedSyncAdmin.PreviewResponse>(loadResult.Error!);
            }

            ITaxonomyRegistry? branchRegistry = await BuildBranchRegistryAsync(loadResult.Value!, cancellationToken);
            Result<SeedSyncAdmin.PreviewResponse> result = await PreviewManifestAsync(
                loadResult.Value!.Manifest, loadResult.Value.SourceContext, cancellationToken, branchRegistry);
            sw.Stop();

            return result.IsSuccess
                ? Result.Success(result.Value! with { DurationMs = sw.ElapsedMilliseconds })
                : result;
        }
        catch (Exception ex)
        {
            return Result.Failure<SeedSyncAdmin.PreviewResponse>(
                Error.Problem("Admin.SeedSyncPreviewFailed", "Failed to preview item sync.", ex));
        }
    }

    public async Task<Result<SeedSyncAdmin.PreviewResponse>> PreviewManifestAsync(
        SeedSyncAdmin.ManifestRequest manifest,
        SeedSyncAdmin.SourceContext sourceContext,
        CancellationToken cancellationToken,
        ITaxonomyRegistry? taxonomyOverride = null)
    {
        try
        {
            Result<SeedSyncPlan> planResult = await BuildPlanAsync(manifest, cancellationToken, taxonomyOverride ?? taxonomyRegistry);
            if (planResult.IsFailure)
            {
                return Result.Failure<SeedSyncAdmin.PreviewResponse>(planResult.Error!);
            }

            return Result.Success(ToPreviewResponse(planResult.Value!, sourceContext, manifest.DeltaPreviewLimit));
        }
        catch (Exception ex)
        {
            return Result.Failure<SeedSyncAdmin.PreviewResponse>(
                Error.Problem("Admin.SeedSyncPreviewFailed", "Failed to preview item sync.", ex));
        }
    }

    public async Task<Result<SeedSyncAdmin.ApplyResponse>> ApplyAsync(
        SeedSyncAdmin.Request request,
        CancellationToken cancellationToken)
    {
        Stopwatch sw = Stopwatch.StartNew();
        Result<LoadedGitHubSeedManifest> loadResult = await _gitHubSeedSource.LoadManifestAsync(request, cancellationToken);
        if (loadResult.IsFailure)
        {
            return Result.Failure<SeedSyncAdmin.ApplyResponse>(loadResult.Error!);
        }

        ITaxonomyRegistry? branchRegistry = await BuildBranchRegistryAsync(loadResult.Value!, cancellationToken);
        Result<SeedSyncAdmin.ApplyResponse> result = await ApplyManifestAsync(
            loadResult.Value!.Manifest, loadResult.Value.SourceContext, cancellationToken, taxonomyOverride: branchRegistry);
        sw.Stop();

        return result.IsSuccess
            ? Result.Success(result.Value! with { DurationMs = sw.ElapsedMilliseconds })
            : result;
    }

    public async Task<Result<SeedSyncAdmin.PreviewResponse>> PreviewLocalAsync(
        SeedSyncAdmin.LocalRequest request,
        CancellationToken cancellationToken)
    {
        Stopwatch sw = Stopwatch.StartNew();
        Result<LoadedLocalSeedManifest> loadResult = await _localSeedLoader.LoadManifestAsync(request.DeltaPreviewLimit, cancellationToken);
        if (loadResult.IsFailure)
        {
            return Result.Failure<SeedSyncAdmin.PreviewResponse>(loadResult.Error!);
        }

        Result<SeedSyncAdmin.PreviewResponse> result = await PreviewManifestAsync(loadResult.Value!.Manifest, loadResult.Value.SourceContext, cancellationToken);
        sw.Stop();

        return result.IsSuccess
            ? Result.Success(result.Value! with { DurationMs = sw.ElapsedMilliseconds })
            : result;
    }

    public async Task<Result<SeedSyncAdmin.ApplyResponse>> ApplyLocalAsync(
        SeedSyncAdmin.LocalRequest request,
        CancellationToken cancellationToken)
    {
        Stopwatch sw = Stopwatch.StartNew();
        Result<LoadedLocalSeedManifest> loadResult = await _localSeedLoader.LoadManifestAsync(request.DeltaPreviewLimit, cancellationToken);
        if (loadResult.IsFailure)
        {
            return Result.Failure<SeedSyncAdmin.ApplyResponse>(loadResult.Error!);
        }

        Result<SeedSyncAdmin.ApplyResponse> result = await ApplyManifestAsync(loadResult.Value!.Manifest, loadResult.Value.SourceContext, cancellationToken: cancellationToken);
        sw.Stop();

        return result.IsSuccess
            ? Result.Success(result.Value! with { DurationMs = sw.ElapsedMilliseconds })
            : result;
    }

    public async Task<Result<SeedSyncAdmin.ApplyResponse>> ApplyManifestAsync(
        SeedSyncAdmin.ManifestRequest manifest,
        SeedSyncAdmin.SourceContext sourceContext,
        CancellationToken cancellationToken,
        bool recordHistory = true,
        ITaxonomyRegistry? taxonomyOverride = null)
    {
        IDbContextTransaction? transaction = null;

        try
        {
            Result<SeedSyncPlan> planResult = await BuildPlanAsync(manifest, cancellationToken, taxonomyOverride ?? taxonomyRegistry);
            if (planResult.IsFailure)
            {
                return Result.Failure<SeedSyncAdmin.ApplyResponse>(planResult.Error!);
            }

            SeedSyncPlan plan = planResult.Value!;
            Dictionary<string, Keyword> publicKeywordMap = await LoadOrCreatePublicKeywordsAsync(plan, cancellationToken);

            if (db.Database.IsRelational())
            {
                try
                {
                    transaction = await db.Database.BeginTransactionAsync(cancellationToken);
                }
                catch (NotSupportedException)
                {
                }
            }

            DateTime utcNow = DateTime.UtcNow;
            SeedSyncRun? historyRun = recordHistory
                ? BuildHistoryRun(plan, sourceContext, utcNow)
                : null;

            const int saveBatchSize = 200;
            int pendingItemChanges = 0;
            foreach (PlannedSeedItemChange change in plan.Changes)
            {
                if (change.ChangeKind == SeedSyncChangeKind.Unchanged)
                {
                    continue;
                }

                ApplyChange(change, publicKeywordMap, utcNow);
                pendingItemChanges++;

                if (pendingItemChanges % saveBatchSize == 0)
                {
                    await db.SaveChangesAsync(cancellationToken);
                }
            }

            foreach (PlannedSeedCollectionChange change in plan.CollectionChanges)
            {
                ApplyCollectionChange(change, utcNow);
            }

            if (historyRun is not null)
            {
                db.SeedSyncRuns.Add(historyRun);
            }

            await db.SaveChangesAsync(cancellationToken);

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            // Public items changed: topic suggestion reloads its profiles lazily (still bounded by its daily cap).
            topicSuggestionInvalidator?.Invalidate();

            return Result.Success(ToApplyResponse(plan, sourceContext, manifest.DeltaPreviewLimit, historyRun));
        }
        catch (Exception ex)
        {
            await TryRollbackAsync(transaction, cancellationToken);
            return Result.Failure<SeedSyncAdmin.ApplyResponse>(
                Error.Problem("Admin.SeedSyncApplyFailed", "Failed to apply item sync.", ex));
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    public async Task<Result<SeedSyncAdmin.HistoryResponse>> GetHistoryAsync(
        int take,
        int changesPerRun,
        CancellationToken cancellationToken)
    {
        try
        {
            List<SeedSyncRun> runs = await db.SeedSyncRuns
                .AsNoTracking()
                .Include(run => run.ItemHistories)
                .OrderByDescending(run => run.CreatedUtc)
                .Take(take)
                .ToListAsync(cancellationToken);

            List<SeedSyncAdmin.HistoryRunResponse> responseRuns = runs
                .Select(run => new SeedSyncAdmin.HistoryRunResponse(
                    run.Id,
                    run.CreatedUtc,
                    run.TriggeredByUserId,
                    run.RepositoryOwner,
                    run.RepositoryName,
                    run.GitRef,
                    run.ResolvedCommitSha,
                    run.ItemsPath,
                    run.SeedSet,
                    run.SourceFileCount,
                    run.TotalItemsInPayload,
                    run.ExistingItemCount,
                    run.CreatedCount + run.UpdatedCount + run.DeletedCount,
                    run.CreatedCount,
                    run.UpdatedCount,
                    run.DeletedCount,
                    run.UnchangedCount,
                    run.ItemHistories.Count > changesPerRun,
                    run.ItemHistories
                        .OrderBy(history => history.CreatedUtc)
                        .ThenBy(history => history.ItemId)
                        .Take(changesPerRun)
                        .Select(history => new SeedSyncAdmin.HistoryItemResponse(
                            history.ItemId,
                            history.Action switch
                            {
                                SeedSyncItemHistoryAction.Created => "Created",
                                SeedSyncItemHistoryAction.Updated => "Updated",
                                SeedSyncItemHistoryAction.Deleted => "Deleted",
                                _ => "Updated"
                            },
                            history.Category,
                            history.NavigationKeyword1,
                            history.NavigationKeyword2,
                            history.Question,
                            history.ChangedFields))
                        .ToList()))
                .ToList();

            return Result.Success(new SeedSyncAdmin.HistoryResponse(responseRuns));
        }
        catch (Exception ex)
        {
            return Result.Failure<SeedSyncAdmin.HistoryResponse>(
                Error.Problem("Admin.SeedSyncHistoryFailed", "Failed to load seed sync history.", ex));
        }
    }

    private async Task<Result<SeedSyncPlan>> BuildPlanAsync(
        SeedSyncAdmin.ManifestRequest request,
        CancellationToken cancellationToken,
        ITaxonomyRegistry registry)
    {
        ValidationResult validationResult = SeedSyncAdmin.ValidateManifest(request);
        if (!validationResult.IsValid)
        {
            return Result.Failure<SeedSyncPlan>(
                Error.Validation(
                    "Admin.SeedSyncManifestInvalid",
                    string.Join(" ", validationResult.Errors.Select(error => error.ErrorMessage))));
        }

        List<NormalizedSeedItem> normalizedItems = request.Items
            .Select(NormalizeItem)
            .ToList();
        List<NormalizedSeedCollection> normalizedCollections = request.Collections
            .Select(NormalizeCollection)
            .ToList();

        Result<Dictionary<string, Category>> categoryResult = await LoadCategoriesAsync(normalizedItems, cancellationToken);
        if (categoryResult.IsFailure)
        {
            return Result.Failure<SeedSyncPlan>(categoryResult.Error!);
        }

        HashSet<Guid> incomingItemIds = normalizedItems
            .Select(item => item.ItemId)
            .ToHashSet();

        List<Item> existingItems = await db.Items
            .Where(item => incomingItemIds.Contains(item.Id))
            .Include(item => item.Category)
            .Include(item => item.NavigationKeyword1)
            .Include(item => item.NavigationKeyword2)
            .Include(item => item.ItemKeywords)
                .ThenInclude(link => link.Keyword)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        foreach (Item existingItem in existingItems)
        {
            if (existingItem.IsPrivate || !existingItem.IsRepoManaged)
            {
                return Result.Failure<SeedSyncPlan>(
                    Error.Validation(
                        "Admin.ItemSyncIdConflict",
                        $"ItemId '{existingItem.Id}' is already assigned to a non-repo-managed or private item and cannot be managed by admin sync."));
            }
        }

        Dictionary<string, Category> categoryCache = categoryResult.Value!;
        Dictionary<Guid, Item> existingById = existingItems.ToDictionary(item => item.Id);
        Dictionary<string, ResolvedNavigationPath> navigationCache = new(StringComparer.OrdinalIgnoreCase);
        List<PlannedSeedItemChange> changes = [];

        foreach (NormalizedSeedItem normalizedItem in normalizedItems)
        {
            Result<ResolvedNavigationPath> pathResult = await ResolveNavigationAsync(
                normalizedItem,
                categoryCache,
                navigationCache,
                registry,
                cancellationToken);

            if (pathResult.IsFailure)
            {
                return Result.Failure<SeedSyncPlan>(pathResult.Error!);
            }

            ResolvedNavigationPath path = pathResult.Value!;
            if (existingById.TryGetValue(normalizedItem.ItemId, out Item? existingItem))
            {
                List<string> changedFields = GetChangedFields(existingItem, normalizedItem);
                changes.Add(new PlannedSeedItemChange(
                    normalizedItem,
                    path,
                    existingItem,
                    changedFields.Count == 0 ? SeedSyncChangeKind.Unchanged : SeedSyncChangeKind.Update,
                    changedFields));
                continue;
            }

            changes.Add(new PlannedSeedItemChange(
                normalizedItem,
                path,
                null,
                SeedSyncChangeKind.Create,
                []));
        }

        HashSet<Guid> incomingCollectionIds = normalizedCollections
            .Select(collection => collection.CollectionId)
            .ToHashSet();

        List<Collection> existingCollections = await db.Collections
            .Where(collection => incomingCollectionIds.Contains(collection.Id))
            .ToListAsync(cancellationToken);

        foreach (Collection existingCollection in existingCollections)
        {
            if (!existingCollection.IsRepoManaged)
            {
                return Result.Failure<SeedSyncPlan>(
                    Error.Validation(
                        "Admin.CollectionSyncIdConflict",
                        $"CollectionId '{existingCollection.Id}' is already assigned to a non-repo-managed collection and cannot be managed by admin sync."));
            }
        }

        HashSet<Guid> availableItemIds = existingById.Keys.ToHashSet();
        availableItemIds.UnionWith(incomingItemIds);

        // Collections may reference items synced in a previous shard — check the DB for any referenced IDs not in the current payload.
        HashSet<Guid> referencedByCollections = normalizedCollections
            .SelectMany(collection => collection.ItemIds)
            .Where(id => !availableItemIds.Contains(id))
            .ToHashSet();

        if (referencedByCollections.Count > 0)
        {
            List<Guid> existingReferencedIds = await db.Items
                .Where(item => referencedByCollections.Contains(item.Id))
                .Select(item => item.Id)
                .ToListAsync(cancellationToken);

            availableItemIds.UnionWith(existingReferencedIds);
        }

        Dictionary<Guid, Collection> existingCollectionsById = existingCollections.ToDictionary(collection => collection.Id);
        List<PlannedSeedCollectionChange> collectionChanges = [];

        foreach (NormalizedSeedCollection normalizedCollection in normalizedCollections)
        {
            List<Guid> missingItemIds = normalizedCollection.ItemIds
                .Where(itemId => !availableItemIds.Contains(itemId))
                .ToList();

            if (missingItemIds.Count > 0)
            {
                return Result.Failure<SeedSyncPlan>(
                    Error.Validation(
                        "Admin.CollectionSyncMissingItems",
                        $"Collection '{normalizedCollection.Name}' references missing itemIds: {string.Join(", ", missingItemIds)}"));
            }

            existingCollectionsById.TryGetValue(normalizedCollection.CollectionId, out Collection? existingCollection);
            List<string> changedFields = existingCollection is null
                ? []
                : GetChangedFields(existingCollection, normalizedCollection);

            collectionChanges.Add(new PlannedSeedCollectionChange(
                normalizedCollection,
                existingCollection,
                existingCollection is null
                    ? SeedSyncChangeKind.Create
                    : changedFields.Count == 0
                        ? SeedSyncChangeKind.Unchanged
                        : SeedSyncChangeKind.Update,
                changedFields));
        }

        return Result.Success(new SeedSyncPlan(
            request.SeedSet,
            normalizedItems.Count,
            existingById.Count,
            changes,
            normalizedCollections.Count,
            existingCollectionsById.Count,
            collectionChanges));
    }

    private async Task<Result<Dictionary<string, Category>>> LoadCategoriesAsync(
        List<NormalizedSeedItem> items,
        CancellationToken cancellationToken)
    {
        HashSet<string> requestedCategorySlugs = items
            .Select(item => item.Category)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        List<Category> categories = await db.Categories
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        Dictionary<string, Category> categoryBySlug = categories
            .GroupBy(category => CategoryHelper.NameToSlug(category.Name), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        List<string> missing = requestedCategorySlugs
            .Where(slug => !categoryBySlug.ContainsKey(slug))
            .OrderBy(slug => slug, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (missing.Count > 0)
        {
            return Result.Failure<Dictionary<string, Category>>(
                Error.Validation(
                    "Admin.ItemSyncInvalidCategory",
                    $"The following categories do not exist in the database: {string.Join(", ", missing)}."));
        }

        Dictionary<string, Category> requested = new(StringComparer.OrdinalIgnoreCase);
        foreach (string slug in requestedCategorySlugs)
        {
            requested[slug] = categoryBySlug[slug];
        }

        return Result.Success(requested);
    }

    private async Task<Result<ResolvedNavigationPath>> ResolveNavigationAsync(
        NormalizedSeedItem item,
        Dictionary<string, Category> categoryCache,
        Dictionary<string, ResolvedNavigationPath> navigationCache,
        ITaxonomyRegistry registry,
        CancellationToken cancellationToken)
    {
        string cacheKey = $"{item.Category}|{item.NavigationKeyword1}|{item.NavigationKeyword2}";
        if (navigationCache.TryGetValue(cacheKey, out ResolvedNavigationPath? cached))
        {
            return Result.Success(cached);
        }

        if (!categoryCache.TryGetValue(item.Category, out Category? category))
        {
            return Result.Failure<ResolvedNavigationPath>(
                Error.Validation(
                    "Admin.ItemSyncCategoryMissingFromDb",
                    $"Category '{item.Category}' does not exist in the database."));
        }

        Result<(Keyword Nav1, Keyword Nav2)> navResult = await ItemNavigationAndKeywordsHelper.ResolvePublicNavigationAsync(
            db,
            registry,
            category,
            item.NavigationKeyword1,
            item.NavigationKeyword2,
            cancellationToken);

        if (navResult.IsFailure)
        {
            return Result.Failure<ResolvedNavigationPath>(navResult.Error!);
        }

        ResolvedNavigationPath resolved = new(category, navResult.Value!.Nav1, navResult.Value!.Nav2);
        navigationCache[cacheKey] = resolved;
        return Result.Success(resolved);
    }

    private async Task<ITaxonomyRegistry?> BuildBranchRegistryAsync(
        LoadedGitHubSeedManifest loaded,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(loaded.BranchTaxonomyYaml) || string.IsNullOrWhiteSpace(loaded.BranchTaxonomySql))
            return null;

        await ApplyBranchTaxonomySqlAsync(loaded.BranchTaxonomySql, cancellationToken);

        IReadOnlyDictionary<string, TaxonomyCategoryDefinition> parsed = TaxonomyYamlParser.LoadFromString(loaded.BranchTaxonomyYaml);
        return new TaxonomyRegistry(parsed);
    }

    private async Task ApplyBranchTaxonomySqlAsync(string sql, CancellationToken cancellationToken)
    {
        DbConnection connection = db.Database.GetDbConnection();
        bool shouldClose = connection.State != ConnectionState.Open;
        if (shouldClose)
            await db.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            await using DbTransaction transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using DbCommand command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        finally
        {
            if (shouldClose)
                await db.Database.CloseConnectionAsync();
        }
    }

    private async Task<Dictionary<string, Keyword>> LoadOrCreatePublicKeywordsAsync(
        SeedSyncPlan plan,
        CancellationToken cancellationToken)
    {
        HashSet<string> requiredNames = plan.Changes
            .SelectMany(change => change.Item.Keywords)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (requiredNames.Count == 0)
        {
            return new Dictionary<string, Keyword>(StringComparer.OrdinalIgnoreCase);
        }

        List<Keyword> existing = await db.Keywords
            .Where(keyword => !keyword.IsPrivate && requiredNames.Contains(keyword.Name.ToLower()))
            .ToListAsync(cancellationToken);

        Dictionary<string, Keyword> map = existing
            .GroupBy(keyword => keyword.Name.ToLower(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        foreach (string requiredName in requiredNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase))
        {
            if (map.ContainsKey(requiredName))
            {
                continue;
            }

            Keyword keyword = new()
            {
                Id = Guid.NewGuid(),
                Name = requiredName,
                Slug = KeywordHelper.NameToSlug(requiredName),
                IsPrivate = false,
                CreatedBy = SeederUserId,
                CreatedAt = DateTime.UtcNow,
                IsReviewPending = false
            };

            db.Keywords.Add(keyword);
            map[requiredName] = keyword;
        }

        return map;
    }

    private void ApplyChange(
        PlannedSeedItemChange change,
        Dictionary<string, Keyword> publicKeywordMap,
        DateTime utcNow)
    {
        Item item = change.ExistingItem ?? new Item
        {
            Id = change.Item.ItemId,
            CreatedAt = utcNow,
            CreatedBy = SeederUserId,
            IsRepoManaged = true
        };

        if (change.ExistingItem is null)
        {
            db.Items.Add(item);
        }

        item.IsPrivate = false;
        item.IsRepoManaged = true;
        item.Question = change.Item.Question;
        item.QuestionSpeech = change.Item.QuestionSpeech;
        item.CorrectAnswer = change.Item.CorrectAnswer;
        item.CorrectAnswerSpeech = change.Item.CorrectAnswerSpeech;
        item.IncorrectAnswers = change.Item.IncorrectAnswers;
        item.IncorrectAnswerSpeech = change.Item.IncorrectAnswerSpeech;
        item.Explanation = change.Item.Explanation;
        item.Source = change.Item.Source;
        item.QuestionImageKey = change.Item.QuestionImage?.Key;
        item.QuestionImageAlt = change.Item.QuestionImage?.AltText;
        item.ExplanationImageKey = change.Item.ExplanationImage?.Key;
        item.ExplanationImageAlt = change.Item.ExplanationImage?.AltText;
        item.StarterWorld = change.Item.StarterWorld;
        item.WowLine = change.Item.WowLine;
        item.CategoryId = change.Navigation.Category.Id;
        item.NavigationKeywordId1 = change.Navigation.Nav1.Id;
        item.NavigationKeywordId2 = change.Navigation.Nav2.Id;

        ReconcileItemKeywords(item, change, publicKeywordMap, utcNow);
    }

    private void ApplyCollectionChange(
        PlannedSeedCollectionChange change,
        DateTime utcNow)
    {
        Collection collection = change.ExistingCollection ?? new Collection
        {
            Id = change.Collection.CollectionId,
            CreatedAt = utcNow,
            CreatedBy = SeederUserId,
            IsRepoManaged = true
        };

        if (change.ExistingCollection is null)
        {
            db.Collections.Add(collection);
        }

        collection.Name = change.Collection.Name;
        collection.Description = change.Collection.Description;
        collection.IsPublic = true;
        collection.IsDiscoverable = true;
        collection.IsRepoManaged = true;
        collection.UpdatedAt = change.ExistingCollection is null ? null : utcNow;

        List<CollectionItem> existingLinks = db.CollectionItems
            .Where(link => link.CollectionId == collection.Id)
            .ToList();

        HashSet<Guid> desiredItemIds = change.Collection.ItemIds.ToHashSet();
        List<CollectionItem> linksToRemove = existingLinks
            .Where(link => !desiredItemIds.Contains(link.ItemId))
            .ToList();

        if (linksToRemove.Count > 0)
        {
            db.CollectionItems.RemoveRange(linksToRemove);
        }

        HashSet<Guid> existingItemIds = existingLinks
            .Select(link => link.ItemId)
            .ToHashSet();

        List<CollectionItem> linksToAdd = change.Collection.ItemIds
            .Where(itemId => !existingItemIds.Contains(itemId))
            .Select(itemId => new CollectionItem
            {
                CollectionId = collection.Id,
                ItemId = itemId,
                AddedAt = utcNow
            })
            .ToList();

        if (linksToAdd.Count > 0)
        {
            db.CollectionItems.AddRange(linksToAdd);
        }
    }

    private void ReconcileItemKeywords(
        Item item,
        PlannedSeedItemChange change,
        Dictionary<string, Keyword> publicKeywordMap,
        DateTime utcNow)
    {
        item.ItemKeywords ??= [];

        HashSet<Guid> desiredKeywordIds =
        [
            change.Navigation.Nav1.Id,
            change.Navigation.Nav2.Id
        ];

        foreach (string keywordName in change.Item.Keywords)
        {
            if (publicKeywordMap.TryGetValue(keywordName, out Keyword? keyword))
            {
                desiredKeywordIds.Add(keyword.Id);
            }
        }

        List<ItemKeyword> linksToRemove = item.ItemKeywords
            .Where(link => !desiredKeywordIds.Contains(link.KeywordId))
            .ToList();

        if (linksToRemove.Count > 0)
        {
            db.ItemKeywords.RemoveRange(linksToRemove);
            foreach (ItemKeyword link in linksToRemove)
            {
                item.ItemKeywords.Remove(link);
            }
        }

        HashSet<Guid> existingKeywordIds = item.ItemKeywords
            .Select(link => link.KeywordId)
            .ToHashSet();

        foreach (Guid keywordId in desiredKeywordIds)
        {
            if (existingKeywordIds.Contains(keywordId))
            {
                continue;
            }

            ItemKeyword link = new()
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                KeywordId = keywordId,
                AddedAt = utcNow
            };

            db.ItemKeywords.Add(link);
            item.ItemKeywords.Add(link);
        }
    }

    private static SeedSyncAdmin.PreviewResponse ToPreviewResponse(
        SeedSyncPlan plan,
        SeedSyncAdmin.SourceContext sourceContext,
        int deltaPreviewLimit)
    {
        List<SeedSyncAdmin.ChangeResponse> deltaChanges = BuildDeltaChanges(plan, deltaPreviewLimit);

        return new SeedSyncAdmin.PreviewResponse(
            sourceContext.RepositoryOwner,
            sourceContext.RepositoryName,
            sourceContext.GitRef,
            sourceContext.ResolvedCommitSha,
            sourceContext.ItemsPath,
            sourceContext.SourceFileCount,
            sourceContext.CollectionsPath,
            sourceContext.CollectionSourceFileCount,
            plan.SeedSet,
            plan.TotalItemsInPayload,
            plan.ExistingItemCount,
            plan.AffectedItemCount,
            plan.CreateCount,
            plan.UpdateCount,
            plan.DeleteCount,
            plan.UnchangedCount,
            plan.TotalCollectionsInPayload,
            plan.ExistingCollectionCount,
            plan.AffectedCollectionCount,
            plan.CollectionCreateCount,
            plan.CollectionUpdateCount,
            plan.CollectionDeleteCount,
            plan.CollectionUnchangedCount,
            sourceContext.TotalFiles,
            sourceContext.ProcessedFiles,
            sourceContext.NextFileOffset,
            sourceContext.IsComplete,
            DurationMs: 0,
            plan.DeltaChangeCount > deltaChanges.Count,
            deltaChanges);
    }

    private static SeedSyncAdmin.ApplyResponse ToApplyResponse(
        SeedSyncPlan plan,
        SeedSyncAdmin.SourceContext sourceContext,
        int deltaPreviewLimit,
        SeedSyncRun? historyRun)
    {
        List<SeedSyncAdmin.ChangeResponse> deltaChanges = BuildDeltaChanges(plan, deltaPreviewLimit);

        return new SeedSyncAdmin.ApplyResponse(
            sourceContext.RepositoryOwner,
            sourceContext.RepositoryName,
            sourceContext.GitRef,
            sourceContext.ResolvedCommitSha,
            sourceContext.ItemsPath,
            sourceContext.SourceFileCount,
            sourceContext.CollectionsPath,
            sourceContext.CollectionSourceFileCount,
            plan.SeedSet,
            plan.TotalItemsInPayload,
            plan.ExistingItemCount,
            plan.AffectedItemCount,
            plan.CreateCount,
            plan.UpdateCount,
            plan.DeleteCount,
            plan.UnchangedCount,
            plan.TotalCollectionsInPayload,
            plan.ExistingCollectionCount,
            plan.AffectedCollectionCount,
            plan.CollectionCreateCount,
            plan.CollectionUpdateCount,
            plan.CollectionDeleteCount,
            plan.CollectionUnchangedCount,
            sourceContext.TotalFiles,
            sourceContext.ProcessedFiles,
            sourceContext.NextFileOffset,
            sourceContext.IsComplete,
            DurationMs: 0,
            historyRun?.Id,
            historyRun?.CreatedUtc,
            plan.DeltaChangeCount > deltaChanges.Count,
            deltaChanges);
    }

    private static List<SeedSyncAdmin.ChangeResponse> BuildDeltaChanges(
        SeedSyncPlan plan,
        int deltaPreviewLimit)
    {
        return plan.Changes
            .Where(change => change.ChangeKind != SeedSyncChangeKind.Unchanged)
            .Take(deltaPreviewLimit)
            .Select(change => new SeedSyncAdmin.ChangeResponse(
                change.Item.ItemId,
                change.ChangeKind switch
                {
                    SeedSyncChangeKind.Create => "Created",
                    SeedSyncChangeKind.Update => "Updated",
                    _ => "Unchanged"
                },
                change.Item.Category,
                change.Item.NavigationKeyword1,
                change.Item.NavigationKeyword2,
                change.Item.Question,
                change.ChangedFields))
            .ToList();
    }

    private static NormalizedSeedItem NormalizeItem(SeedSyncAdmin.SeedItemRequest item)
    {
        string category = CategoryHelper.NameToSlug(item.Category);
        string nav1 = KeywordHelper.NormalizeKeywordName(item.NavigationKeyword1).ToLowerInvariant();
        string nav2 = KeywordHelper.NormalizeKeywordName(item.NavigationKeyword2).ToLowerInvariant();
        string question = item.Question.Trim();
        string correctAnswer = item.CorrectAnswer.Trim();
        List<string> incorrectAnswers = item.IncorrectAnswers.Select(answer => answer.Trim()).ToList();
        string explanation = (item.Explanation ?? string.Empty).Trim();
        string? source = string.IsNullOrWhiteSpace(item.Source) ? null : item.Source.Trim();
        ItemSpeechSupport? questionSpeech = ItemSpeechSupportHelper.Normalize(item.QuestionSpeech, 1000);
        ItemSpeechSupport? correctAnswerSpeech = ItemSpeechSupportHelper.Normalize(item.CorrectAnswerSpeech, 500);
        Dictionary<int, ItemSpeechSupport> incorrectAnswerSpeech = ItemSpeechSupportHelper.NormalizeDictionary(
            item.IncorrectAnswerSpeech,
            incorrectAnswers.Count,
            500);
        List<string> keywords = NormalizeKeywords(item.Keywords, category, nav1, nav2);
        ItemImageReference? questionImage = ItemImageReferenceHelper.Normalize(item.QuestionImage);
        ItemImageReference? explanationImage = ItemImageReferenceHelper.Normalize(item.ExplanationImage);
        string? starterWorld = string.IsNullOrWhiteSpace(item.StarterWorld) ? null : item.StarterWorld.Trim();
        string? wowLine = string.IsNullOrWhiteSpace(item.WowLine) ? null : item.WowLine.Trim();

        return new NormalizedSeedItem(
            item.ItemId,
            category,
            nav1,
            nav2,
            question,
            questionSpeech,
            correctAnswer,
            correctAnswerSpeech,
            incorrectAnswers,
            incorrectAnswerSpeech,
            explanation,
            keywords,
            source,
            questionImage,
            explanationImage,
            starterWorld,
            wowLine);
    }

    private static NormalizedSeedCollection NormalizeCollection(SeedSyncAdmin.SeedCollectionRequest collection)
    {
        string name = collection.Name.Trim();
        string? description = string.IsNullOrWhiteSpace(collection.Description)
            ? null
            : collection.Description.Trim();

        return new NormalizedSeedCollection(
            collection.CollectionId,
            name,
            description,
            collection.ItemIds.Distinct().ToList());
    }

    private static List<string> NormalizeKeywords(
        IEnumerable<string>? rawKeywords,
        string category,
        string nav1,
        string nav2)
    {
        HashSet<string> seen = new(StringComparer.OrdinalIgnoreCase);
        List<string> normalized = [];

        if (rawKeywords is null)
        {
            return normalized;
        }

        foreach (string raw in rawKeywords)
        {
            string keyword = KeywordHelper.NormalizeKeywordName(raw).ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(keyword))
            {
                continue;
            }

            if (string.Equals(keyword, category, StringComparison.OrdinalIgnoreCase)
                || string.Equals(keyword, nav1, StringComparison.OrdinalIgnoreCase)
                || string.Equals(keyword, nav2, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!seen.Add(keyword))
            {
                continue;
            }

            normalized.Add(keyword);
        }

        normalized.Sort(StringComparer.OrdinalIgnoreCase);
        return normalized;
    }

    private static List<string> GetChangedFields(Item existingItem, NormalizedSeedItem incoming)
    {
        ExistingItemState existing = BuildExistingState(existingItem);
        List<string> changed = [];

        if (!string.Equals(existing.Category, incoming.Category, StringComparison.OrdinalIgnoreCase))
        {
            changed.Add("category");
        }

        if (!string.Equals(existing.NavigationKeyword1, incoming.NavigationKeyword1, StringComparison.OrdinalIgnoreCase))
        {
            changed.Add("navigationKeyword1");
        }

        if (!string.Equals(existing.NavigationKeyword2, incoming.NavigationKeyword2, StringComparison.OrdinalIgnoreCase))
        {
            changed.Add("navigationKeyword2");
        }

        if (!string.Equals(existing.Question, incoming.Question, StringComparison.Ordinal))
        {
            changed.Add("question");
        }

        if (!string.Equals(existing.CorrectAnswer, incoming.CorrectAnswer, StringComparison.Ordinal))
        {
            changed.Add("correctAnswer");
        }

        if (!ItemSpeechSupportHelper.AreEquivalent(existing.QuestionSpeech, incoming.QuestionSpeech))
        {
            changed.Add("questionSpeech");
        }

        if (!ItemSpeechSupportHelper.AreEquivalent(existing.CorrectAnswerSpeech, incoming.CorrectAnswerSpeech))
        {
            changed.Add("correctAnswerSpeech");
        }

        if (!existing.IncorrectAnswers.SequenceEqual(incoming.IncorrectAnswers))
        {
            changed.Add("incorrectAnswers");
        }

        if (!ItemSpeechSupportHelper.AreEquivalent(existing.IncorrectAnswerSpeech, incoming.IncorrectAnswerSpeech))
        {
            changed.Add("incorrectAnswerSpeech");
        }

        if (!string.Equals(existing.Explanation, incoming.Explanation, StringComparison.Ordinal))
        {
            changed.Add("explanation");
        }

        if (!string.Equals(existing.Source ?? string.Empty, incoming.Source ?? string.Empty, StringComparison.Ordinal))
        {
            changed.Add("source");
        }

        if (!existing.Keywords.SequenceEqual(incoming.Keywords))
        {
            changed.Add("keywords");
        }

        if (!string.Equals(existing.QuestionImage?.Key, incoming.QuestionImage?.Key, StringComparison.Ordinal)
            || !string.Equals(existing.QuestionImage?.AltText, incoming.QuestionImage?.AltText, StringComparison.Ordinal))
        {
            changed.Add("questionImage");
        }

        if (!string.Equals(existing.ExplanationImage?.Key, incoming.ExplanationImage?.Key, StringComparison.Ordinal)
            || !string.Equals(existing.ExplanationImage?.AltText, incoming.ExplanationImage?.AltText, StringComparison.Ordinal))
        {
            changed.Add("explanationImage");
        }

        if (!string.Equals(existing.StarterWorld, incoming.StarterWorld, StringComparison.Ordinal))
        {
            changed.Add("starterWorld");
        }

        if (!string.Equals(existing.WowLine, incoming.WowLine, StringComparison.Ordinal))
        {
            changed.Add("wowLine");
        }

        return changed;
    }

    private List<string> GetChangedFields(Collection existingCollection, NormalizedSeedCollection incoming)
    {
        List<string> changed = [];

        if (!string.Equals(existingCollection.Name.Trim(), incoming.Name, StringComparison.Ordinal))
        {
            changed.Add("name");
        }

        string existingDescription = string.IsNullOrWhiteSpace(existingCollection.Description)
            ? string.Empty
            : existingCollection.Description.Trim();
        string incomingDescription = incoming.Description ?? string.Empty;

        if (!string.Equals(existingDescription, incomingDescription, StringComparison.Ordinal))
        {
            changed.Add("description");
        }

        List<Guid> existingItemIds = db.CollectionItems
            .Where(link => link.CollectionId == existingCollection.Id)
            .OrderBy(link => link.ItemId)
            .Select(link => link.ItemId)
            .ToList();

        List<Guid> incomingItemIds = incoming.ItemIds
            .OrderBy(id => id)
            .ToList();

        if (!existingItemIds.SequenceEqual(incomingItemIds))
        {
            changed.Add("itemIds");
        }

        return changed;
    }

    private static ExistingItemState BuildExistingState(Item item)
    {
        string nav1 = item.NavigationKeyword1?.Name?.Trim().ToLowerInvariant() ?? string.Empty;
        string nav2 = item.NavigationKeyword2?.Name?.Trim().ToLowerInvariant() ?? string.Empty;

        List<string> extras = item.ItemKeywords
            .Select(link => link.Keyword?.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.Trim().ToLowerInvariant())
            .Where(name => !string.Equals(name, nav1, StringComparison.OrdinalIgnoreCase))
            .Where(name => !string.Equals(name, nav2, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ExistingItemState(
            CategoryHelper.NameToSlug(item.Category?.Name ?? string.Empty),
            nav1,
            nav2,
            item.Question.Trim(),
            ItemSpeechSupportHelper.Normalize(item.QuestionSpeech, 1000),
            item.CorrectAnswer.Trim(),
            ItemSpeechSupportHelper.Normalize(item.CorrectAnswerSpeech, 500),
            item.IncorrectAnswers.Select(answer => answer.Trim()).ToList(),
            ItemSpeechSupportHelper.NormalizeDictionary(item.IncorrectAnswerSpeech, item.IncorrectAnswers.Count, 500),
            item.Explanation.Trim(),
            string.IsNullOrWhiteSpace(item.Source) ? null : item.Source.Trim(),
            extras,
            ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt),
            ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt),
            item.StarterWorld,
            item.WowLine);
    }

    private static async Task TryRollbackAsync(
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

    private sealed record NormalizedSeedItem(
        Guid ItemId,
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        string Question,
        ItemSpeechSupport? QuestionSpeech,
        string CorrectAnswer,
        ItemSpeechSupport? CorrectAnswerSpeech,
        List<string> IncorrectAnswers,
        Dictionary<int, ItemSpeechSupport> IncorrectAnswerSpeech,
        string Explanation,
        List<string> Keywords,
        string? Source,
        ItemImageReference? QuestionImage,
        ItemImageReference? ExplanationImage,
        string? StarterWorld,
        string? WowLine);

    private sealed record ExistingItemState(
        string Category,
        string NavigationKeyword1,
        string NavigationKeyword2,
        string Question,
        ItemSpeechSupport? QuestionSpeech,
        string CorrectAnswer,
        ItemSpeechSupport? CorrectAnswerSpeech,
        List<string> IncorrectAnswers,
        Dictionary<int, ItemSpeechSupport> IncorrectAnswerSpeech,
        string Explanation,
        string? Source,
        List<string> Keywords,
        ItemImageReference? QuestionImage,
        ItemImageReference? ExplanationImage,
        string? StarterWorld,
        string? WowLine);

    private sealed record NormalizedSeedCollection(
        Guid CollectionId,
        string Name,
        string? Description,
        List<Guid> ItemIds);

    private sealed record ResolvedNavigationPath(
        Category Category,
        Keyword Nav1,
        Keyword Nav2);

    private sealed record PlannedSeedItemChange(
        NormalizedSeedItem Item,
        ResolvedNavigationPath Navigation,
        Item? ExistingItem,
        SeedSyncChangeKind ChangeKind,
        List<string> ChangedFields);

    private sealed record PlannedSeedCollectionChange(
        NormalizedSeedCollection Collection,
        Collection? ExistingCollection,
        SeedSyncChangeKind ChangeKind,
        List<string> ChangedFields);

    private sealed record SeedSyncPlan(
        string SeedSet,
        int TotalItemsInPayload,
        int ExistingItemCount,
        List<PlannedSeedItemChange> Changes,
        int TotalCollectionsInPayload,
        int ExistingCollectionCount,
        List<PlannedSeedCollectionChange> CollectionChanges)
    {
        public int CreateCount => Changes.Count(change => change.ChangeKind == SeedSyncChangeKind.Create);
        public int UpdateCount => Changes.Count(change => change.ChangeKind == SeedSyncChangeKind.Update);
        public int DeleteCount => Changes.Count(change => change.ChangeKind == SeedSyncChangeKind.Delete);
        public int UnchangedCount => Changes.Count(change => change.ChangeKind == SeedSyncChangeKind.Unchanged);
        public int DeltaChangeCount => Changes.Count(change => change.ChangeKind != SeedSyncChangeKind.Unchanged);
        public int AffectedItemCount => Changes.Count(change => change.ChangeKind != SeedSyncChangeKind.Unchanged);
        public int CollectionCreateCount => CollectionChanges.Count(change => change.ChangeKind == SeedSyncChangeKind.Create);
        public int CollectionUpdateCount => CollectionChanges.Count(change => change.ChangeKind == SeedSyncChangeKind.Update);
        public int CollectionDeleteCount => CollectionChanges.Count(change => change.ChangeKind == SeedSyncChangeKind.Delete);
        public int CollectionUnchangedCount => CollectionChanges.Count(change => change.ChangeKind == SeedSyncChangeKind.Unchanged);
        public int AffectedCollectionCount => CollectionChanges.Count(change => change.ChangeKind != SeedSyncChangeKind.Unchanged);
    }

    private enum SeedSyncChangeKind
    {
        Create,
        Update,
        Delete,
        Unchanged
    }

    private SeedSyncRun BuildHistoryRun(
        SeedSyncPlan plan,
        SeedSyncAdmin.SourceContext sourceContext,
        DateTime utcNow)
    {
        string? triggeredByUserId = string.IsNullOrWhiteSpace(_userContext.UserId)
            ? null
            : _userContext.UserId;

        SeedSyncRun run = new()
        {
            Id = Guid.NewGuid(),
            RepositoryOwner = sourceContext.RepositoryOwner,
            RepositoryName = sourceContext.RepositoryName,
            GitRef = sourceContext.GitRef,
            ResolvedCommitSha = sourceContext.ResolvedCommitSha,
            ItemsPath = sourceContext.ItemsPath,
            SeedSet = plan.SeedSet,
            SourceFileCount = sourceContext.SourceFileCount,
            TotalItemsInPayload = plan.TotalItemsInPayload,
            ExistingItemCount = plan.ExistingItemCount,
            CreatedCount = plan.CreateCount,
            UpdatedCount = plan.UpdateCount,
            DeletedCount = plan.DeleteCount,
            UnchangedCount = plan.UnchangedCount,
            TriggeredByUserId = triggeredByUserId,
            CreatedUtc = utcNow
        };

        List<SeedSyncItemHistory> histories = plan.Changes
            .Where(change => change.ChangeKind != SeedSyncChangeKind.Unchanged)
            .Select(change => new SeedSyncItemHistory
            {
                Id = Guid.NewGuid(),
                SeedSyncRunId = run.Id,
                ItemId = change.Item.ItemId,
                Action = change.ChangeKind switch
                {
                    SeedSyncChangeKind.Create => SeedSyncItemHistoryAction.Created,
                    SeedSyncChangeKind.Update => SeedSyncItemHistoryAction.Updated,
                    SeedSyncChangeKind.Delete => SeedSyncItemHistoryAction.Deleted,
                    _ => SeedSyncItemHistoryAction.Updated
                },
                Category = change.Item.Category,
                NavigationKeyword1 = change.Item.NavigationKeyword1,
                NavigationKeyword2 = change.Item.NavigationKeyword2,
                Question = change.Item.Question,
                ChangedFields = change.ChangedFields.ToList(),
                CreatedUtc = utcNow
            })
            .ToList();

        run.ItemHistories = histories;
        return run;
    }
}
