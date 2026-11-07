using System.Collections.Concurrent;
using Quizymode.Api.Features.Media.Storage;

namespace Quizymode.Api.Tests.Features.Media;

/// <summary>In-memory store with conditional-write semantics and hooks to simulate failures.</summary>
internal sealed class FakeMediaObjectStore : IMediaObjectStore
{
    public ConcurrentDictionary<string, byte[]> Objects { get; } = new();

    public bool Available { get; set; } = true;

    /// <summary>Thrown from <see cref="PutIfAbsentAsync"/> when set.</summary>
    public Exception? PutFailure { get; set; }

    /// <summary>Runs inside <see cref="PutIfAbsentAsync"/> before the write (for example to cancel the request or withdraw the asset).</summary>
    public Func<string, Task>? OnPut { get; set; }

    /// <summary>When set, <see cref="OpenReadAsync"/> returns null (missing or access denied) for every key.</summary>
    public bool ReadReturnsNull { get; set; }

    public bool IsAvailable => Available;
    public Func<string, Task>? OnDelete { get; set; }
    public async Task DeleteAsync(string key, CancellationToken ct) { MediaObjectKey.EnsureValid(key); if (OnDelete is not null) await OnDelete(key); Objects.TryRemove(key, out _); }
    public Task<MediaObjectPage> ListAsync(string? continuationToken, CancellationToken ct) => Task.FromResult(new MediaObjectPage(Objects.Keys.Select(key => new MediaObjectEntry(key, DateTime.UtcNow)).ToList(), null));

    public async Task<PutOutcome> PutIfAbsentAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        MediaObjectKey.EnsureValid(key);
        if (OnPut is not null)
        {
            await OnPut(key);
        }

        if (PutFailure is not null)
        {
            throw PutFailure;
        }

        return Objects.TryAdd(key, content) ? PutOutcome.Created : PutOutcome.AlreadyExists;
    }

    public Task<MediaObjectContent?> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        MediaObjectKey.EnsureValid(key);
        if (ReadReturnsNull || !Objects.TryGetValue(key, out byte[]? content))
        {
            return Task.FromResult<MediaObjectContent?>(null);
        }

        return Task.FromResult<MediaObjectContent?>(new MediaObjectContent(new MemoryStream(content, writable: false), content.Length));
    }
}
