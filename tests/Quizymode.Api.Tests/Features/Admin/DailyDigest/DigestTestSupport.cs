using Quizymode.Api.Shared.Email;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Tests.Features.Admin.DailyDigest;

/// <summary>A settable clock for scheduler, claim and endpoint tests.</summary>
internal sealed class FakeClock(DateTime utcNow) : TimeProvider
{
    public DateTime UtcNow { get; set; } = DateTime.SpecifyKind(utcNow, DateTimeKind.Utc);

    public override DateTimeOffset GetUtcNow() => new(UtcNow);
}

/// <summary>Records sends; Succeed and Configured can be flipped per test.</summary>
internal sealed class RecordingEmailSender : IEmailSender
{
    private readonly object _gate = new();

    public bool Configured { get; set; } = true;

    public bool Succeed { get; set; } = true;

    public bool IsConfigured => Configured;

    public List<(string Subject, string Body)> Sent { get; } = [];

    public int Calls { get; private set; }

    public Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            Calls++;
            if (!Configured || !Succeed)
            {
                return Task.FromResult(false);
            }

            Sent.Add((subject, body));
            return Task.FromResult(true);
        }
    }
}

/// <summary>Seed helpers for digest tests. Day D = 2026-11-06 in America/Chicago = [2026-11-06T06:00Z, 2026-11-07T06:00Z).</summary>
internal static class DigestSeed
{
    public static readonly DateTime Start = new(2026, 11, 6, 6, 0, 0, DateTimeKind.Utc);
    public static readonly DateTime End = new(2026, 11, 7, 6, 0, 0, DateTimeKind.Utc);

    public static PageView Hit(
        string sessionId,
        DateTime createdUtc,
        string path = "/",
        Guid? userId = null,
        bool isBot = false,
        bool isInternal = false,
        bool itemStep = false) => new()
    {
        Id = Guid.NewGuid(),
        SessionId = sessionId,
        UserId = userId,
        IsAuthenticated = userId is not null,
        IpAddress = "198.51.100.10",
        Path = path,
        QueryString = string.Empty,
        Url = path,
        UserAgent = "Mozilla/5.0",
        IsBot = isBot,
        IsInternal = isInternal,
        IsItemStep = itemStep,
        CreatedUtc = createdUtc
    };

    public static AnalyticsSession Session(
        string sessionId,
        DateTime firstSeenUtc,
        string? visitorId = null,
        string channel = "direct",
        string? referrerHost = null,
        string? utmSource = null,
        Guid? userId = null,
        string? appVersion = null) => new()
    {
        Id = Guid.NewGuid(),
        SessionId = sessionId,
        VisitorId = visitorId,
        UserId = userId,
        FirstSeenUtc = firstSeenUtc,
        LandingPath = "/",
        ReferrerHost = referrerHost,
        UtmSource = utmSource,
        Channel = channel,
        DeviceClass = "desktop",
        AppVersion = appVersion,
        CreatedUtc = firstSeenUtc
    };

    public static AnalyticsEvent Event(
        string name,
        string sessionId,
        string runId,
        DateTime occurredUtc,
        string contextType = "category",
        string contextId = "geography",
        int? score = null,
        int? total = null,
        bool isBot = false,
        bool isInternal = false) => new()
    {
        Id = Guid.NewGuid(),
        EventName = name,
        SessionId = sessionId,
        Path = "/",
        RunId = runId,
        ContextType = contextType,
        ContextId = contextId,
        Score = score,
        Total = total,
        IsBot = isBot,
        IsInternal = isInternal,
        OccurredUtc = occurredUtc
    };

    public static ClientError Error(string fingerprint, string sessionId, DateTime occurredUtc, bool isBot = false, bool isInternal = false) => new()
    {
        Id = Guid.NewGuid(),
        Fingerprint = fingerprint,
        Source = "window",
        ErrorName = "TypeError",
        Message = "message",
        Path = "/",
        SessionId = sessionId,
        DeviceClass = "desktop",
        IsBot = isBot,
        IsInternal = isInternal,
        OccurredUtc = occurredUtc
    };
}
