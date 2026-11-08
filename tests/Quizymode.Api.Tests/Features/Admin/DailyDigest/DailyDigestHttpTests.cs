using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Admin.DailyDigest;
using Quizymode.Api.Shared.Email;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin.DailyDigest;

/// <summary>#509 AC 4, 17, 22-24, 26-31 over real HTTP with the production JWT/Admin policy.</summary>
public sealed class DailyDigestHttpTests : DatabaseTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];
    private static readonly TimeZoneInfo Chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

    private readonly FakeClock _clock = new(DateTime.UtcNow);
    private readonly RecordingEmailSender _email = new();
    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync() => _host = await StartAsync(new Dictionary<string, string?>());

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private async Task<JwtHttpTestHost> StartAsync(Dictionary<string, string?> settings)
    {
        IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddSingleton<TimeProvider>(_clock);
                services.AddSingleton<IEmailSender>(_email);
                new DailyDigestAdmin.FeatureRegistration().AddToServiceCollection(services, configuration);
                ServiceDescriptor worker = services.Single(d => d.ImplementationType == typeof(DailyDigestScheduler));
                services.Remove(worker);
            },
            app => new DailyDigestAdmin.Endpoint().MapEndpoint(app));
    }

    private string AdminToken => _host.CreateToken("admin-subject", "admin@example.com", AdminGroups);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? token, object? body = null)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, body is null ? null : JsonContent.Create(body));
        return await _host.Client.SendAsync(request);
    }

    private DateOnly LocalToday => DailyDigestWindow.LocalDate(_clock.UtcNow, Chicago);

    public static TheoryData<string, string> Routes => new()
    {
        { "GET", "/admin/daily-digest/preview" },
        { "POST", "/admin/daily-digest/test-send" },
        { "POST", "/admin/daily-digest/send-now" },
        { "GET", "/admin/daily-digest/runs" }
    };

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task Endpoints_Are401Anonymous_And403ForNonAdmins(string method, string path)
    {
        object? body = path.EndsWith("send-now", StringComparison.Ordinal) ? new { from = DateTime.UtcNow.AddHours(-2), to = DateTime.UtcNow.AddHours(-1) } : null;

        using HttpResponseMessage anonymous = await SendAsync(new HttpMethod(method), path, null, body);
        using HttpResponseMessage member = await SendAsync(new HttpMethod(method), path, _host.CreateToken("member", "member@example.com"), body);

        anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        member.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Preview_DefaultsToYesterday_ReturnsTheBody_AndSendsNothing()
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/daily-digest/preview", AdminToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("reportDate").GetString().Should().Be(LocalToday.AddDays(-1).ToString("yyyy-MM-dd"));
        body.RootElement.GetProperty("textBody").GetString().Should().Contain("Quizymode daily digest for");
        body.RootElement.GetProperty("subject").GetString().Should().StartWith("Quizymode daily - ");
        _email.Calls.Should().Be(0);
        (await DbContext.DailyDigestRuns.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Preview_At2330Chicago_UsesTheZonesTodayNotUtcs()
    {
        // 05:30 UTC on Nov 8 is 23:30 on Nov 7 in Chicago, so Nov 7 is not a completed day yet but Nov 6 is.
        _clock.UtcNow = new DateTime(2026, 11, 8, 5, 30, 0, DateTimeKind.Utc);

        using HttpResponseMessage today = await SendAsync(HttpMethod.Get, "/admin/daily-digest/preview?date=2026-11-07", AdminToken);
        using HttpResponseMessage yesterday = await SendAsync(HttpMethod.Get, "/admin/daily-digest/preview?date=2026-11-06", AdminToken);

        today.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        yesterday.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData("future", 1)]
    [InlineData("today", 0)]
    [InlineData("old", -181)]
    [InlineData("garbage", 0)]
    public async Task Preview_RejectsFutureTodayUnparseableAndTooOldDates(string kind, int offsetDays)
    {
        string date = kind == "garbage" ? "11/06/2026" : LocalToday.AddDays(offsetDays).ToString("yyyy-MM-dd");

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, $"/admin/daily-digest/preview?date={Uri.EscapeDataString(date)}", AdminToken);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Preview_AcceptsTheOldestAllowedDay()
    {
        string date = LocalToday.AddDays(-180).ToString("yyyy-MM-dd");

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, $"/admin/daily-digest/preview?date={date}", AdminToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task TestSend_WhenEmailIsNotConfigured_Is503WithTheDocumentedCode()
    {
        _email.Configured = false;

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/admin/daily-digest/test-send", AdminToken);

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadAsStringAsync()).Should().Contain("DailyDigest.EmailNotConfigured");
    }

    [Fact]
    public async Task TestSend_SendsWithATestPrefix_NeverTouchesRuns_AndIsRateLimitedToOnePerFiveMinutes()
    {
        using HttpResponseMessage first = await SendAsync(HttpMethod.Post, "/admin/daily-digest/test-send", AdminToken);
        using HttpResponseMessage second = await SendAsync(HttpMethod.Post, "/admin/daily-digest/test-send", AdminToken);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        second.Headers.RetryAfter.Should().NotBeNull();
        _email.Sent.Should().ContainSingle().Which.Subject.Should().StartWith("[TEST] Quizymode daily - ");
        (await DbContext.DailyDigestRuns.CountAsync()).Should().Be(0);
        (await DbContext.Audits.CountAsync(audit => audit.Action == AuditAction.DailyDigestTestSent)).Should().Be(1);
    }

    [Fact]
    public async Task TestSend_CooldownSurvivesARestart_BecauseItComesFromTheAuditLog()
    {
        using HttpResponseMessage first = await SendAsync(HttpMethod.Post, "/admin/daily-digest/test-send", AdminToken);
        await _host.DisposeAsync();
        _host = await StartAsync(new Dictionary<string, string?>());

        using HttpResponseMessage afterRestart = await SendAsync(HttpMethod.Post, "/admin/daily-digest/test-send", AdminToken);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        afterRestart.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task SendNow_RejectsInvalidWindows()
    {
        DateTime now = DateTime.UtcNow;
        (object Body, string Name)[] cases =
        [
            (new { from = now.AddHours(-1), to = now.AddHours(-2) }, "from after to"),
            (new { from = now.AddHours(-1), to = now.AddHours(-1) }, "from equals to"),
            (new { from = now.AddHours(-1), to = now.AddHours(1) }, "to in the future"),
            (new { from = now.AddDays(-32), to = now.AddHours(-1) }, "longer than 31 days")
        ];

        foreach ((object body, string name) in cases)
        {
            using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken, body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, name);
        }

        _email.Calls.Should().Be(0);
        (await DbContext.DailyDigestRuns.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task SendNow_AcceptsExactly31Days()
    {
        DateTime to = DateTime.UtcNow.AddMinutes(-1);

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken, new { from = to.AddDays(-31), to });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SendNow_IgnoresAnySuppliedRecipient_AndRecordsALabelledRun()
    {
        DateTime to = DateTime.UtcNow.AddMinutes(-1);

        using HttpResponseMessage response = await SendAsync(
            HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken,
            new { from = to.AddHours(-24), to, recipient = "evil@example.com", to2 = "evil@example.com", email = "evil@example.com" });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        _email.Sent.Should().ContainSingle();
        _email.Sent[0].Subject.Should().NotContain("evil@example.com");
        _email.Sent[0].Body.Should().NotContain("evil@example.com");
        DailyDigestRun run = await DbContext.DailyDigestRuns.AsNoTracking().SingleAsync();
        run.Kind.Should().Be(DailyDigestRunKind.AdHoc);
        run.Status.Should().Be(DailyDigestRunStatus.Sent);
        run.RequestedByUserId.Should().NotBeNull();
        (to - run.WindowStartUtc).Should().BeCloseTo(TimeSpan.FromHours(24), TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task SendNow_SecondRequestWithinAMinute_Is429_AndTheFirstIsUnaffected()
    {
        DateTime to = DateTime.UtcNow.AddMinutes(-1);
        object body = new { from = to.AddHours(-24), to };

        using HttpResponseMessage first = await SendAsync(HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken, body);
        using HttpResponseMessage second = await SendAsync(HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken, body);

        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        (await second.Content.ReadAsStringAsync()).Should().Contain("minute");
        _email.Sent.Should().ContainSingle();
        (await DbContext.DailyDigestRuns.AsNoTracking().SingleAsync()).Status.Should().Be(DailyDigestRunStatus.Sent);

        _clock.UtcNow = DateTime.UtcNow.AddMinutes(2);
        using HttpResponseMessage later = await SendAsync(HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken, body);
        later.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task SendNow_WhenEmailIsNotConfigured_Is503_AndTheRunIsRecordedAsFailed()
    {
        _email.Configured = false;
        DateTime to = DateTime.UtcNow.AddMinutes(-1);

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/admin/daily-digest/send-now", AdminToken, new { from = to.AddHours(-24), to });

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        DailyDigestRun run = await DbContext.DailyDigestRuns.AsNoTracking().SingleAsync();
        run.Status.Should().Be(DailyDigestRunStatus.Failed);
        run.LastError.Should().Be("NotConfigured");
    }

    [Fact]
    public async Task Runs_ReportsStatus_History_AndTheLastTestSend()
    {
        DbContext.DailyDigestRuns.Add(new DailyDigestRun
        {
            Id = Guid.NewGuid(),
            ReportDate = LocalToday.AddDays(-1),
            TimeZone = "America/Chicago",
            WindowStartUtc = DateTime.UtcNow.AddDays(-2),
            WindowEndUtc = DateTime.UtcNow.AddDays(-1),
            Status = DailyDigestRunStatus.Sent,
            SentUtc = DateTime.UtcNow.AddHours(-2),
            CreatedUtc = DateTime.UtcNow.AddHours(-2)
        });
        await DbContext.SaveChangesAsync();
        using HttpResponseMessage test = await SendAsync(HttpMethod.Post, "/admin/daily-digest/test-send", AdminToken);

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/daily-digest/runs?days=14", AdminToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("enabled").GetBoolean().Should().BeFalse();
        body.RootElement.GetProperty("emailConfigured").GetBoolean().Should().BeTrue();
        body.RootElement.GetProperty("timeZone").GetString().Should().Be("America/Chicago");
        body.RootElement.GetProperty("lastTestSentUtc").ValueKind.Should().Be(JsonValueKind.String);
        body.RootElement.GetProperty("runs").GetArrayLength().Should().Be(1);
        body.RootElement.GetProperty("runs")[0].GetProperty("status").GetString().Should().Be("Sent");
        test.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Runs_WithAnUnknownTimeZone_ReportsNotEnabledWithAReason()
    {
        await _host.DisposeAsync();
        _host = await StartAsync(new Dictionary<string, string?>
        {
            ["DailyDigest:Enabled"] = "true",
            ["DailyDigest:TimeZone"] = "Mars/Olympus"
        });

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/daily-digest/runs", AdminToken);

        using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("enabled").GetBoolean().Should().BeFalse();
        body.RootElement.GetProperty("disabledReason").GetString().Should().Be("InvalidTimeZone");
    }

    [Fact]
    public async Task Runs_WhenEnabled_ReportsTheNextDueTime()
    {
        await _host.DisposeAsync();
        _clock.UtcNow = new DateTime(2026, 11, 7, 13, 0, 0, DateTimeKind.Utc);
        _host = await StartAsync(new Dictionary<string, string?> { ["DailyDigest:Enabled"] = "true" });

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/daily-digest/runs", AdminToken);

        using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("enabled").GetBoolean().Should().BeTrue();
        body.RootElement.GetProperty("nextDueUtc").GetDateTime().ToUniversalTime().Should().Be(new DateTime(2026, 11, 7, 14, 0, 0, DateTimeKind.Utc));
    }
}
