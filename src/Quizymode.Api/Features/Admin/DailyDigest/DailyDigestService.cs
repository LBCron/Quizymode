using System.Text.Json;
using Microsoft.Extensions.Options;
using Quizymode.Api.Shared.Email;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>
/// Runs the scheduled digest (claim, compute once, persist, send, record) and builds previews, test sends and ad hoc sends (#509).
/// A scheduled attempt never throws for an expected failure; it records the outcome in <c>DailyDigestRuns</c> instead.
/// </summary>
internal sealed class DailyDigestService(
    DailyDigestComposer composer,
    DailyDigestRunStore store,
    IEmailSender email,
    IOptions<DailyDigestOptions> options,
    TimeProvider timeProvider,
    ILogger<DailyDigestService> logger)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal sealed record Schedule(TimeZoneInfo Zone, TimeOnly SendAt);

    internal sealed record Rendered(string Subject, string Body);

    /// <summary>The configured schedule, or the reason it is unusable.</summary>
    internal static bool TryGetSchedule(DailyDigestOptions config, out Schedule? schedule, out string? reason)
    {
        schedule = null;
        TimeZoneInfo? zone = DailyDigestWindow.TryFindZone(config.TimeZone);
        if (zone is null)
        {
            reason = "InvalidTimeZone";
            return false;
        }

        if (!DailyDigestWindow.TryParseSendAt(config.SendAtLocalTime, out TimeOnly sendAt))
        {
            reason = "InvalidSendAtLocalTime";
            return false;
        }

        schedule = new Schedule(zone, sendAt);
        reason = null;
        return true;
    }

    internal static string Serialize(DigestReport report) => JsonSerializer.Serialize(report, Json);

    internal static DigestReport Deserialize(string json) =>
        JsonSerializer.Deserialize<DigestReport>(json, Json) ?? throw new InvalidOperationException("Empty digest summary.");

    internal Rendered Render(DigestReport report, bool testSend = false, bool interruptedResend = false) =>
        new(DailyDigestRenderer.Subject(report, testSend, interruptedResend), DailyDigestRenderer.Body(report, options.Value.AdminBaseUrl));

    /// <summary>One scheduler tick: records missed days, then sends the digest that is due, if any.</summary>
    internal async Task TickAsync(CancellationToken cancellationToken)
    {
        DailyDigestOptions config = options.Value;
        if (!config.Enabled)
        {
            await store.MarkDisabledAsync(cancellationToken);
            return;
        }

        if (!TryGetSchedule(config, out Schedule? schedule, out _) || schedule is null)
        {
            return;
        }

        DateTime now = timeProvider.GetUtcNow().UtcDateTime;
        DateTime enabledSince = await store.MarkEnabledAsync(cancellationToken);
        await store.RecordMissedAsync(schedule.Zone, schedule.SendAt, enabledSince, cancellationToken);

        if (DailyDigestWindow.DueReportDate(now, schedule.Zone, schedule.SendAt) is not { } reportDate)
        {
            return;
        }

        (DateTime start, DateTime end) = DailyDigestWindow.ForDate(reportDate, schedule.Zone);
        DateTime stale = DailyDigestWindow.StaleUtc(reportDate, schedule.Zone, schedule.SendAt);
        DailyDigestRunStore.Claim? claim = await store.TryClaimAsync(reportDate, start, end, schedule.Zone.Id, stale, cancellationToken);
        if (claim is null)
        {
            return;
        }

        await RunClaimAsync(claim, schedule, cancellationToken);
    }

    private async Task RunClaimAsync(DailyDigestRunStore.Claim claim, Schedule schedule, CancellationToken cancellationToken)
    {
        DateTime now = timeProvider.GetUtcNow().UtcDateTime;
        string date = claim.ReportDate.ToString("yyyy-MM-dd");

        DigestReport report;
        if (claim.SummaryJson is not null)
        {
            report = Deserialize(claim.SummaryJson);
        }
        else
        {
            try
            {
                report = await composer.ComposeDailyAsync(claim.ReportDate, schedule.Zone, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("DailyDigest: compute failed {ReportDate} {ErrorType}", date, ex.GetType().Name);
                await store.FailAsync(claim, "ComputeFailed", now + DailyDigestRunStore.NotConfiguredRetry, cancellationToken);
                return;
            }

            if (report.AllUnavailable)
            {
                logger.LogWarning("DailyDigest: compute failed {ReportDate} {ErrorType}", date, "AllSectionsUnavailable");
                await store.FailAsync(claim, "ComputeFailed", now + DailyDigestRunStore.NotConfiguredRetry, cancellationToken);
                return;
            }

            if (!await store.PersistSummaryAsync(claim, Serialize(report), cancellationToken))
            {
                logger.LogWarning("DailyDigest: lost claim {ReportDate}", date);
                return;
            }
        }

        if (!email.IsConfigured)
        {
            logger.LogWarning("DailyDigest: not configured {ReportDate}", date);
            await store.FailAsync(claim, "NotConfigured", now + DailyDigestRunStore.NotConfiguredRetry, cancellationToken);
            return;
        }

        if (!await store.BeginSendAsync(claim, cancellationToken))
        {
            logger.LogWarning("DailyDigest: lost claim {ReportDate}", date);
            return;
        }

        int attempt = claim.Attempts + 1;
        Rendered message = Render(report, interruptedResend: claim.InterruptedResend);
        bool sent = await email.SendToAdminAsync(message.Subject, message.Body, cancellationToken);
        if (sent)
        {
            if (!await store.CompleteSentAsync(claim, cancellationToken))
            {
                logger.LogWarning("DailyDigest: lost claim {ReportDate}", date);
                return;
            }

            logger.LogInformation("DailyDigest: sent {ReportDate}", date);
            return;
        }

        TimeSpan? delay = DailyDigestRunStore.RetryDelay(attempt);
        DateTime? next = delay is { } wait ? timeProvider.GetUtcNow().UtcDateTime + wait : null;
        logger.LogWarning("DailyDigest: send failed {ReportDate} {Attempt} {ErrorType}", date, attempt, "SmtpError");
        await store.FailAsync(claim, "SmtpError", next, cancellationToken);
    }

    /// <summary>
    /// Sends a window digest now to the configured admin address. The scheduled row of any day is untouched; the send is
    /// recorded as its own ad hoc row. Returns the run id and outcome status.
    /// </summary>
    internal async Task<(Guid RunId, string Status)> SendAdHocAsync(
        DateTime fromUtc,
        DateTime toUtc,
        TimeZoneInfo zone,
        Guid? requestedByUserId,
        CancellationToken cancellationToken)
    {
        DateOnly localStart = DailyDigestWindow.LocalDate(fromUtc, zone);
        DailyDigestRunStore.Claim claim = await store.CreateAdHocAsync(localStart, fromUtc, toUtc, zone.Id, requestedByUserId, cancellationToken);

        if (!email.IsConfigured)
        {
            await store.FailAsync(claim, "NotConfigured", null, cancellationToken);
            return (claim.Id, DailyDigestRunStatus.Failed);
        }

        DigestReport report;
        try
        {
            report = await composer.ComposeWindowAsync(fromUtc, toUtc, zone, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("DailyDigest: ad hoc compute failed {ErrorType}", ex.GetType().Name);
            await store.FailAsync(claim, "ComputeFailed", null, cancellationToken);
            return (claim.Id, DailyDigestRunStatus.Failed);
        }

        if (report.AllUnavailable)
        {
            await store.FailAsync(claim, "ComputeFailed", null, cancellationToken);
            return (claim.Id, DailyDigestRunStatus.Failed);
        }

        await store.PersistSummaryAsync(claim, Serialize(report), cancellationToken);
        await store.BeginSendAsync(claim, cancellationToken);
        Rendered message = Render(report);
        if (await email.SendToAdminAsync(message.Subject, message.Body, cancellationToken))
        {
            await store.CompleteSentAsync(claim, cancellationToken);
            logger.LogInformation("DailyDigest: ad hoc sent");
            return (claim.Id, DailyDigestRunStatus.Sent);
        }

        logger.LogWarning("DailyDigest: ad hoc send failed {ErrorType}", "SmtpError");
        await store.FailAsync(claim, "SmtpError", null, cancellationToken);
        return (claim.Id, DailyDigestRunStatus.Failed);
    }

    internal Task<DigestReport> PreviewAsync(DateOnly reportDate, TimeZoneInfo zone, CancellationToken cancellationToken) =>
        composer.ComposeDailyAsync(reportDate, zone, cancellationToken);

    internal Task<bool> SendTestAsync(Rendered message, CancellationToken cancellationToken) =>
        email.SendToAdminAsync(message.Subject, message.Body, cancellationToken);

    internal bool EmailConfigured => email.IsConfigured;
}
