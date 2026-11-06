namespace Quizymode.Api.Shared.Models;

/// <summary>
/// First-hit attribution snapshot for one page-view session (TRAFFIC-122). Created once, on the
/// first <see cref="PageView"/> seen for a <see cref="SessionId"/>, and never modified afterward —
/// later hits in the same session do not change how it was acquired.
/// </summary>
public sealed class AnalyticsSession
{
    public Guid Id { get; set; }

    /// <summary>The same tab-scoped id the page-view tracker sends; one row per session.</summary>
    public string SessionId { get; set; } = string.Empty;

    /// <summary>
    /// Random id stored in the visitor's browser (localStorage) so a returning visitor across tabs
    /// and sessions can be recognized. Null when absent, invalid, or withheld (Global Privacy Control).
    /// </summary>
    public string? VisitorId { get; set; }

    public Guid? UserId { get; set; }

    public DateTime FirstSeenUtc { get; set; }

    /// <summary>App-relative path of the first hit in this session.</summary>
    public string LandingPath { get; set; } = string.Empty;

    /// <summary>Query string of the first hit in this session, including the leading '?' when present.</summary>
    public string LandingQuery { get; set; } = string.Empty;

    /// <summary>Host only of the first hit's referrer; null for same-site or absent referrers.</summary>
    public string? ReferrerHost { get; set; }

    public string? UtmSource { get; set; }

    public string? UtmMedium { get; set; }

    public string? UtmCampaign { get; set; }

    public string? UtmContent { get; set; }

    public string? UtmTerm { get; set; }

    /// <summary>
    /// Which ad platform's click-id param was present ("google", "microsoft", "tiktok").
    /// The raw click-id value itself is never stored.
    /// </summary>
    public string? ClickIdPlatform { get; set; }

    /// <summary>One of: paid, email, campaign, search, social, referral, direct.</summary>
    public string Channel { get; set; } = string.Empty;

    /// <summary>One of: mobile, tablet, desktop, unknown.</summary>
    public string DeviceClass { get; set; } = string.Empty;

    public string? Country { get; set; }

    /// <summary>Approximate region from the first hit's IP address; admin session review only, never rolled up.</summary>
    public string? Region { get; set; }

    /// <summary>Approximate city from the first hit's IP address; admin session review only, never rolled up.</summary>
    public string? City { get; set; }

    public string? AppVersion { get; set; }

    public DateTime CreatedUtc { get; set; }
}
