namespace Quizymode.Api.Shared.Models;

/// <summary>Durable transport allowance; contains counts only, never source content or filenames.</summary>
internal sealed class MediaIngressAttempt
{
    public Guid Id { get; set; }
    public string OwnerUserId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime LeaseUntil { get; set; }
    public DateTime? CompletedAt { get; set; }
    public long ReservedBytes { get; set; }
    public long ReceivedBytes { get; set; }
}
