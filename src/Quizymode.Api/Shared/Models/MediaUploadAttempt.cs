namespace Quizymode.Api.Shared.Models;
/// <summary>One bounded decode admission, including failed same-key retries; no source bytes, filenames or network data.</summary>
public sealed class MediaUploadAttempt
{
    public Guid Id { get; set; }
    public string OwnerUserId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
