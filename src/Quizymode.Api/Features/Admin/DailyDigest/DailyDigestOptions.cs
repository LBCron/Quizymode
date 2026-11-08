namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>Configuration section <c>DailyDigest</c> (#509). The email settings live in the shared <c>Email</c> section.</summary>
internal sealed class DailyDigestOptions
{
    public const string SectionName = "DailyDigest";

    /// <summary>Turns the scheduler on. Default false (dev and tests). Preview, test send and ad hoc send work regardless.</summary>
    public bool Enabled { get; set; }

    /// <summary>IANA time zone id that defines the digest's calendar day.</summary>
    public string TimeZone { get; set; } = "America/Chicago";

    /// <summary>Local time of day the digest becomes due, HH:mm.</summary>
    public string SendAtLocalTime { get; set; } = "08:00";

    /// <summary>Base URL for the links in the email. Without it the links are omitted.</summary>
    public string? AdminBaseUrl { get; set; }
}
