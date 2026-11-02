namespace Quizymode.Api.Features.Media.Storage;

/// <summary>Development and Testing only: stores objects under <c>&lt;ContentRoot&gt;/.media</c>.</summary>
internal sealed class FileSystemMediaObjectStore : IMediaObjectStore
{
    private readonly string _root;

    public FileSystemMediaObjectStore(string rootDirectory)
    {
        _root = Path.GetFullPath(rootDirectory);
    }

    public bool IsAvailable => true;

    public async Task<PutOutcome> PutIfAbsentAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        string path = ResolvePath(key);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using FileStream stream = new(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            await stream.WriteAsync(content, cancellationToken);
            return PutOutcome.Created;
        }
        catch (IOException) when (File.Exists(path))
        {
            return PutOutcome.AlreadyExists;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MediaStorageException("The media file could not be written.", ex);
        }
    }

    public Task<MediaObjectContent?> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        string path = ResolvePath(key);
        try
        {
            FileStream stream = new(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            return Task.FromResult<MediaObjectContent?>(new MediaObjectContent(stream, stream.Length));
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return Task.FromResult<MediaObjectContent?>(null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MediaStorageException("The media file could not be read.", ex);
        }
    }

    private string ResolvePath(string key)
    {
        MediaObjectKey.EnsureValid(key);
        string path = Path.GetFullPath(Path.Combine(_root, key));
        if (!path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new MediaStorageException("The object key resolves outside the media root.");
        }

        return path;
    }
}
