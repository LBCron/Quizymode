using Amazon;
using Amazon.Runtime;
using Amazon.S3;

namespace Quizymode.Api.Features.Media.Storage;

/// <summary>Chooses the storage provider and fails closed: any unsafe or incomplete configuration yields no storage.</summary>
internal static class MediaObjectStoreFactory
{
    internal const string TestingEnvironment = "Testing";

    /// <summary>Decides which provider is safe to use. Logs an error and returns None for a refused configuration.</summary>
    public static string ResolveProvider(MediaOptions options, IHostEnvironment environment, ILogger logger)
    {
        string requested = options.Storage.Provider?.Trim() ?? string.Empty;
        if (requested.Length == 0 || requested.Equals(MediaOptions.ProviderNone, StringComparison.OrdinalIgnoreCase))
        {
            return MediaOptions.ProviderNone;
        }

        if (requested.Equals(MediaOptions.ProviderS3, StringComparison.OrdinalIgnoreCase))
        {
            string bucket = options.S3.BucketName?.Trim() ?? string.Empty;
            if (bucket.Length == 0)
            {
                logger.LogError("Media storage provider S3 is selected but Media:S3:BucketName is empty; media uploads are disabled.");
                return MediaOptions.ProviderNone;
            }

            if (bucket.Equals(MediaOptions.ForbiddenWebBucket, StringComparison.OrdinalIgnoreCase))
            {
                logger.LogError("Media:S3:BucketName is the static website bucket, which is synced with --delete; media uploads are disabled.");
                return MediaOptions.ProviderNone;
            }

            return MediaOptions.ProviderS3;
        }

        if (requested.Equals(MediaOptions.ProviderFileSystem, StringComparison.OrdinalIgnoreCase))
        {
            if (environment.IsDevelopment() || environment.IsEnvironment(TestingEnvironment))
            {
                return MediaOptions.ProviderFileSystem;
            }

            logger.LogError("Media storage provider FileSystem is only allowed in Development and Testing; media uploads are disabled.");
            return MediaOptions.ProviderNone;
        }

        logger.LogError("Media storage provider {Provider} is not recognized; media uploads are disabled.", requested);
        return MediaOptions.ProviderNone;
    }

    public static IMediaObjectStore Create(MediaOptions options, IHostEnvironment environment, ILogger logger)
    {
        string provider = ResolveProvider(options, environment, logger);
        if (provider == MediaOptions.ProviderS3)
        {
            return CreateS3(options);
        }

        if (provider == MediaOptions.ProviderFileSystem)
        {
            return new FileSystemMediaObjectStore(Path.Combine(environment.ContentRootPath, ".media"));
        }

        return new UnavailableMediaObjectStore();
    }

    private static S3MediaObjectStore CreateS3(MediaOptions options)
    {
        AmazonS3Config config = new() { RegionEndpoint = RegionEndpoint.GetBySystemName(options.S3.Region) };
        bool hasKeys = !string.IsNullOrWhiteSpace(options.S3.AccessKeyId) && !string.IsNullOrWhiteSpace(options.S3.SecretAccessKey);

        // Namespaced credentials win; otherwise the SDK default chain applies. Neither is ever logged.
        AmazonS3Client client = hasKeys
            ? new AmazonS3Client(new BasicAWSCredentials(options.S3.AccessKeyId!.Trim(), options.S3.SecretAccessKey!.Trim()), config)
            : new AmazonS3Client(config);
        return new S3MediaObjectStore(client, options.S3.BucketName!.Trim());
    }
}
