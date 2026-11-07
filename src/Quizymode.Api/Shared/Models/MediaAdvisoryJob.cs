namespace Quizymode.Api.Shared.Models;
public sealed class MediaAdvisoryJob
{
    public string Id { get; set; } = string.Empty;
    public Guid ItemId { get; set; }
    public int Revision { get; set; }
    public string ContentHash { get; set; } = string.Empty;
    public string OwnerUserId { get; set; } = string.Empty;
    public string Provider { get; set; } = "Gemini";
    public string Model { get; set; } = string.Empty;
    public string PolicyVersion { get; set; } = string.Empty;
    public decimal ReservedCostUsd { get; set; }
    public decimal? EstimatedCostUsd { get; set; }
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    public string State { get; set; } = "Attempted";
    public string? ResultJson { get; set; }
    public string? FailureCode { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
