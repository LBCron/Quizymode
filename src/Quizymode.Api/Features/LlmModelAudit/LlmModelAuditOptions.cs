namespace Quizymode.Api.Features.LlmModelAudit;

/// <summary>Configuration section <c>Llm:ModelAudit</c>. Secrets (SMTP password) come only from environment or secret config.</summary>
internal sealed class LlmModelAuditOptions
{
    public const string SectionName = "Llm:ModelAudit";

    /// <summary>Turns the daily background job on. Default false (dev and tests). The manual endpoint works regardless.</summary>
    public bool Enabled { get; set; }

    /// <summary>Minimum minutes between manual runs.</summary>
    public int ManualRunCooldownMinutes { get; set; } = 10;

    public string? AdminAddress { get; set; }

    public string? From { get; set; }

    public SmtpOptions Smtp { get; set; } = new();

    internal sealed class SmtpOptions
    {
        public string? Host { get; set; }

        public int Port { get; set; } = 587;

        public string? UserName { get; set; }

        public string? Password { get; set; }
    }
}
