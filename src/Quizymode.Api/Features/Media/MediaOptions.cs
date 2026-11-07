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

    public int MaxUploadsPerHour { get; set; } = 20;
    public int MaxUploadsPerDay { get; set; } = 20;
    public int MaxPendingReviewItems { get; set; } = 20;
    public long MaxRetainedBytes { get; set; } = 20 * 1024 * 1024;
    public long MaxGlobalRetainedBytes { get; set; } = 1024L * 1024 * 1024;
    public int MaxGlobalUploads { get; set; } = 8;
    public int MaxGlobalIngress { get; set; } = 8;
    public long MaxIngressBytesPerDay { get; set; } = 44L * 1024 * 1024;
    public TimeSpan IngressReadTimeout { get; set; } = TimeSpan.FromSeconds(20);
    public bool CleanupAllOwnersApproved { get; set; }
    public bool CleanupEnabled { get; set; }
    public string? CleanupOwnerUserId { get; set; }
    public int UnattachedRetentionDays { get; set; } = 7;
    public int RejectedRetentionDays { get; set; } = 7;
    public int WithdrawnRetentionDays { get; set; } = 7;

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

    /// <summary>Global ceiling on upload admissions in any rolling 24 hours, across all accounts (AC 3.28.2).</summary>
    public int MaxUploadsGlobalPerDay { get; set; } = 5000;

    // Deprecated #405 option names. They are aliases for the MediaAdmission/MediaIngress options, so existing
    // Media__MaxUploadsPerUserPerDay-style settings keep working and cannot diverge from the enforced limits.

    /// <summary>Deprecated alias for <see cref="MaxUploadsPerDay"/>.</summary>
    public int MaxUploadsPerUserPerDay { get => MaxUploadsPerDay; set => MaxUploadsPerDay = value; }

    /// <summary>Deprecated alias for <see cref="MaxRetainedBytes"/>.</summary>
    public long MaxRetainedBytesPerUser { get => MaxRetainedBytes; set => MaxRetainedBytes = value; }

    /// <summary>Deprecated alias for <see cref="MaxPendingReviewItems"/>.</summary>
    public int MaxPendingReviewsPerUser { get => MaxPendingReviewItems; set => MaxPendingReviewItems = value; }

    /// <summary>Deprecated alias for <see cref="MaxGlobalRetainedBytes"/>.</summary>
    public long MaxRetainedBytesGlobal { get => MaxGlobalRetainedBytes; set => MaxGlobalRetainedBytes = value; }

    /// <summary>Returns a description of every invalid value (empty when valid).</summary>
    public IReadOnlyList<string> Validate()
    {
        List<string> errors = [];
        Require(MaxUploadsPerHour > 0 && MaxUploadsPerHour <= 20, nameof(MaxUploadsPerHour));
        Require(MaxUploadsPerDay > 0 && MaxUploadsPerDay <= 20, nameof(MaxUploadsPerDay));
        Require(MaxPendingReviewItems > 0 && MaxPendingReviewItems <= 20, nameof(MaxPendingReviewItems));
        Require(MaxRetainedBytes > 0 && MaxRetainedBytes <= 20 * 1024 * 1024, nameof(MaxRetainedBytes));
        Require(MaxGlobalRetainedBytes > 0, nameof(MaxGlobalRetainedBytes));
        Require(MaxGlobalIngress > 0 && MaxGlobalIngress <= 20, nameof(MaxGlobalIngress));
        Require(MaxIngressBytesPerDay >= (long)MaxSourceBytes + 64 * 1024 && MaxIngressBytesPerDay <= 44L * 1024 * 1024, nameof(MaxIngressBytesPerDay));
        Require(IngressReadTimeout > TimeSpan.Zero && IngressReadTimeout <= TimeSpan.FromSeconds(30), nameof(IngressReadTimeout));
        Require(MaxGlobalUploads > 0 && MaxGlobalUploads <= 20, nameof(MaxGlobalUploads));
        Require(UnattachedRetentionDays > 0 && UnattachedRetentionDays <= 7, nameof(UnattachedRetentionDays));
        Require(RejectedRetentionDays > 0 && RejectedRetentionDays <= 7, nameof(RejectedRetentionDays));
        Require(WithdrawnRetentionDays > 0 && WithdrawnRetentionDays <= 7, nameof(WithdrawnRetentionDays));
        Require(MaxSourceBytes > 0 && MaxSourceBytes <= DefaultMaxSourceBytes, nameof(MaxSourceBytes));
        Require(MaxPixels > 0, nameof(MaxPixels));
        Require(MaxSide > 0, nameof(MaxSide));
        Require(MaxOutputBytes > 0 && MaxOutputBytes <= AbsoluteMaxOutputBytes, nameof(MaxOutputBytes));
        Require(LosslessKeepBytes >= 0, nameof(LosslessKeepBytes));
        Require(MaxOutputSide > 0 && MaxOutputSide <= 1280, nameof(MaxOutputSide));
        Require(MaxConcurrentDecodes > 0, nameof(MaxConcurrentDecodes));
        Require(MaxWaiters >= 0, nameof(MaxWaiters));
        Require(SemaphoreWaitTimeout >= TimeSpan.Zero && SemaphoreWaitTimeout <= TimeSpan.FromSeconds(15), nameof(SemaphoreWaitTimeout));
        Require(ProcessingBudget > TimeSpan.Zero && ProcessingBudget <= TimeSpan.FromSeconds(30), nameof(ProcessingBudget));
        Require(StorageWriteTimeout > TimeSpan.Zero && StorageWriteTimeout <= TimeSpan.FromSeconds(45), nameof(StorageWriteTimeout));
        Require(MaxUploadsGlobalPerDay > 0, nameof(MaxUploadsGlobalPerDay));
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
