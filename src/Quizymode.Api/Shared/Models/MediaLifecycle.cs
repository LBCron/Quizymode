namespace Quizymode.Api.Shared.Models;

/// <summary>Durable admission reservation and request identity; contains no original bytes or file names.</summary>
public sealed class MediaUploadClaim
{
    public string Id { get; set; } = string.Empty;
    public string OwnerUserId { get; set; } = string.Empty;
    public string SourceSha256 { get; set; } = string.Empty;
    public Guid AssetId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LeaseUntil { get; set; }
    public string State { get; set; } = "Processing";
    public int Attempts { get; set; } = 1;
}

/// <summary>Minimal structured report, with a daily pseudonymous abuse key rather than raw network identifiers.</summary>
public sealed class MediaReport
{
    public Guid Id { get; set; }
    public Guid ItemId { get; set; }
    public Guid AssetId { get; set; }
    public int Revision { get; set; }
    public string Slot { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string AbuseKey { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

/// <summary>Independent durable emergency switches; withdrawal is never switchable.</summary>
public sealed class MediaControl
{
    public int Id { get; set; } = 1;
    [System.Text.Json.Serialization.JsonIgnore]
    public string ReportSalt { get; set; } = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    public string? CleanupCursor { get; set; }
    public bool UploadsEnabled { get; set; } = true;
    public bool DeliveryEnabled { get; set; } = true;
    public bool AdvisoryEnabled { get; set; }
    public DateTime UpdatedAt { get; set; }
}
