using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>
/// Claim, retry and missed-run bookkeeping for <c>DailyDigestRuns</c> (#509). A claim is one insert (unique per scheduled
/// report date) or one conditional update, and every later write is conditional on the row id and its claim token, so two
/// workers can never both own a digest. Writes return false when the claim was lost; the caller must then not send.
/// </summary>
internal sealed class DailyDigestRunStore(ApplicationDbContext db, TimeProvider timeProvider)
{
    internal const int MaxAttempts = 4;

    /// <summary>Longer than compute plus the SMTP timeout; renewed after compute and before the send.</summary>
    internal static readonly TimeSpan Lease = TimeSpan.FromMinutes(30);

    internal static readonly TimeSpan NotConfiguredRetry = TimeSpan.FromHours(1);

    private const string StateKind = "State";
    private const string StateEnabled = "Enabled";
    private const string StateDisabled = "Disabled";
    private const int MissedLookbackDays = 14;
    private static readonly Guid StateId = new("0d1635e5-0000-4000-8000-000000000509");

    internal sealed record Claim(Guid Id, Guid Token, DateOnly ReportDate, bool InterruptedResend, string? SummaryJson, int Attempts);

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    /// <summary>Delay before the next send attempt after <paramref name="attemptsMade"/> definite failures; null when no more are allowed.</summary>
    internal static TimeSpan? RetryDelay(int attemptsMade) => attemptsMade switch
    {
        1 => TimeSpan.FromMinutes(15),
        2 => TimeSpan.FromHours(1),
        3 => TimeSpan.FromHours(3),
        _ => null
    };

    /// <summary>
    /// Claims the scheduled digest for <paramref name="reportDate"/>: inserts it, or takes over a failed row that is due for a
    /// retry or a sending row whose lease expired. Takeover is refused once the digest is stale.
    /// </summary>
    internal async Task<Claim?> TryClaimAsync(
        DateOnly reportDate,
        DateTime windowStartUtc,
        DateTime windowEndUtc,
        string timeZone,
        DateTime staleUtc,
        CancellationToken cancellationToken)
    {
        DateTime now = Now;
        Guid token = Guid.NewGuid();
        DailyDigestRun row = new()
        {
            Id = Guid.NewGuid(),
            Kind = DailyDigestRunKind.Scheduled,
            ReportDate = reportDate,
            TimeZone = timeZone,
            WindowStartUtc = windowStartUtc,
            WindowEndUtc = windowEndUtc,
            Status = DailyDigestRunStatus.Sending,
            ClaimToken = token,
            LeaseUntilUtc = now + Lease,
            CreatedUtc = now
        };

        db.DailyDigestRuns.Add(row);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return new Claim(row.Id, token, reportDate, false, null, 0);
        }
        catch (DbUpdateException)
        {
            db.Entry(row).State = EntityState.Detached;
        }

        DailyDigestRun? existing = await FindScheduledAsync(reportDate, cancellationToken);
        if (existing is null)
        {
            throw new InvalidOperationException("Could not claim or find the scheduled digest row.");
        }

        if (now >= staleUtc)
        {
            return null;
        }

        if (existing.Status == DailyDigestRunStatus.Sending && existing.LeaseUntilUtc is { } lease && lease < now)
        {
            // An expired lease means the process died mid-send. It becomes a failed attempt; one resend is allowed.
            int expired = await db.DailyDigestRuns
                .Where(run => run.Id == existing.Id && run.ClaimToken == existing.ClaimToken && run.Status == DailyDigestRunStatus.Sending && run.LeaseUntilUtc < now)
                .ExecuteUpdateAsync(
                    set => set
                        .SetProperty(run => run.Status, DailyDigestRunStatus.Failed)
                        .SetProperty(run => run.LastError, "Interrupted")
                        .SetProperty(run => run.NextAttemptUtc, existing.InterruptedResendUsed ? (DateTime?)null : now)
                        .SetProperty(run => run.LeaseUntilUtc, (DateTime?)null),
                    cancellationToken);
            if (expired == 0)
            {
                return null;
            }

            existing = await FindScheduledAsync(reportDate, cancellationToken);
            if (existing is null)
            {
                return null;
            }
        }

        if (existing.Status != DailyDigestRunStatus.Failed
            || existing.NextAttemptUtc is not { } next
            || next > now
            || existing.Attempts >= MaxAttempts)
        {
            return null;
        }

        bool interrupted = existing.LastError == "Interrupted";
        bool resendUsed = existing.InterruptedResendUsed || interrupted;
        Guid newToken = Guid.NewGuid();
        int taken = await db.DailyDigestRuns
            .Where(run => run.Id == existing.Id && run.ClaimToken == existing.ClaimToken && run.Status == DailyDigestRunStatus.Failed)
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(run => run.Status, DailyDigestRunStatus.Sending)
                    .SetProperty(run => run.ClaimToken, newToken)
                    .SetProperty(run => run.LeaseUntilUtc, now + Lease)
                    .SetProperty(run => run.NextAttemptUtc, (DateTime?)null)
                    .SetProperty(run => run.InterruptedResendUsed, resendUsed),
                cancellationToken);
        return taken == 1
            ? new Claim(existing.Id, newToken, reportDate, resendUsed, existing.SummaryJson, existing.Attempts)
            : null;
    }

    /// <summary>Stores the computed aggregates before the first send, so any resend uses the same numbers, and renews the lease.</summary>
    internal async Task<bool> PersistSummaryAsync(Claim claim, string summaryJson, CancellationToken cancellationToken)
    {
        DateTime now = Now;
        return await db.DailyDigestRuns
            .Where(run => run.Id == claim.Id && run.ClaimToken == claim.Token)
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(run => run.SummaryJson, summaryJson)
                    .SetProperty(run => run.ComputedUtc, now)
                    .SetProperty(run => run.LeaseUntilUtc, now + Lease),
                cancellationToken) == 1;
    }

    /// <summary>Counts the attempt and renews the lease right before the SMTP call.</summary>
    internal async Task<bool> BeginSendAsync(Claim claim, CancellationToken cancellationToken)
    {
        DateTime now = Now;
        return await db.DailyDigestRuns
            .Where(run => run.Id == claim.Id && run.ClaimToken == claim.Token)
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(run => run.Attempts, run => run.Attempts + 1)
                    .SetProperty(run => run.LeaseUntilUtc, now + Lease),
                cancellationToken) == 1;
    }

    internal async Task<bool> CompleteSentAsync(Claim claim, CancellationToken cancellationToken)
    {
        DateTime now = Now;
        return await db.DailyDigestRuns
            .Where(run => run.Id == claim.Id && run.ClaimToken == claim.Token)
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(run => run.Status, DailyDigestRunStatus.Sent)
                    .SetProperty(run => run.SentUtc, now)
                    .SetProperty(run => run.LastError, (string?)null)
                    .SetProperty(run => run.NextAttemptUtc, (DateTime?)null)
                    .SetProperty(run => run.LeaseUntilUtc, (DateTime?)null),
                cancellationToken) == 1;
    }

    /// <summary>Records a failed attempt (error type only) and when the next one is allowed; null stops retrying.</summary>
    internal async Task<bool> FailAsync(Claim claim, string errorType, DateTime? nextAttemptUtc, CancellationToken cancellationToken)
    {
        return await db.DailyDigestRuns
            .Where(run => run.Id == claim.Id && run.ClaimToken == claim.Token)
            .ExecuteUpdateAsync(
                set => set
                    .SetProperty(run => run.Status, DailyDigestRunStatus.Failed)
                    .SetProperty(run => run.LastError, errorType)
                    .SetProperty(run => run.NextAttemptUtc, nextAttemptUtc)
                    .SetProperty(run => run.LeaseUntilUtc, (DateTime?)null),
                cancellationToken) == 1;
    }

    /// <summary>Creates an ad hoc row (never blocked by, and never touching, the scheduled row of the same day).</summary>
    internal async Task<Claim> CreateAdHocAsync(
        DateOnly reportDate,
        DateTime windowStartUtc,
        DateTime windowEndUtc,
        string timeZone,
        Guid? requestedByUserId,
        CancellationToken cancellationToken)
    {
        DateTime now = Now;
        DailyDigestRun row = new()
        {
            Id = Guid.NewGuid(),
            Kind = DailyDigestRunKind.AdHoc,
            ReportDate = reportDate,
            TimeZone = timeZone,
            WindowStartUtc = windowStartUtc,
            WindowEndUtc = windowEndUtc,
            Status = DailyDigestRunStatus.Sending,
            ClaimToken = Guid.NewGuid(),
            LeaseUntilUtc = now + Lease,
            RequestedByUserId = requestedByUserId,
            CreatedUtc = now
        };
        db.DailyDigestRuns.Add(row);
        await db.SaveChangesAsync(cancellationToken);
        return new Claim(row.Id, row.ClaimToken, reportDate, false, null, 0);
    }

    /// <summary>When the latest ad hoc send was requested, for the one-per-minute limit (restart safe).</summary>
    internal async Task<DateTime?> LastAdHocCreatedUtcAsync(CancellationToken cancellationToken) =>
        await db.DailyDigestRuns.AsNoTracking()
            .Where(run => run.Kind == DailyDigestRunKind.AdHoc)
            .MaxAsync(run => (DateTime?)run.CreatedUtc, cancellationToken);

    /// <summary>Marks the digest enabled; returns when this enabled period began.</summary>
    internal async Task<DateTime> MarkEnabledAsync(CancellationToken cancellationToken)
    {
        DateTime now = Now;
        DailyDigestRun? state = await db.DailyDigestRuns.AsNoTracking().FirstOrDefaultAsync(run => run.Id == StateId, cancellationToken);
        if (state is null)
        {
            db.DailyDigestRuns.Add(NewState(now));
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // Another instance created it first.
                db.ChangeTracker.Clear();
                state = await db.DailyDigestRuns.AsNoTracking().FirstAsync(run => run.Id == StateId, cancellationToken);
                return state.WindowStartUtc;
            }

            return now;
        }

        if (state.Status == StateDisabled)
        {
            await db.DailyDigestRuns
                .Where(run => run.Id == StateId && run.Status == StateDisabled)
                .ExecuteUpdateAsync(
                    set => set
                        .SetProperty(run => run.Status, StateEnabled)
                        .SetProperty(run => run.WindowStartUtc, now),
                    cancellationToken);
            return now;
        }

        return state.WindowStartUtc;
    }

    /// <summary>Records that the digest is switched off, so days without a digest while off are not reported as missed.</summary>
    internal async Task MarkDisabledAsync(CancellationToken cancellationToken)
    {
        await db.DailyDigestRuns
            .Where(run => run.Id == StateId && run.Status == StateEnabled)
            .ExecuteUpdateAsync(set => set.SetProperty(run => run.Status, StateDisabled), cancellationToken);
    }

    /// <summary>
    /// Writes <c>Missed</c> rows for stale days that have no scheduled row, but only for days after the earliest scheduled row
    /// and after the digest was last enabled, and at most 14 days back. The first run ever writes nothing.
    /// </summary>
    internal async Task RecordMissedAsync(
        TimeZoneInfo zone,
        TimeOnly sendAt,
        DateTime enabledSinceUtc,
        CancellationToken cancellationToken)
    {
        DateTime now = Now;
        DateOnly today = DailyDigestWindow.LocalDate(now, zone);
        DateOnly? earliest = await db.DailyDigestRuns.AsNoTracking()
            .Where(run => run.Kind == DailyDigestRunKind.Scheduled)
            .MinAsync(run => (DateOnly?)run.ReportDate, cancellationToken);
        if (earliest is null)
        {
            return;
        }

        DateOnly from = today.AddDays(-MissedLookbackDays - 1);
        if (earliest.Value > from)
        {
            from = earliest.Value;
        }

        HashSet<DateOnly> existing = (await db.DailyDigestRuns.AsNoTracking()
                .Where(run => run.Kind == DailyDigestRunKind.Scheduled && run.ReportDate >= from)
                .Select(run => run.ReportDate)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        for (DateOnly day = from.AddDays(1); day < today; day = day.AddDays(1))
        {
            if (existing.Contains(day)
                || DailyDigestWindow.StaleUtc(day, zone, sendAt) > now
                || DailyDigestWindow.DueUtc(day, zone, sendAt) < enabledSinceUtc)
            {
                continue;
            }

            (DateTime start, DateTime end) = DailyDigestWindow.ForDate(day, zone);
            db.DailyDigestRuns.Add(new DailyDigestRun
            {
                Id = Guid.NewGuid(),
                Kind = DailyDigestRunKind.Scheduled,
                ReportDate = day,
                TimeZone = zone.Id,
                WindowStartUtc = start,
                WindowEndUtc = end,
                Status = DailyDigestRunStatus.Missed,
                ClaimToken = Guid.NewGuid(),
                CreatedUtc = now
            });
            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException)
            {
                // Another instance recorded it.
                db.ChangeTracker.Clear();
            }
        }
    }

    private Task<DailyDigestRun?> FindScheduledAsync(DateOnly reportDate, CancellationToken cancellationToken) =>
        db.DailyDigestRuns.AsNoTracking()
            .FirstOrDefaultAsync(run => run.Kind == DailyDigestRunKind.Scheduled && run.ReportDate == reportDate, cancellationToken);

    private static DailyDigestRun NewState(DateTime now) => new()
    {
        Id = StateId,
        Kind = StateKind,
        ReportDate = DateOnly.MinValue,
        TimeZone = string.Empty,
        WindowStartUtc = now,
        WindowEndUtc = now,
        Status = StateEnabled,
        ClaimToken = Guid.Empty,
        CreatedUtc = now
    };
}
