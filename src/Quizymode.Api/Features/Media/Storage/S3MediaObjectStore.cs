using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace Quizymode.Api.Features.Media.Storage;

/// <summary>
/// Private S3 bucket store. Writes use a conditional PutObject (<c>If-None-Match: *</c>) so an existing key is never overwritten.
/// The client is created by the caller only when the S3 provider is selected.
/// </summary>
internal sealed class S3MediaObjectStore(IAmazonS3 client, string bucketName) : IMediaObjectStore, IDisposable
{
    public bool IsAvailable => true;

    public async Task<PutOutcome> PutIfAbsentAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken)
    {
        MediaObjectKey.EnsureValid(key);
        try
        {
            using MemoryStream body = new(content, writable: false);
            await client.PutObjectAsync(
                new PutObjectRequest
                {
                    BucketName = bucketName,
                    Key = key,
                    InputStream = body,
                    ContentType = contentType,
                    IfNoneMatch = "*"
                },
                cancellationToken);
            return PutOutcome.Created;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.PreconditionFailed)
        {
            // 412: the key already holds an object. Keys embed the content hash, so this is an idempotent success.
            return PutOutcome.AlreadyExists;
        }
        catch (AmazonS3Exception ex)
        {
            // Includes 409 ConditionalRequestConflict (a concurrent write): surfaced as a storage failure, never as success.
            throw new MediaStorageException($"S3 PutObject failed ({(int)ex.StatusCode} {ex.ErrorCode}).", ex);
        }
        catch (Exception ex) when (ex is AmazonServiceException or AmazonClientException)
        {
            throw new MediaStorageException("S3 PutObject failed.", ex);
        }
    }

    public async Task<MediaObjectContent?> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        MediaObjectKey.EnsureValid(key);
        try
        {
            GetObjectResponse response = await client.GetObjectAsync(
                new GetObjectRequest { BucketName = bucketName, Key = key },
                cancellationToken);
            return new MediaObjectContent(response.ResponseStream, response.ContentLength, response);
        }
        catch (AmazonS3Exception ex) when (
            ex.StatusCode == HttpStatusCode.NotFound
            || ex.ErrorCode is "NoSuchKey" or "AccessDenied")
        {
            return null;
        }
        catch (Exception ex) when (ex is AmazonServiceException or AmazonClientException)
        {
            string code = (ex as AmazonServiceException)?.ErrorCode ?? ex.GetType().Name;
            throw new MediaStorageException($"S3 GetObject failed ({code}).", ex);
        }
    }

    public void Dispose() => client.Dispose();
}
