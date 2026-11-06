namespace Quizymode.Api.Shared.Models;

public enum LlmModelFindingKind
{
    /// <summary>The model configured for the vendor is not in the vendor's model list.</summary>
    ModelMissing = 0
}

public enum LlmModelFindingStatus
{
    Open = 0,
    Resolved = 1
}

/// <summary>One detected problem with a configured vendor model (#480). Enums are stored as strings; partial unique index on open (Vendor, Model).</summary>
public sealed class LlmModelFinding
{
    public Guid Id { get; set; }

    public string Vendor { get; set; } = string.Empty;

    public string Model { get; set; } = string.Empty;

    public LlmModelFindingKind Kind { get; set; }

    public LlmModelFindingStatus Status { get; set; }

    public DateTime FirstSeenUtc { get; set; }

    public DateTime LastSeenUtc { get; set; }

    public DateTime? ResolvedUtc { get; set; }

    /// <summary>Set only after the admin email containing this finding was sent successfully.</summary>
    public DateTime? NotifiedUtc { get; set; }
}
