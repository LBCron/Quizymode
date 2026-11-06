namespace Quizymode.Api.Features.Media;

/// <summary>
/// Settings for private picture storage and normalization (AC 3.24, AC 7.7), bound from the <c>Media</c> section
/// (environment variables <c>Media__Storage__Provider</c>, <c>Media__S3__BucketName</c>, ...). The storage provider
/// defaults to <c>None</c> so the feature ships dark; every size, pixel, time and concurrency limit is an option.
/// </summary>
internal sealed class MediaOptions
{
    public const string SectionName = "Media";

    public const string ProviderNone = "None";
    public const string ProviderS3 = "S3";
    public const string ProviderFileSystem = "FileSystem";

    /// <summary>The static website bucket. It is synced with --delete on every deploy, so uploads must never go there.</summary>
    /// <summary>The Kestrel request-size backstop on POST /media/images is built from this value at startup, so raising `MaxSourceBytes` above it needs a code change.</summary>
    public const int DefaultMaxSourceBytes = 2 * 1024 * 1024;

    /// <summary>The database check constraint caps stored pictures at this size.</summary>
    public const int AbsoluteMaxOutputBytes = 100 * 1024;

    public const string ForbiddenWebBucket = "quizymode-web";

    public StorageSettings Storage { get; set; } = new();

    public S3Settings S3 { get; set; } = new();

    /// <summary>Largest accepted original file.</summary>
    public int MaxSourceBytes { get; set; } = DefaultMaxSourceBytes;

    /// <summary>Largest accepted width * height of the original.</summary>
    public long MaxPixels { get; set; } = 16_000_000;

    /// <summary>Largest accepted width or height of the original.</summary>
    public int MaxSide { get; set; } = 8192;

    /// <summary>Hard cap on the normalized WebP.</summary>
    public int MaxOutputBytes { get; set; } = 100 * 1024;

    /// <summary>A lossless re-encode of a PNG is kept when it is at most this large.</summary>
    public int LosslessKeepBytes { get; set; } = 50 * 1024;

    /// <summary>Longest side of the first normalized rendition.</summary>
    public int MaxOutputSide { get; set; } = 1280;

    /// <summary>Normalizations that may decode at the same time in this process.</summary>
    public int MaxConcurrentDecodes { get; set; } = 1;

    /// <summary>Requests allowed to queue for a decode slot; more are refused immediately with 503 Busy.</summary>
    public int MaxWaiters { get; set; } = 4;

    /// <summary>How long a request may wait for a decode slot before 503 Busy.</summary>
    public TimeSpan SemaphoreWaitTimeout { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>Total time one normalization may take (checked between decode, resize and every encode attempt).</summary>
    public TimeSpan ProcessingBudget { get; set; } = TimeSpan.FromSeconds(20);

    /// <summary>Upper bound for the storage write that follows the database insert.</summary>
    public TimeSpan StorageWriteTimeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>Kill switch: false makes uploads answer 503 Media.Disabled while reads keep working (AC 3.28).</summary>
    public bool UploadsEnabled { get; set; } = true;

    /// <summary>Uploads one account may attempt in any rolling 24 hours (failed attempts count).</summary>
    public int MaxUploadsPerUserPerDay { get; set; } = 20;

    /// <summary>Normalized bytes one account may retain (20 MiB).</summary>
    public long MaxRetainedBytesPerUser { get; set; } = 20L * 1024 * 1024;

    /// <summary>Items of one account that may await picture review at once.</summary>
    public int MaxPendingReviewsPerUser { get; set; } = 20;

    /// <summary>Global ceiling on uploads in any rolling 24 hours, across all accounts.</summary>
    public int MaxUploadsGlobalPerDay { get; set; } = 5000;

    /// <summary>Global ceiling on retained normalized bytes (2 GiB).</summary>
    public long MaxRetainedBytesGlobal { get; set; } = 2L * 1024 * 1024 * 1024;

    /// <summary>Returns a description of every invalid value (empty when valid).</summary>
    public IReadOnlyList<string> Validate()
    {
        List<string> errors = [];
        Require(MaxSourceBytes > 0 && MaxSourceBytes <= DefaultMaxSourceBytes, nameof(MaxSourceBytes));
        Require(MaxPixels > 0, nameof(MaxPixels));
        Require(MaxSide > 0, nameof(MaxSide));
        Require(MaxOutputBytes > 0 && MaxOutputBytes <= AbsoluteMaxOutputBytes, nameof(MaxOutputBytes));
        Require(LosslessKeepBytes >= 0, nameof(LosslessKeepBytes));
        Require(MaxOutputSide > 0, nameof(MaxOutputSide));
        Require(MaxConcurrentDecodes > 0, nameof(MaxConcurrentDecodes));
        Require(MaxWaiters >= 0, nameof(MaxWaiters));
        Require(SemaphoreWaitTimeout >= TimeSpan.Zero, nameof(SemaphoreWaitTimeout));
        Require(ProcessingBudget > TimeSpan.Zero, nameof(ProcessingBudget));
        Require(StorageWriteTimeout > TimeSpan.Zero, nameof(StorageWriteTimeout));
        Require(MaxUploadsPerUserPerDay > 0, nameof(MaxUploadsPerUserPerDay));
        Require(MaxRetainedBytesPerUser > 0, nameof(MaxRetainedBytesPerUser));
        Require(MaxPendingReviewsPerUser > 0, nameof(MaxPendingReviewsPerUser));
        Require(MaxUploadsGlobalPerDay > 0, nameof(MaxUploadsGlobalPerDay));
        Require(MaxRetainedBytesGlobal > 0, nameof(MaxRetainedBytesGlobal));
        return errors;

        void Require(bool condition, string name)
        {
            if (!condition)
            {
                errors.Add($"Media:{name} has an invalid value.");
            }
        }
    }

    internal sealed class StorageSettings
    {
        /// <summary>None (default, uploads answer 503), S3, or FileSystem (Development and Testing only).</summary>
        public string Provider { get; set; } = ProviderNone;
    }

    internal sealed class S3Settings
    {
        public string? BucketName { get; set; }

        public string Region { get; set; } = "us-east-1";

        /// <summary>Optional; with <see cref="SecretAccessKey"/> they are used instead of the default AWS credential chain.</summary>
        public string? AccessKeyId { get; set; }

        public string? SecretAccessKey { get; set; }
    }
}
