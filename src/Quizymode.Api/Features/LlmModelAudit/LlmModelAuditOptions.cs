namespace Quizymode.Api.Features.LlmModelAudit;

/// <summary>Configuration section <c>Llm:ModelAudit</c>.  Email settings live in the shared <c>Email</c> section.</summary>
internal sealed class LlmModelAuditOptions
{
    public const string SectionName = "Llm:ModelAudit";

    /// <summary>Turns the daily background job on. Default false (dev and tests). The manual endpoint works regardless.</summary>
    public bool Enabled { get; set; }

    /// <summary>Minimum minutes between manual runs.</summary>
    public int ManualRunCooldownMinutes { get; set; } = 10;
}
