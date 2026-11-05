using System.Collections.Concurrent;

namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

/// <summary>
/// In-memory per-vendor cooldowns after HTTP 429 (AC 6.6). A rate-limited vendor is skipped until the reply's
/// <c>Retry-After</c> passes, or, when the reply says a daily quota ran out, until the next midnight Pacific time (when
/// Gemini's free quota resets). Without either hint the cooldown is <see cref="DefaultCooldown"/>. Every cooldown is capped
/// at <see cref="MaxCooldown"/> so a vendor is retried at least hourly. State is per process and resets on restart.
/// </summary>
internal sealed class LlmVendorCooldowns(TimeProvider timeProvider)
{
    public static readonly TimeSpan DefaultCooldown = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan MaxCooldown = TimeSpan.FromMinutes(60);

    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly ConcurrentDictionary<string, DateTimeOffset> _until = new(StringComparer.Ordinal);

    /// <summary>When the vendor's cooldown ends, or null when it is not cooling down.</summary>
    public DateTimeOffset? CoolingDownUntil(string vendor)
    {
        if (!_until.TryGetValue(vendor, out DateTimeOffset until))
        {
            return null;
        }

        if (until > _timeProvider.GetUtcNow())
        {
            return until;
        }

        _until.TryRemove(new KeyValuePair<string, DateTimeOffset>(vendor, until));
        return null;
    }

    public bool IsCoolingDown(string vendor) => CoolingDownUntil(vendor) is not null;

    /// <summary>Starts (or extends) the vendor's cooldown and returns when it ends.</summary>
    public DateTimeOffset Start(string vendor, TimeSpan? retryAfter, bool dailyQuotaExhausted)
    {
        DateTimeOffset now = _timeProvider.GetUtcNow();
        TimeSpan duration = retryAfter is TimeSpan hint && hint > TimeSpan.Zero
            ? hint
            : dailyQuotaExhausted
                ? UntilNextPacificMidnight(now)
                : DefaultCooldown;
        if (duration > MaxCooldown)
        {
            duration = MaxCooldown;
        }

        DateTimeOffset until = now + duration;
        return _until.AddOrUpdate(vendor, until, (_, existing) => existing > until ? existing : until);
    }

    internal static TimeSpan UntilNextPacificMidnight(DateTimeOffset now)
    {
        TimeZoneInfo pacific = FindPacific();
        DateTimeOffset local = TimeZoneInfo.ConvertTime(now, pacific);
        DateTime nextMidnight = local.Date.AddDays(1);
        DateTimeOffset nextMidnightUtc = new(nextMidnight, pacific.GetUtcOffset(nextMidnight));
        TimeSpan remaining = nextMidnightUtc - now;
        return remaining > TimeSpan.Zero ? remaining : DefaultCooldown;
    }

    private static TimeZoneInfo FindPacific()
    {
        foreach (string id in new[] { "America/Los_Angeles", "Pacific Standard Time" })
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out TimeZoneInfo? zone))
            {
                return zone;
            }
        }

        return TimeZoneInfo.CreateCustomTimeZone("PST", TimeSpan.FromHours(-8), "PST", "PST");
    }
}
