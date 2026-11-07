using System.Text.RegularExpressions;

namespace Quizymode.Api.Features.Media.Storage;

/// <summary>
/// Private object storage for normalized pictures. Cleanup uses scoped delete/list operations only when explicitly enabled;
/// deployment permissions are verified separately from this interface.
/// </summary>
internal interface IMediaObjectStore
{
    /// <summary>False when no storage is configured (provider None, or a refused configuration).</summary>
    bool IsAvailable { get; }

    Task DeleteAsync(string key, CancellationToken cancellationToken) => throw new MediaStorageException("Deletion is not configured.");
    Task<MediaObjectPage> ListAsync(string? continuationToken, CancellationToken cancellationToken) => throw new MediaStorageException("Listing is not configured.");

    /// <summary>
    /// Writes <paramref name="content"/> at <paramref name="key"/> only if nothing exists there. An existing object is
    /// success (<see cref="PutOutcome.AlreadyExists"/>) and is never overwritten. Any other failure throws <see cref="MediaStorageException"/>.
    /// </summary>
    Task<PutOutcome> PutIfAbsentAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken);

    /// <summary>Opens the object, or returns null when it is missing or not readable by this principal. Other failures throw <see cref="MediaStorageException"/>.</summary>
    Task<MediaObjectContent?> OpenReadAsync(string key, CancellationToken cancellationToken);
}

internal enum PutOutcome
{
    Created,
    AlreadyExists
}

internal sealed class MediaStorageException(string message, Exception? innerException = null) : Exception(message, innerException);

/// <summary>An opened object; disposing it releases the underlying response or file handle.</summary>
internal sealed class MediaObjectContent(Stream stream, long length, IDisposable? owner = null) : IDisposable
{
    public Stream Stream { get; } = stream;

    public long Length { get; } = length;

    public void Dispose()
    {
        Stream.Dispose();
        owner?.Dispose();
    }
}

internal static partial class MediaObjectKey
{
    public const string ContentType = "image/webp";

    [GeneratedRegex("^normalized/v1/[0-9a-f]{32}/[0-9a-f]{64}\\.webp\\z", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();

    /// <summary>Immutable key: the asset id plus the hash of the stored bytes, so a key is never reused for different content.</summary>
    public static string Build(Guid assetId, string sha256) => $"normalized/v1/{assetId:N}/{sha256}.webp";

    public static bool IsValid(string? key) => key is not null && KeyPattern().IsMatch(key);

    public static void EnsureValid(string key)
    {
        if (!IsValid(key))
        {
            throw new MediaStorageException("The object key is not a valid media key.");
        }
    }
}

internal sealed record MediaObjectEntry(string Key, DateTime LastModified);
internal sealed record MediaObjectPage(IReadOnlyList<MediaObjectEntry> Objects, string? ContinuationToken);
