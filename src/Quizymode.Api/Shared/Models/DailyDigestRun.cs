namespace Quizymode.Api.Shared.Models;

/// <summary>
/// One daily maintainer digest (#509). Scheduled rows are unique per Chicago report date; ad hoc rows are labelled
/// and never block or change the scheduled row for the same day. <see cref="SummaryJson"/> holds aggregates only.
/// </summary>
public sealed class DailyDigestRun
{
    public Guid Id { get; set; }

    /// <summary><see cref="DailyDigestRunKind"/> name.</summary>
    public string Kind { get; set; } = DailyDigestRunKind.Scheduled;

    /// <summary>Local calendar day of the digest (for ad hoc rows, the local day the window starts).</summary>
    public DateOnly ReportDate { get; set; }

    public string TimeZone { get; set; } = string.Empty;

    public DateTime WindowStartUtc { get; set; }

    public DateTime WindowEndUtc { get; set; }

    /// <summary><see cref="DailyDigestRunStatus"/> name.</summary>
    public string Status { get; set; } = DailyDigestRunStatus.Sending;

    /// <summary>Definite SMTP attempts. A not-configured wait does not count.</summary>
    public int Attempts { get; set; }

    /// <summary>True once the one automatic resend after an interrupted send was used.</summary>
    public bool InterruptedResendUsed { get; set; }

    /// <summary>Changes on every claim; every status or lease write is conditional on it.</summary>
    public Guid ClaimToken { get; set; }

    public DateTime? LeaseUntilUtc { get; set; }

    public DateTime? NextAttemptUtc { get; set; }

    public DateTime? ComputedUtc { get; set; }

    public DateTime? SentUtc { get; set; }

    /// <summary>Error type only (for example NotConfigured, ComputeFailed, SmtpError, Interrupted); never a message.</summary>
    public string? LastError { get; set; }

    public string? SummaryJson { get; set; }

    /// <summary>Admin who requested an ad hoc send.</summary>
    public Guid? RequestedByUserId { get; set; }

    public DateTime CreatedUtc { get; set; }
}

public static class DailyDigestRunKind
{
    public const string Scheduled = "Scheduled";
    public const string AdHoc = "AdHoc";
}

public static class DailyDigestRunStatus
{
    public const string Sending = "Sending";
    public const string Sent = "Sent";
    public const string Failed = "Failed";
    public const string Missed = "Missed";
}
