using System.Text.Json;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Loads seed items from the local source registry (data/seed-source/items/) for admin local sync.
/// Reads all JSON files directly — no selection.json filtering applied.
/// </summary>
internal sealed class LocalSeedLoader(
    IWebHostEnvironment environment,
    ILogger<LocalSeedLoader> logger)
{
    private const string SourceRegistryRelativePath = "data/seed-source/items";

    private readonly IWebHostEnvironment _environment = environment;
    private readonly ILogger<LocalSeedLoader> _logger = logger;

    internal async Task<Result<LoadedLocalSeedManifest>> LoadManifestAsync(
        int deltaPreviewLimit,
        CancellationToken cancellationToken)
    {
        string? resolvedItemsPath = ResolveRegistryPath();
        if (resolvedItemsPath is null)
        {
            return Result.Failure<LoadedLocalSeedManifest>(
                Error.Validation(
                    "Admin.LocalRegistryNotFound",
                    $"Local source registry '{SourceRegistryRelativePath}' does not exist on this server. " +
                    "This endpoint is only available in development environments with the repository checked out."));
        }

        List<SeedSyncAdmin.SeedItemRequest> itemRequests = await LoadAllItemRequestsAsync(
            resolvedItemsPath, cancellationToken);

        if (itemRequests.Count == 0)
        {
            return Result.Failure<LoadedLocalSeedManifest>(
                Error.Validation("Admin.LocalRegistryEmpty", "No items found in the local source registry."));
        }

        int sourceFileCount = Directory.GetFiles(resolvedItemsPath, "*.json", SearchOption.AllDirectories).Length;

        SeedSyncAdmin.ManifestRequest manifest = new(
            SeedSet: "local-source-registry",
            Items: itemRequests,
            Collections: [],
            DeltaPreviewLimit: deltaPreviewLimit);

        SeedSyncAdmin.SourceContext sourceContext = new(
            RepositoryOwner: "local",
            RepositoryName: "source-registry",
            GitRef: "local",
            ResolvedCommitSha: "local",
            ItemsPath: resolvedItemsPath.Replace('\\', '/'),
            SourceFileCount: sourceFileCount,
            CollectionsPath: string.Empty,
            CollectionSourceFileCount: 0);

        return Result.Success(new LoadedLocalSeedManifest(manifest, sourceContext));
    }

    private string? ResolveRegistryPath()
    {
        string candidatePath = Path.GetFullPath(Path.Combine(_environment.ContentRootPath, SourceRegistryRelativePath));
        if (Directory.Exists(candidatePath))
        {
            return candidatePath;
        }

        DirectoryInfo? current = Directory.GetParent(_environment.ContentRootPath);
        while (current is not null)
        {
            candidatePath = Path.GetFullPath(Path.Combine(current.FullName, SourceRegistryRelativePath));
            if (Directory.Exists(candidatePath))
            {
                return candidatePath;
            }

            current = current.Parent;
        }

        return null;
    }

    private async Task<List<SeedSyncAdmin.SeedItemRequest>> LoadAllItemRequestsAsync(
        string resolvedItemsPath,
        CancellationToken cancellationToken)
    {
        string[] allFiles = Directory.GetFiles(resolvedItemsPath, "*.json", SearchOption.AllDirectories);
        Array.Sort(allFiles, StringComparer.OrdinalIgnoreCase);

        List<SeedSyncAdmin.SeedItemRequest> requests = [];
        foreach (string jsonFile in allFiles)
        {
            string fileJson = await File.ReadAllTextAsync(jsonFile, cancellationToken);
            List<RepoManagedItemSeedData>? items = JsonSerializer.Deserialize<List<RepoManagedItemSeedData>>(
                fileJson,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (items is null || items.Count == 0)
            {
                _logger.LogWarning("No items found in {FileName}", Path.GetFileName(jsonFile));
                continue;
            }

            foreach (RepoManagedItemSeedData? item in items)
            {
                if (item is null)
                {
                    // Pass null entries through so manifest validation rejects them with a clear message.
                    requests.Add(null!);
                    continue;
                }

                requests.Add(new SeedSyncAdmin.SeedItemRequest(
                    item.ItemId,
                    item.Category,
                    item.NavigationKeyword1,
                    item.NavigationKeyword2,
                    item.Question,
                    item.CorrectAnswer,
                    item.IncorrectAnswers,
                    item.Explanation,
                    item.Keywords,
                    item.Source,
                    item.QuestionSpeech,
                    item.CorrectAnswerSpeech,
                    item.IncorrectAnswerSpeech,
                    item.QuestionImage,
                    item.ExplanationImage,
                    item.StarterWorld,
                    item.WowLine,
                    item.IncorrectAnswerRationale));
            }
        }

        return requests;
    }
}

internal sealed record LoadedLocalSeedManifest(
    SeedSyncAdmin.ManifestRequest Manifest,
    SeedSyncAdmin.SourceContext SourceContext);
