using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Admin.DailyDigest;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using static Quizymode.Api.Tests.Features.Admin.DailyDigest.DigestSeed;

namespace Quizymode.Api.Tests.Features.Admin.DailyDigest;

/// <summary>#509 AC 3, 10-11, 14-18, 20-22 and 29-32: scheduling, retries, missed days, the baseline and privacy.</summary>
public sealed class DailyDigestServiceTests : DatabaseTestFixture
{
    private static readonly DateTime Due = new(2026, 11, 7, 14, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly ReportDay = new(2026, 11, 6);
    private readonly FakeClock _clock = new(Due);
    private readonly RecordingEmailSender _email = new();

    private DailyDigestOptions Options() => new() { Enabled = true, AdminBaseUrl = "https://quizymode.test" };

    private DailyDigestService Service(ApplicationDbContext? db = null, DailyDigestOptions? options = null)
    {
        ApplicationDbContext context = db ?? DbContext;
        return new DailyDigestService(
            new DailyDigestComposer(context, _clock, NullLogger<DailyDigestComposer>.Instance),
            new DailyDigestRunStore(context, _clock),
            _email,
            Microsoft.Extensions.Options.Options.Create(options ?? Options()),
            _clock,
            NullLogger<DailyDigestService>.Instance);
    }

    private async Task TickAsync(DateTime? at = null)
    {
        if (at is { } time)
        {
            _clock.UtcNow = time;
        }

        await using ApplicationDbContext fresh = CreateDbContext();
        await Service(fresh).TickAsync(CancellationToken.None);
    }

    private async Task<DailyDigestRun> ScheduledRowAsync(DateOnly day)
    {
        await using ApplicationDbContext fresh = CreateDbContext();
        return await fresh.DailyDigestRuns.AsNoTracking().SingleAsync(run => run.Kind == DailyDigestRunKind.Scheduled && run.ReportDate == day);
    }

    private async Task SeedActivityAsync()
    {
        DateTime mid = Start.AddHours(10);
        DbContext.AnalyticsSessions.Add(Session("a", mid, "v1"));
        DbContext.PageViews.AddRange(Hit("a", mid), Hit("a", mid.AddMinutes(1), "/quiz"));
        await DbContext.SaveChangesAsync();
    }

    [Fact]
    public async Task Tick_At0759Local_SendsNothing_AndAt0800_SendsOnce()
    {
        await SeedActivityAsync();

        // At 07:59 the previous day (Nov 6) is not due yet; only the still-undelivered day before it (Nov 5) is.
        await TickAsync(Due.AddMinutes(-1));
        _email.Sent.Should().NotContain(mail => mail.Subject.Contains("Fri Nov 6"));

        await TickAsync(Due);
        await TickAsync(Due.AddMinutes(10));

        _email.Sent.Should().ContainSingle(mail => mail.Subject.Contains("Fri Nov 6"))
            .Which.Subject.Should().StartWith("Quizymode daily - Fri Nov 6: 1 session");
        (await ScheduledRowAsync(ReportDay)).Status.Should().Be(DailyDigestRunStatus.Sent);
    }

    [Fact]
    public async Task Tick_WhenTheProcessRestartsAt0805_StillSends()
    {
        await SeedActivityAsync();

        await TickAsync(Due.AddMinutes(5));

        _email.Sent.Should().HaveCount(1);
    }

    [Fact]
    public async Task Tick_WhenDisabled_SendsNothing()
    {
        _clock.UtcNow = Due;
        await Service(options: new DailyDigestOptions { Enabled = false }).TickAsync(CancellationToken.None);

        _email.Calls.Should().Be(0);
        (await DbContext.DailyDigestRuns.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Retries_FollowTheBackoff_StopAfterFourAttempts_AndSendIdenticalBodies()
    {
        await SeedActivityAsync();
        _email.Succeed = false;

        await TickAsync(Due);
        DailyDigestRun first = await ScheduledRowAsync(ReportDay);
        first.Status.Should().Be(DailyDigestRunStatus.Failed);
        first.Attempts.Should().Be(1);
        first.LastError.Should().Be("SmtpError");
        first.NextAttemptUtc.Should().Be(Due.AddMinutes(15));

        // New activity after the first compute must not change a retry: the persisted numbers are reused.
        DbContext.PageViews.Add(Hit("b", Start.AddHours(12)));
        await DbContext.SaveChangesAsync();

        await TickAsync(Due.AddMinutes(14));
        _email.Calls.Should().Be(1);

        await TickAsync(Due.AddMinutes(15));
        (await ScheduledRowAsync(ReportDay)).NextAttemptUtc.Should().Be(Due.AddMinutes(15).AddHours(1));

        await TickAsync(Due.AddMinutes(75));
        (await ScheduledRowAsync(ReportDay)).NextAttemptUtc.Should().Be(Due.AddMinutes(75).AddHours(3));

        await TickAsync(Due.AddMinutes(255));
        DailyDigestRun last = await ScheduledRowAsync(ReportDay);
        last.Attempts.Should().Be(4);
        last.NextAttemptUtc.Should().BeNull();

        await TickAsync(Due.AddHours(10));
        _email.Calls.Should().Be(4);

        _email.Succeed = true;
        await TickAsync(Due.AddHours(11));
        _email.Calls.Should().Be(4);
    }

    [Fact]
    public async Task Retry_AfterAFailure_SendsTheSameBodyAsTheFirstAttempt()
    {
        await SeedActivityAsync();
        List<string> bodies = [];
        _email.Succeed = false;
        await TickAsync(Due);
        string persisted = (await ScheduledRowAsync(ReportDay)).SummaryJson!;
        DbContext.PageViews.Add(Hit("late", Start.AddHours(12)));
        await DbContext.SaveChangesAsync();
        _email.Succeed = true;

        await TickAsync(Due.AddMinutes(15));

        _email.Sent.Should().HaveCount(1);
        DailyDigestService service = Service();
        bodies.Add(service.Render(DailyDigestService.Deserialize(persisted)).Body);
        _email.Sent[0].Body.Should().Be(bodies[0]);
        (await ScheduledRowAsync(ReportDay)).Status.Should().Be(DailyDigestRunStatus.Sent);
    }

    [Fact]
    public async Task NotConfigured_FailsWithoutCountingAttempts_RetriesHourly_AndSendsOnceConfigured()
    {
        await SeedActivityAsync();
        _email.Configured = false;

        await TickAsync(Due);
        DailyDigestRun row = await ScheduledRowAsync(ReportDay);
        row.Status.Should().Be(DailyDigestRunStatus.Failed);
        row.LastError.Should().Be("NotConfigured");
        row.Attempts.Should().Be(0);
        row.NextAttemptUtc.Should().Be(Due.AddHours(1));

        await TickAsync(Due.AddHours(1));
        (await ScheduledRowAsync(ReportDay)).Attempts.Should().Be(0);
        _email.Calls.Should().Be(0);

        _email.Configured = true;
        await TickAsync(Due.AddHours(2));
        _email.Sent.Should().HaveCount(1);
        (await ScheduledRowAsync(ReportDay)).Status.Should().Be(DailyDigestRunStatus.Sent);
    }

    [Fact]
    public async Task ExpiredSendingLease_IsResentOnceWithTheSuffix_ThenNeverAgain()
    {
        await SeedActivityAsync();
        _email.Succeed = false;
        await TickAsync(Due);
        // Simulate a crash mid-send: the row is left Sending with an expired lease.
        await DbContext.DailyDigestRuns.ExecuteUpdateAsync(set => set
            .SetProperty(run => run.Status, DailyDigestRunStatus.Sending)
            .SetProperty(run => run.LeaseUntilUtc, Due.AddMinutes(1))
            .SetProperty(run => run.NextAttemptUtc, (DateTime?)null)
            .SetProperty(run => run.Attempts, 1));
        _email.Succeed = false;

        await TickAsync(Due.AddMinutes(40));

        _email.Calls.Should().Be(2);
        DailyDigestRun row = await ScheduledRowAsync(ReportDay);
        row.InterruptedResendUsed.Should().BeTrue();
        row.Status.Should().Be(DailyDigestRunStatus.Failed);

        // A second interruption is not resent automatically.
        await DbContext.DailyDigestRuns.ExecuteUpdateAsync(set => set
            .SetProperty(run => run.Status, DailyDigestRunStatus.Sending)
            .SetProperty(run => run.LeaseUntilUtc, Due.AddMinutes(41))
            .SetProperty(run => run.NextAttemptUtc, (DateTime?)null));
        _email.Succeed = true;
        await TickAsync(Due.AddHours(2));

        _email.Calls.Should().Be(2);
        (await ScheduledRowAsync(ReportDay)).LastError.Should().Be("Interrupted");
    }

    [Fact]
    public async Task InterruptedResend_CarriesTheSubjectSuffix()
    {
        await SeedActivityAsync();
        _email.Succeed = false;
        await TickAsync(Due);
        await DbContext.DailyDigestRuns.ExecuteUpdateAsync(set => set
            .SetProperty(run => run.Status, DailyDigestRunStatus.Sending)
            .SetProperty(run => run.LeaseUntilUtc, Due.AddMinutes(1))
            .SetProperty(run => run.NextAttemptUtc, (DateTime?)null));
        _email.Succeed = true;

        await TickAsync(Due.AddMinutes(40));

        _email.Sent.Should().ContainSingle().Which.Subject.Should().EndWith("(resent after an interrupted send)");
    }

    [Fact]
    public async Task AfterTheStaleTime_AFailedDigestIsNotRetried()
    {
        await SeedActivityAsync();
        _email.Succeed = false;
        await TickAsync(Due);
        _email.Succeed = true;

        // 08:00 local on the second day after the report date.
        await TickAsync(new DateTime(2026, 11, 8, 14, 0, 0, DateTimeKind.Utc));

        DailyDigestRun row = await ScheduledRowAsync(ReportDay);
        row.Status.Should().Be(DailyDigestRunStatus.Failed);
        row.Attempts.Should().Be(1);
        // Only the digest that is due now (Nov 7) goes out; the stale Nov 6 one is not retried.
        _email.Sent.Should().ContainSingle().Which.Subject.Should().Contain("Sat Nov 7");
    }

    [Fact]
    public async Task Downtime_PastTheSendWindow_RecordsMissed_NeverSendsIt_AndListsItInTheNextEmail()
    {
        await SeedActivityAsync();
        await TickAsync(Due);
        _email.Sent.Clear();

        // The app is down until 20:00 UTC on Nov 8, after the Nov 6 send window closed (Nov 8 14:00 UTC) and Nov 7 was due.
        await TickAsync(new DateTime(2026, 11, 8, 20, 0, 0, DateTimeKind.Utc));

        // Nov 6 was sent. The new tick sends Nov 7 and the earlier gap is empty, so nothing is missed yet.
        _email.Sent.Should().ContainSingle();

        // Now a longer outage: nothing runs Nov 9 and Nov 10; on Nov 11 the Nov 9 and Nov 10 digests are stale.
        _email.Sent.Clear();
        await TickAsync(new DateTime(2026, 11, 11, 20, 0, 0, DateTimeKind.Utc));

        (await ScheduledRowAsync(new DateOnly(2026, 11, 8))).Status.Should().Be(DailyDigestRunStatus.Missed);
        (await ScheduledRowAsync(new DateOnly(2026, 11, 9))).Status.Should().Be(DailyDigestRunStatus.Missed);
        (await ScheduledRowAsync(new DateOnly(2026, 11, 10))).Status.Should().Be(DailyDigestRunStatus.Sent);
        _email.Sent.Should().ContainSingle().Which.Body.Should().Contain("Previous digests not sent: 2026-11-08 missed, 2026-11-09 missed");
    }

    [Fact]
    public async Task FirstRunEver_WritesNoMissedRows()
    {
        await TickAsync(new DateTime(2026, 11, 20, 14, 0, 0, DateTimeKind.Utc));

        List<DailyDigestRun> rows = await DbContext.DailyDigestRuns.AsNoTracking()
            .Where(run => run.Kind == DailyDigestRunKind.Scheduled).ToListAsync();
        rows.Should().ContainSingle().Which.Status.Should().NotBe(DailyDigestRunStatus.Missed);
    }

    [Fact]
    public async Task ReEnabling_AfterAWhile_DoesNotCreateFalseMissedRows()
    {
        await SeedActivityAsync();
        await TickAsync(Due);

        // Switched off for a week, then on again.
        _clock.UtcNow = Due.AddDays(1);
        await Service(options: new DailyDigestOptions { Enabled = false }).TickAsync(CancellationToken.None);
        await TickAsync(new DateTime(2026, 11, 14, 15, 0, 0, DateTimeKind.Utc));

        (await DbContext.DailyDigestRuns.CountAsync(run => run.Status == DailyDigestRunStatus.Missed)).Should().Be(0);
        (await ScheduledRowAsync(new DateOnly(2026, 11, 13))).Status.Should().Be(DailyDigestRunStatus.Sent);
    }

    [Fact]
    public async Task OneFailingSection_ShowsUnavailable_NotZero_AndTheEmailStillSends()
    {
        await SeedActivityAsync();
        await DbContext.Database.ExecuteSqlRawAsync("DROP TABLE \"ClientErrors\"");

        await TickAsync(Due);

        _email.Sent.Should().ContainSingle();
        _email.Sent[0].Body.Should().Contain("PROBLEMS" + Environment.NewLine + "  unavailable");
        _email.Sent[0].Body.Should().Contain("Sessions ");
    }

    [Fact]
    public async Task EverySectionFailing_SendsNothing_AndTheRunIsFailedComputeFailed()
    {
        foreach (string table in new[] { "PageViews", "AnalyticsEvents", "ClientErrors", "AnalyticsSessions", "FeedbackSubmissions", "MediaReports", "Items", "Keywords", "Ideas", "ItemImageReviews" })
        {
            await DbContext.Database.ExecuteSqlRawAsync($"DROP TABLE IF EXISTS \"{table}\"");
        }

        await TickAsync(Due);

        _email.Calls.Should().Be(0);
        DailyDigestRun row = await ScheduledRowAsync(ReportDay);
        row.Status.Should().Be(DailyDigestRunStatus.Failed);
        row.LastError.Should().Be("ComputeFailed");
    }

    [Fact]
    public async Task NoRawPageHits_ShowsTheWarning_ButZeroHumanSessionsWithRawHitsDoesNot()
    {
        await using (ApplicationDbContext fresh = CreateDbContext())
        {
            DigestReport empty = await Service(fresh).PreviewAsync(ReportDay, TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), CancellationToken.None);
            Service(fresh).Render(empty).Body.Should().Contain("No page hits of any kind were recorded");
        }

        DbContext.PageViews.Add(Hit("bot", Start.AddHours(3), isBot: true));
        await DbContext.SaveChangesAsync();
        await using ApplicationDbContext withBot = CreateDbContext();
        DigestReport report = await Service(withBot).PreviewAsync(ReportDay, TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), CancellationToken.None);
        string body = Service(withBot).Render(report).Body;

        body.Should().NotContain("No page hits of any kind");
        report.Current.Visits!.Sessions.Should().Be(0);
    }

    [Fact]
    public async Task Baseline_AveragesOnlyDaysWithRetainedData_AndShowsDashWhenThereAreNone()
    {
        TimeZoneInfo chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        // Retained data begins at the start of D-3. D-1 has 2 sessions, D-2 has 4, D-3 has 0 (only a raw bot hit at the start).
        DateTime d1 = Start.AddDays(-1).AddHours(5);
        DateTime d2 = Start.AddDays(-2).AddHours(5);
        DbContext.PageViews.Add(Hit("bot-first", Start.AddDays(-3), isBot: true));
        for (int i = 0; i < 2; i++)
        {
            DbContext.PageViews.Add(Hit($"d1-{i}", d1));
        }

        for (int i = 0; i < 4; i++)
        {
            DbContext.PageViews.Add(Hit($"d2-{i}", d2));
        }

        await DbContext.SaveChangesAsync();

        await using ApplicationDbContext fresh = CreateDbContext();
        DigestReport report = await Service(fresh).PreviewAsync(ReportDay, chicago, CancellationToken.None);

        report.Baseline!.Days.Should().Be(3);
        report.Baseline.Averages["sessions"].Should().BeApproximately(2.0, 0.0001);
        Service(fresh).Render(report).Body.Should().Contain("average of 3 days");

        await using ApplicationDbContext none = CreateDbContext();
        await none.PageViews.ExecuteDeleteAsync();
        DigestReport empty = await Service(none).PreviewAsync(ReportDay, chicago, CancellationToken.None);
        empty.Baseline!.Days.Should().Be(0);
        empty.Baseline.Averages["sessions"].Should().BeNull();
        Service(none).Render(empty).Body.Should().Contain("Sessions").And.Contain("-");
    }

    [Theory]
    [InlineData(19, 5, "5 of 19")]
    [InlineData(20, 5, "5 of 20 (25%)")]
    public void Completion_ShowsAPercentageOnlyFromTwentyStarts(int started, int completed, string expected)
    {
        DailyDigestRenderer.Completion(completed, started).Trim().Should().Be(expected);
    }

    [Fact]
    public async Task Body_NeverShowsAPercentageChangeAgainstTheBaseline()
    {
        await SeedActivityAsync();
        await using ApplicationDbContext fresh = CreateDbContext();
        DigestReport report = await Service(fresh).PreviewAsync(ReportDay, TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), CancellationToken.None);

        string body = Service(fresh).Render(report).Body;

        body.Should().NotContain("%");
        body.Should().NotContainAny("vs ", "change", "up from", "down from");
    }

    [Fact]
    public async Task SubjectAndBody_ContainNoPersonalOrFreeTextData()
    {
        Guid userId = Guid.NewGuid();
        Guid collectionId = Guid.NewGuid();
        DateTime mid = Start.AddHours(10);
        DbContext.Users.Add(new User { Id = userId, Subject = "sub-secret", Email = "person@example.com", Name = "Pat Person", CreatedAt = mid });
        DbContext.Collections.Add(new Collection { Id = collectionId, Name = "Formerly Public Name", CreatedBy = "o", IsPublic = true });
        await DbContext.SaveChangesAsync();
        // The collection becomes private after the quiz started.
        DbContext.AnalyticsSessions.Add(Session("sess-secret-1", mid, "visitor-secret-1", utmSource: "bob@example.com\nBcc: x@example.com", userId: userId, appVersion: "9.9.9<script>"));
        DbContext.PageViews.AddRange(Hit("sess-secret-1", mid, userId: userId), Hit("sess-secret-1", mid.AddMinutes(1), "/search?q=my-search-text"));
        DbContext.AnalyticsEvents.Add(Event(AnalyticsEventCatalog.QuickQuizStarted, "sess-secret-1", "run-secret", mid, "collection", collectionId.ToString()));
        DbContext.FeedbackSubmissions.Add(new FeedbackSubmission { Id = Guid.NewGuid(), Type = "reportIssue", PageUrl = "/p", Details = "feedback-free-text", Email = "fb@example.com", UserId = userId, CreatedAt = mid });
        DbContext.ClientErrors.Add(new ClientError { Id = Guid.NewGuid(), Fingerprint = "fp", Source = "window", ErrorName = "TypeError", Message = "error-message-text", Path = "/", SessionId = "sess-secret-1", UserId = userId, DeviceClass = "desktop", OccurredUtc = mid });
        await DbContext.SaveChangesAsync();
        Collection collection = await DbContext.Collections.SingleAsync();
        collection.IsPublic = false;
        await DbContext.SaveChangesAsync();

        await using ApplicationDbContext fresh = CreateDbContext();
        DigestReport report = await Service(fresh).PreviewAsync(ReportDay, TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), CancellationToken.None);
        DailyDigestService.Rendered message = Service(fresh).Render(report);
        string text = message.Subject + "\n" + message.Body;

        text.Should().NotContainAny(
            "person@example.com", "Pat Person", "sub-secret", userId.ToString(), "198.51.100.10", "sess-secret-1", "visitor-secret-1",
            "my-search-text", "feedback-free-text", "fb@example.com", "error-message-text", "Formerly Public Name", "bob@example.com", "Bcc", "9.9.9", "<script>", "run-secret");
        text.Should().Contain("a private collection");
        report.Current.Sources!.Top.Single().Name.Should().Be("other");
    }

    [Fact]
    public async Task AdHoc_DayWithAScheduledRun_LeavesTheScheduledRowUnchanged_AndRecordsALabelledRow()
    {
        await SeedActivityAsync();
        await TickAsync(Due);
        DailyDigestRun before = await ScheduledRowAsync(ReportDay);
        Guid admin = Guid.NewGuid();
        _clock.UtcNow = Due.AddHours(1);

        await using ApplicationDbContext fresh = CreateDbContext();
        (Guid runId, string status) = await Service(fresh).SendAdHocAsync(
            Start, Start.AddHours(24), TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), admin, CancellationToken.None);

        status.Should().Be(DailyDigestRunStatus.Sent);
        DailyDigestRun after = await ScheduledRowAsync(ReportDay);
        after.Should().BeEquivalentTo(before);
        DailyDigestRun adHoc = await DbContext.DailyDigestRuns.AsNoTracking().SingleAsync(run => run.Id == runId);
        adHoc.Kind.Should().Be(DailyDigestRunKind.AdHoc);
        adHoc.RequestedByUserId.Should().Be(admin);
        adHoc.Status.Should().Be(DailyDigestRunStatus.Sent);
        adHoc.WindowStartUtc.Should().Be(Start);
        adHoc.WindowEndUtc.Should().Be(Start.AddHours(24));
        _email.Sent.Should().HaveCount(2);
    }

    [Fact]
    public async Task AdHoc_Windows24HoursOrLongerHaveAPreviousWindowBaseline_ShorterOnesHaveNone()
    {
        TimeZoneInfo chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        DbContext.PageViews.Add(Hit("early", Start.AddDays(-5)));
        DbContext.PageViews.Add(Hit("prev", Start.AddHours(-3)));
        DbContext.PageViews.Add(Hit("now", Start.AddHours(3)));
        await DbContext.SaveChangesAsync();
        _clock.UtcNow = End;

        await using ApplicationDbContext fresh = CreateDbContext();
        DailyDigestComposer composer = new(fresh, _clock, NullLogger<DailyDigestComposer>.Instance);
        DigestReport day = await composer.ComposeWindowAsync(Start, Start.AddHours(24), chicago, CancellationToken.None);
        DigestReport shortWindow = await composer.ComposeWindowAsync(Start, Start.AddHours(23), chicago, CancellationToken.None);

        day.Baseline.Should().NotBeNull();
        day.Baseline!.Label.Should().Be("previous window");
        day.Baseline.Averages["sessions"].Should().Be(1);
        shortWindow.Baseline.Should().BeNull();
        DailyDigestRenderer.Body(shortWindow, null).Should().NotContain("previous window");
    }

    [Fact]
    public async Task AdHoc_WhenEmailIsNotConfigured_RecordsAFailedNotConfiguredRow()
    {
        _email.Configured = false;
        await using ApplicationDbContext fresh = CreateDbContext();

        (Guid runId, string status) = await Service(fresh).SendAdHocAsync(
            Start, Start.AddHours(24), TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), null, CancellationToken.None);

        status.Should().Be(DailyDigestRunStatus.Failed);
        (await DbContext.DailyDigestRuns.AsNoTracking().SingleAsync(run => run.Id == runId)).LastError.Should().Be("NotConfigured");
    }
}
