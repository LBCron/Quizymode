namespace Quizymode.Api.Shared.Models;

/// <summary>
/// Admin-managed LLM routing (AC 5.12): the model per vendor and the ordered vendor fallback list per tier.
/// A single row (<see cref="SingletonId"/>), seeded with defaults on first read. API keys are never stored here.
/// </summary>
public sealed class LlmProviderSettings
{
    public const int SingletonId = 1;

    public int Id { get; set; } = SingletonId;

    /// <summary>Model per vendor (canonical vendor name → model id), stored as one JSON column so a new vendor needs no schema change.</summary>
    public Dictionary<string, string> Models { get; set; } = new(StringComparer.Ordinal);

    /// <summary>Comma-separated ordered vendor names for free-tier jobs.</summary>
    public string RouteFree { get; set; } = string.Empty;

    /// <summary>Comma-separated ordered vendor names for premium-tier jobs.</summary>
    public string RoutePremium { get; set; } = string.Empty;

    public DateTime UpdatedUtc { get; set; }
}

public enum LlmAttemptOutcome
{
    Success = 0,
    ProviderError = 1,
    Timeout = 2,
    ContentFilter = 3,
    LowQuoteYield = 4,
    InvalidJson = 5,

    /// <summary>The vendor rejected our API key (HTTP 401; 403 whose body indicates a key/credential problem; or 400 "API key not valid"). Stored as an int: never renumber.</summary>
    AuthError = 6,

    /// <summary>The vendor answered HTTP 429 (rate limit or quota exhausted); the vendor is put on a cooldown. Stored as an int: never renumber.</summary>
    RateLimited = 7
}

/// <summary>One vendor call made for a section generation (kept 90 days).</summary>
public sealed class LlmAttempt
{
    public Guid Id { get; set; }

    public Guid? GenerationId { get; set; }

    public string Vendor { get; set; } = string.Empty;

    public string Model { get; set; } = string.Empty;

    public LlmAttemptOutcome Outcome { get; set; }

    public int? InputTokens { get; set; }

    public int? OutputTokens { get; set; }

    public int DurationMs { get; set; }

    /// <summary>HTTP status of the vendor reply; null when no reply arrived (timeout, network error, no key) and for rows written before this column existed.</summary>
    public int? HttpStatus { get; set; }

    public DateTime CreatedUtc { get; set; }
}
