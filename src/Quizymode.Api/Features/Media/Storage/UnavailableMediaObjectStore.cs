namespace Quizymode.Api.Features.Media.Storage;

/// <summary>Used when no storage is configured: the feature fails closed (uploads answer 503) and nothing is ever written.</summary>
internal sealed class UnavailableMediaObjectStore : IMediaObjectStore
{
    public bool IsAvailable => false;

    public Task<PutOutcome> PutIfAbsentAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken) =>
        throw new MediaStorageException("Media storage is not configured.");

    public Task<MediaObjectContent?> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        throw new MediaStorageException("Media storage is not configured.");
}
