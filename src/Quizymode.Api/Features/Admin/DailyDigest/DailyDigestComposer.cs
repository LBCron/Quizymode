using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>Computes a <see cref="DigestReport"/> for a local day or an arbitrary window, with its comparison windows (#509).</summary>
internal sealed partial class DailyDigestComposer(
    ApplicationDbContext db,
    TimeProvider timeProvider,
    ILogger<DailyDigestComposer> logger)
{
    internal const int BaselineDays = 7;

    private sealed record EarliestHit(DateTime? Utc);

    [GeneratedRegex("^[0-9A-Za-z.+-]{1,32}$")]
    private static partial Regex VersionPattern();

    /// <summary>The digest of one local calendar day against the average of the previous 7 days.</summary>
    internal async Task<DigestReport> ComposeDailyAsync(DateOnly reportDate, TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        (DateTime start, DateTime end) = DailyDigestWindow.ForDate(reportDate, zone);
        List<(DateTime Start, DateTime End)> baselineWindows = Enumerable.Range(1, BaselineDays)
            .Select(offset => DailyDigestWindow.ForDate(reportDate.AddDays(-offset), zone))
            .ToList();

        DigestReport report = await ComposeAsync(DigestReport.KindDaily, reportDate, zone, start, end, baselineWindows, "7-day avg", BaselineDays, cancellationToken);
        List<string> previous = await Section("previous digests", () => PreviousDigestsAsync(reportDate, cancellationToken)) ?? [];
        return report with { PreviousDigests = previous };
    }

    /// <summary>
    /// An ad hoc window. For windows of 24 hours or more the comparison is one equal-length window ending where this one
    /// starts; shorter windows show counts only.
    /// </summary>
    internal Task<DigestReport> ComposeWindowAsync(DateTime fromUtc, DateTime toUtc, TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        TimeSpan length = toUtc - fromUtc;
        List<(DateTime Start, DateTime End)> baselineWindows = length >= TimeSpan.FromHours(24)
            ? [(fromUtc - length, fromUtc)]
            : [];
        DateOnly localStart = DailyDigestWindow.LocalDate(fromUtc, zone);
        return ComposeAsync(DigestReport.KindWindow, localStart, zone, fromUtc, toUtc, baselineWindows, "previous window", baselineWindows.Count, cancellationToken);
    }

    private async Task<DigestReport> ComposeAsync(
        string kind,
        DateOnly reportDate,
        TimeZoneInfo zone,
        DateTime startUtc,
        DateTime endUtc,
        List<(DateTime Start, DateTime End)> baselineWindows,
        string baselineLabel,
        int expectedBaselineDays,
        CancellationToken cancellationToken)
    {
        // Cohort rows are all-time and independent of the window, so they are loaded once for every window.
        List<VisitorCohortReport.CohortRow>? cohortRows = await Section("visitor history", () =>
            VisitorCohortReport.LoadRowsAsync(db, false, false, cancellationToken));

        DaySummary current = await DailySummaryBuilder.BuildDayAsync(db, startUtc, endUtc, cohortRows, true, logger, cancellationToken);

        BaselineSummary? baseline = null;
        if (baselineWindows.Count > 0)
        {
            EarliestHit? earliest = await Section("retention", async () =>
                new EarliestHit(await db.PageViews.AsNoTracking().MinAsync(pageView => (DateTime?)pageView.CreatedUtc, cancellationToken)));
            List<DaySummary> days = [];
            foreach ((DateTime start, DateTime end) in baselineWindows)
            {
                // Days that began before the earliest retained page hit are left out of the average.
                if (earliest?.Utc is { } first && first <= start)
                {
                    days.Add(await DailySummaryBuilder.BuildDayAsync(db, start, end, cohortRows, false, logger, cancellationToken));
                }
            }

            baseline = new BaselineSummary(baselineLabel, days.Count, expectedBaselineDays, Average(days));
        }

        WaitingSection? waiting = await Section("waiting", () => WaitingAsync(cancellationToken));
        DigestHealth? health = await Section("health", () => DailySummaryBuilder.BuildHealthAsync(db, startUtc, endUtc, cancellationToken));
        string? version = kind == DigestReport.KindDaily
            ? await Section("version", () => NewVersionAsync(startUtc, endUtc, cancellationToken))
            : null;
        version = string.IsNullOrEmpty(version) ? null : version;

        return new DigestReport(
            kind,
            reportDate,
            zone.Id,
            startUtc,
            endUtc,
            current,
            baseline,
            waiting,
            health,
            [],
            version,
            timeProvider.GetUtcNow().UtcDateTime);
    }

    private async Task<T?> Section<T>(string name, Func<Task<T>> build)
        where T : class
    {
        return await DailySummaryBuilder.Section(name, logger, build);
    }

    internal static Dictionary<string, double> Metrics(DaySummary day)
    {
        Dictionary<string, double> values = [];
        if (day.Visits is { } visits)
        {
            values["pageViews"] = visits.PageViews;
            values["sessions"] = visits.Sessions;
            values["engaged"] = visits.EngagedSessions;
            values["browsers"] = visits.Browsers;
            values["noBrowserId"] = visits.SessionsWithoutBrowserId;
            values["newBrowsers"] = visits.NewBrowsers;
            values["returningBrowsers"] = visits.ReturningBrowsers;
        }

        if (day.Accounts is { } accounts)
        {
            values["activeAccounts"] = accounts.ActiveAccounts;
            values["newAccounts"] = accounts.NewAccounts;
        }

        if (day.Quizzes is { } quizzes)
        {
            values["quizStarts"] = quizzes.Starts;
        }

        return values;
    }

    /// <summary>Mean of each metric over the comparison windows that have it; null when none do.</summary>
    internal static Dictionary<string, double?> Average(List<DaySummary> days)
    {
        List<Dictionary<string, double>> metrics = days.Select(Metrics).ToList();
        string[] keys = ["pageViews", "sessions", "engaged", "browsers", "noBrowserId", "newBrowsers", "returningBrowsers", "activeAccounts", "newAccounts", "quizStarts"];
        return keys.ToDictionary(
            key => key,
            key =>
            {
                List<double> present = metrics.Where(day => day.ContainsKey(key)).Select(day => day[key]).ToList();
                return present.Count == 0 ? (double?)null : present.Average();
            });
    }

    private async Task<WaitingSection> WaitingAsync(CancellationToken cancellationToken)
    {
        WorkQueueBuilder.Counts counts = await WorkQueueBuilder.BuildAsync(db, cancellationToken);
        int newFeedback = await db.FeedbackSubmissions.AsNoTracking().CountAsync(submission => submission.Status == FeedbackStatus.New, cancellationToken);
        DateTime now = timeProvider.GetUtcNow().UtcDateTime;
        int? oldestDays = counts.OldestPictureSubmittedAt is { } oldest ? Math.Max(0, (int)(now - oldest).TotalDays) : null;
        return new WaitingSection(
            counts.ItemsAwaitingReview,
            counts.PendingPrivateKeywords,
            counts.IdeasAwaitingModeration,
            counts.PicturesAwaitingReview,
            oldestDays,
            newFeedback);
    }

    private async Task<string> NewVersionAsync(DateTime startUtc, DateTime endUtc, CancellationToken cancellationToken)
    {
        List<GetAnalyticsOverview.ReleaseMarker> markers = await GetAnalyticsOverview.BuildReleaseMarkersAsync(db, startUtc, endUtc, cancellationToken);
        // Printed only when it looks like a version, so a crafted client value never reaches the email. "" means none.
        return markers.Select(marker => marker.Version).LastOrDefault(version => VersionPattern().IsMatch(version)) ?? string.Empty;
    }

    private async Task<List<string>> PreviousDigestsAsync(DateOnly reportDate, CancellationToken cancellationToken)
    {
        DateOnly lookback = reportDate.AddDays(-14);
        List<DailyDigestRun> rows = await db.DailyDigestRuns.AsNoTracking()
            .Where(run => run.Kind == DailyDigestRunKind.Scheduled && run.ReportDate >= lookback && run.ReportDate < reportDate)
            .ToListAsync(cancellationToken);
        DateOnly? lastSent = rows.Where(run => run.Status == DailyDigestRunStatus.Sent).Select(run => (DateOnly?)run.ReportDate).Max();
        return rows
            .Where(run => run.Status != DailyDigestRunStatus.Sent && (lastSent is null || run.ReportDate > lastSent))
            .OrderBy(run => run.ReportDate)
            .Select(run => $"{run.ReportDate:yyyy-MM-dd} {(run.Status == DailyDigestRunStatus.Missed ? "missed" : "failed")}")
            .ToList();
    }
}
