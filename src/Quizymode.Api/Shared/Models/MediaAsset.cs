namespace Quizymode.Api.Shared.Models;

public enum MediaAssetState
{
    Processing,
    Ready,
    Failed
}

/// <summary>
/// A normalized picture uploaded by a signed-in user (AC 3.24). Only the normalized WebP is stored (in private object
/// storage under <see cref="ObjectKey"/>); the original upload is never persisted. Withdrawal is <see cref="DeletedAt"/>.
/// </summary>
public sealed class MediaAsset
{
    public Guid Id { get; set; }

    public string OwnerUserId { get; set; } = string.Empty;

    public MediaAssetState State { get; set; }

    /// <summary>Null until the object is stored; <c>normalized/v1/{assetId:N}/{sha256}.webp</c>.</summary>
    public string? ObjectKey { get; set; }

    /// <summary>Lowercase hex SHA-256 of the normalized bytes.</summary>
    public string Sha256 { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }

    /// <summary>Size of the normalized WebP.</summary>
    public int Bytes { get; set; }

    /// <summary>Always <c>webp</c>.</summary>
    public string Format { get; set; } = "webp";

    /// <summary>jpeg | png | webp: what was uploaded.</summary>
    public string SourceFormat { get; set; } = string.Empty;

    public int SourceBytes { get; set; }

    public int ProcessingVersion { get; set; }

    public string? FailureCode { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    public DateTime? DeletedAt { get; set; }
}
