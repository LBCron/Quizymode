using System.Globalization;
using System.Text;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>
/// Renders a persisted <see cref="DigestReport"/> as a plain-text email (#509). The output is a pure function of the
/// report, so a retry sends the same body. Only aggregates are printed; free text never reaches this class.
/// </summary>
internal static class DailyDigestRenderer
{
    internal const string ResendSuffix = " (resent after an interrupted send)";
    internal const string TestPrefix = "[TEST] ";

    private const int LabelWidth = 36;
    private const int ValueWidth = 12;
    private const int AverageWidth = 12;
    private const string Unavailable = "unavailable";

    internal static string Subject(DigestReport report, bool testSend, bool interruptedResend)
    {
        TimeZoneInfo zone = DailyDigestWindow.TryFindZone(report.TimeZone) ?? TimeZoneInfo.Utc;
        List<string> parts = [];
        if (report.Current.Visits is { } visits)
        {
            parts.Add(Count(visits.Sessions, "session"));
        }

        if (report.Current.Accounts is { } accounts)
        {
            parts.Add(Count(accounts.NewAccounts, "new account"));
        }

        if (report.Current.Quizzes is { } quizzes)
        {
            parts.Add(Count(quizzes.Starts, "quiz start"));
        }

        string title = report.Kind == DigestReport.KindDaily
            ? $"Quizymode daily - {report.ReportDate.ToString("ddd MMM d", CultureInfo.InvariantCulture)}"
            : $"Quizymode digest - {Local(report.StartUtc, zone, "MMM d HH:mm")} to {Local(report.EndUtc, zone, "MMM d HH:mm")}";
        string subject = parts.Count == 0 ? title : $"{title}: {string.Join(", ", parts)}";
        return (testSend ? TestPrefix : string.Empty) + subject + (interruptedResend ? ResendSuffix : string.Empty);
    }

    internal static string Body(DigestReport report, string? adminBaseUrl)
    {
        TimeZoneInfo zone = DailyDigestWindow.TryFindZone(report.TimeZone) ?? TimeZoneInfo.Utc;
        StringBuilder text = new();

        if (report.Kind == DigestReport.KindDaily)
        {
            text.AppendLine($"Quizymode daily digest for {report.ReportDate.ToString("dddd, MMMM d, yyyy", CultureInfo.InvariantCulture)} ({report.TimeZone})");
        }
        else
        {
            text.AppendLine($"Quizymode digest for {Local(report.StartUtc, zone, "yyyy-MM-dd HH:mm")} to {Local(report.EndUtc, zone, "yyyy-MM-dd HH:mm")} ({report.TimeZone})");
        }

        text.AppendLine($"Window: {report.StartUtc:yyyy-MM-dd HH:mm} UTC to {report.EndUtc:yyyy-MM-dd HH:mm} UTC. Bots and internal traffic excluded.");

        if (report.Health is { } health)
        {
            if (health.RawPageViews == 0)
            {
                text.AppendLine();
                text.AppendLine("WARNING: No page hits of any kind were recorded. Tracking or the app may have been down, so zeros below may mean missing data.");
            }
            else if ((report.Current.Visits?.ItemSteps ?? 0) > 0 && health.RawEvents == 0)
            {
                text.AppendLine();
                text.AppendLine("WARNING: Study activity was seen but no events were recorded, so study events may be missing.");
            }
        }

        string comparison = report.Baseline?.Label ?? string.Empty;
        string header = report.Kind == DigestReport.KindDaily ? "yesterday" : "this window";

        text.AppendLine();
        Section(text, "VISITS", header, comparison, report.Baseline);
        if (report.Current.Visits is { } v)
        {
            Row(text, "Page views", v.PageViews, "pageViews", report.Baseline);
            Row(text, "Sessions", v.Sessions, "sessions", report.Baseline);
            Row(text, "  engaged (2+ pages)", v.EngagedSessions, "engaged", report.Baseline);
            Row(text, "Browsers (estimate)", v.Browsers, "browsers", report.Baseline);
            Row(text, "Sessions without a browser id", v.SessionsWithoutBrowserId, "noBrowserId", report.Baseline);
            Pair(text, "New / returning browsers", v.NewBrowsers, v.ReturningBrowsers, report.Baseline);
        }
        else
        {
            text.AppendLine($"  {Unavailable}");
        }

        text.AppendLine();
        text.AppendLine("ACCOUNTS");
        if (report.Current.Accounts is { } a)
        {
            Row(text, "Signed-in accounts active", a.ActiveAccounts, "activeAccounts", report.Baseline);
            Row(text, "New accounts", a.NewAccounts, "newAccounts", report.Baseline);
            text.AppendLine($"  Sessions: anonymous {a.AnonymousSessions}, signed in during session {a.ConvertedSessions}, already signed in {a.AuthenticatedSessions}");
        }
        else
        {
            text.AppendLine($"  {Unavailable}");
        }

        text.AppendLine();
        text.AppendLine("QUIZZES");
        if (report.Current.Quizzes is { } q)
        {
            Row(text, "Quiz starts", q.Starts, "quizStarts", report.Baseline);
            text.AppendLine($"  {Pad($"Completed (started in this window)", LabelWidth)}{Completion(q.Completed, q.Starts)}");
            text.AppendLine($"  {Pad("Participants (browsers)", LabelWidth)}{q.Participants.ToString(CultureInfo.InvariantCulture).PadLeft(ValueWidth)}");
            if (q.Topics.Count > 0)
            {
                text.AppendLine($"  Top topics: {string.Join(", ", q.Topics.Select(topic => $"{topic.Label} ({topic.Starts})"))}");
            }
        }
        else
        {
            text.AppendLine($"  {Unavailable}");
        }

        text.AppendLine();
        text.AppendLine("WHERE THEY CAME FROM (sessions / engaged / quiz starts / signed in during session / new accounts)");
        if (report.Current.Sources is { } sources)
        {
            foreach (SourceRow row in sources.Top.Append(sources.LinkedIn))
            {
                text.AppendLine($"  {Pad(row.Name, LabelWidth - 2)}{row.Sessions} / {row.EngagedSessions} / {row.QuizStarts} / {row.ConvertedSessions} / {row.NewAccounts}");
            }
        }
        else
        {
            text.AppendLine($"  {Unavailable}");
        }

        text.AppendLine();
        text.AppendLine("PROBLEMS");
        if (report.Current.Problems is { } p)
        {
            text.AppendLine($"  Front-end errors: {Count(p.ErrorReports, "report")} in {Count(p.ErrorSessions, "session")} ({Count(p.ErrorUsers, "signed-in user")}), {Count(p.NewErrorGroups, "new error group")}");
            text.AppendLine($"  Problem reports (feedback): {p.ProblemReports}   Other feedback: {p.OtherFeedback}   Picture reports: {p.PictureReports}");
        }
        else
        {
            text.AppendLine($"  {Unavailable}");
        }

        text.AppendLine();
        text.AppendLine("WAITING FOR YOU (now)");
        if (report.Waiting is { } w)
        {
            string oldest = w.OldestPictureAgeDays is { } days ? $" (oldest {days} d)" : string.Empty;
            text.AppendLine($"  Items to review {w.ItemsToReview}, private keywords {w.PrivateKeywords}, ideas {w.Ideas}, pictures {w.Pictures}{oldest}, new feedback {w.NewFeedback}");
        }
        else
        {
            text.AppendLine($"  {Unavailable}");
        }

        text.AppendLine();
        text.AppendLine("DATA AND DIGEST HEALTH");
        text.AppendLine(report.Health is { } h
            ? $"  Raw rows recorded: {h.RawPageViews} page hits, {h.RawEvents} events (bots and internal included)"
            : $"  Raw rows recorded: {Unavailable}");
        if (report.NewVersion is not null)
        {
            text.AppendLine($"  Version first seen in this window: {report.NewVersion}");
        }

        if (report.Kind == DigestReport.KindDaily)
        {
            text.AppendLine(report.PreviousDigests.Count == 0
                ? "  Previous digests: all sent"
                : $"  Previous digests not sent: {string.Join(", ", report.PreviousDigests)}");
        }

        string? baseUrl = string.IsNullOrWhiteSpace(adminBaseUrl) ? null : adminBaseUrl.Trim().TrimEnd('/');
        if (baseUrl is not null && Uri.TryCreate(baseUrl, UriKind.Absolute, out Uri? uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
        {
            text.AppendLine();
            text.AppendLine("Details (admin sign-in required):");
            text.AppendLine($"  Overview:      {baseUrl}/admin");
            text.AppendLine($"  Traffic:       {baseUrl}/admin/page-views");
            text.AppendLine($"  Client errors: {baseUrl}/admin/client-errors");
            text.AppendLine($"  Feedback:      {baseUrl}/admin/feedback");
        }

        return text.ToString();
    }

    private static void Section(StringBuilder text, string title, string valueHeader, string averageHeader, BaselineSummary? baseline)
    {
        string average = baseline is null ? string.Empty : averageHeader.PadLeft(AverageWidth);
        text.AppendLine($"{Pad(title, LabelWidth + 2)}{valueHeader.PadLeft(ValueWidth)}{average}");
        if (baseline is { Days: > 0 } && baseline.Days < baseline.ExpectedDays)
        {
            text.AppendLine($"  (comparison is the average of {baseline.Days} {(baseline.Days == 1 ? "day" : "days")}; older data is not retained)");
        }
    }

    private static void Row(StringBuilder text, string label, int value, string key, BaselineSummary? baseline)
    {
        text.AppendLine($"  {Pad(label, LabelWidth)}{value.ToString(CultureInfo.InvariantCulture).PadLeft(ValueWidth)}{Average(baseline, key)}");
    }

    private static void Pair(StringBuilder text, string label, int first, int second, BaselineSummary? baseline)
    {
        string average = baseline is null
            ? string.Empty
            : $"{Format(baseline.Averages.GetValueOrDefault("newBrowsers"))} / {Format(baseline.Averages.GetValueOrDefault("returningBrowsers"))}".PadLeft(AverageWidth);
        text.AppendLine($"  {Pad(label, LabelWidth)}{$"{first} / {second}".PadLeft(ValueWidth)}{average}");
    }

    private static string Average(BaselineSummary? baseline, string key) =>
        baseline is null ? string.Empty : Format(baseline.Averages.GetValueOrDefault(key)).PadLeft(AverageWidth);

    private static string Format(double? value) =>
        value is { } number ? number.ToString("0.0", CultureInfo.InvariantCulture) : "-";

    /// <summary>"x of y", with a percentage only when the base is at least 20. Never a change against the baseline.</summary>
    internal static string Completion(int completed, int started)
    {
        string text = $"{completed} of {started}";
        if (started >= 20)
        {
            text += $" ({Math.Round(completed * 100.0 / started, 0, MidpointRounding.AwayFromZero).ToString("0", CultureInfo.InvariantCulture)}%)";
        }

        return text.PadLeft(ValueWidth);
    }

    private static string Count(int value, string noun) =>
        $"{value.ToString(CultureInfo.InvariantCulture)} {noun}{(value == 1 ? string.Empty : "s")}";

    private static string Pad(string value, int width) => value.Length >= width ? value + " " : value.PadRight(width);

    private static string Local(DateTime utc, TimeZoneInfo zone, string format) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone).ToString(format, CultureInfo.InvariantCulture);
}
