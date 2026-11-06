using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Services;

/// <summary>#496: events retention (off by default), 180-day report caps, IP truncation, geo parsing, stored area.</summary>
public sealed class SessionReviewRetentionTests : DatabaseTestFixture
{
    private static readonly DateTime Now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);

    private async Task SeedEventsAsync()
    {
        DbContext.AnalyticsEvents.AddRange(
            new AnalyticsEvent { Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.GameStarted, SessionId = "old", RunId = "r1", Path = "/games", OccurredUtc = Now.AddDays(-181) },
            new AnalyticsEvent { Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.GameStarted, SessionId = "new", RunId = "r2", Path = "/games", OccurredUtc = Now.AddDays(-5) });
        await DbContext.SaveChangesAsync();
    }

    [Fact]
    public async Task RunAsync_DoesNotDeleteEvents_WhenPruningDisabledByDefault()
    {
        await SeedEventsAsync();

        PageViewRetentionService.RunResult result = await PageViewRetentionService.RunAsync(DbContext, Now, CancellationToken.None);

        result.EventsDeleted.Should().Be(0);
        (await DbContext.AnalyticsEvents.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task RunAsync_DeletesEventsOlderThan180Days_WhenPruningEnabled()
    {
        await SeedEventsAsync();

        PageViewRetentionService.RunResult result =
            await PageViewRetentionService.RunAsync(DbContext, Now, CancellationToken.None, pruneEvents: true);

        result.EventsDeleted.Should().Be(1);
        (await DbContext.AnalyticsEvents.Select(e => e.SessionId).ToListAsync()).Should().BeEquivalentTo(["new"]);
    }

    [Fact]
    public async Task RunAsync_KeepsAnEventExactlyInsideTheWindow()
    {
        DbContext.AnalyticsEvents.Add(new AnalyticsEvent
        {
            Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.GameStarted, SessionId = "edge", RunId = "r", Path = "/games",
            OccurredUtc = Now.AddDays(-179)
        });
        await DbContext.SaveChangesAsync();

        await PageViewRetentionService.RunAsync(DbContext, Now, CancellationToken.None, pruneEvents: true);

        (await DbContext.AnalyticsEvents.CountAsync()).Should().Be(1);
    }

    [Fact]
    public void EventsPruningConfigKey_IsTheDocumentedOne()
    {
        PageViewRetentionService.EventsPruningEnabledKey.Should().Be("PageViewRetention:EventsPruningEnabled");
    }

    [Fact]
    public async Task ReportDayLimits_AcceptTheRetentionBoundaryAndRejectOneDayMore()
    {
        int limit = PageViewRetentionService.RetentionDays;
        limit.Should().Be(180);

        (await GetConversionFunnel.HandleAsync(new GetConversionFunnel.QueryRequest(Days: limit), DbContext, CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await GetConversionFunnel.HandleAsync(new GetConversionFunnel.QueryRequest(Days: limit + 1), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();

        (await GetLearningReport.HandleAsync(new GetLearningReport.QueryRequest(Days: limit), DbContext, CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await GetLearningReport.HandleAsync(new GetLearningReport.QueryRequest(Days: limit + 1), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();

        (await GetContentReport.HandleAsync(new GetContentReport.QueryRequest(Days: limit), DbContext, CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await GetContentReport.HandleAsync(new GetContentReport.QueryRequest(Days: limit + 1), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();

        (await GetQuestionQualityReport.HandleAsync(new GetQuestionQualityReport.QueryRequest(Days: limit), DbContext, CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await GetQuestionQualityReport.HandleAsync(new GetQuestionQualityReport.QueryRequest(Days: limit + 1), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();

        (await GetAcquisitionReport.HandleAsync(new GetAcquisitionReport.QueryRequest(Days: limit), DbContext, CancellationToken.None)).IsSuccess.Should().BeTrue();
        var rejected = await GetAcquisitionReport.HandleAsync(new GetAcquisitionReport.QueryRequest(Days: limit + 1), DbContext, CancellationToken.None);
        rejected.IsFailure.Should().BeTrue();
        rejected.Error.Description.Should().Contain("180");

        (await AdminUsersActivity.HandleGetUserActivityAsync(new AdminUsersActivity.UserActivityQueryRequest(Guid.NewGuid().ToString(), Days: limit + 1), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();
        var geo = new Mock<IIpGeolocationService>();
        (await AdminUsersActivity.HandleGetUsersAsync(new AdminUsersActivity.UsersQueryRequest(ActivityDays: limit + 1), DbContext, geo.Object, CancellationToken.None)).IsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task LifecycleWeeks_AreCappedAt25()
    {
        GetLifecycleReport.MaxWeeks.Should().Be(25);
        (await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(25), DbContext, CancellationToken.None)).IsSuccess.Should().BeTrue();
        var rejected = await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(26), DbContext, CancellationToken.None);
        rejected.IsFailure.Should().BeTrue();
        rejected.Error.Description.Should().Contain("180");
    }

    [Theory]
    [InlineData("203.0.113.77", "203.0.113.0/24")]
    [InlineData("::ffff:203.0.113.77", "203.0.113.0/24")]
    [InlineData("2001:db8:abcd:12:1:2:3:4", "2001:db8:abcd::/48")]
    [InlineData("unknown", "unknown")]
    [InlineData("", "unknown")]
    public void IpTruncation_UsesSlash24AndSlash48(string input, string expected)
    {
        IpTruncation.Truncate(input).Should().Be(expected);
    }

    [Fact]
    public void ParseLocation_ReadsCountryRegionAndCity_AndIgnoresBlanks()
    {
        using JsonDocument full = JsonDocument.Parse("""{"ip":"1.2.3.4","city":"Seattle","region":"Washington","country":"US"}""");
        IpGeolocationService.ParseLocation(full.RootElement).Should().Be(new IpLocation("US", "Washington", "Seattle"));

        using JsonDocument sparse = JsonDocument.Parse("""{"country":"PL","city":"  ","region":42}""");
        IpGeolocationService.ParseLocation(sparse.RootElement).Should().Be(new IpLocation("PL", null, null));
    }

    [Fact]
    public async Task SessionList_ShowsStoredRegionCityAndTruncatedIp()
    {
        DateTime start = DateTime.UtcNow.AddMinutes(-20);
        DbContext.PageViews.Add(new PageView
        {
            Id = Guid.NewGuid(), SessionId = "geo-1", IpAddress = "203.0.113.77", Path = "/", QueryString = "", Url = "/",
            UserAgent = "Mozilla/5.0", CreatedUtc = start
        });
        DbContext.AnalyticsSessions.Add(new AnalyticsSession
        {
            Id = Guid.NewGuid(), SessionId = "geo-1", FirstSeenUtc = start, Channel = "direct", DeviceClass = "desktop",
            Country = "US", Region = "Washington", City = "Seattle", CreatedUtc = start
        });
        await DbContext.SaveChangesAsync();

        var geo = new Mock<IIpGeolocationService>();
        var list = await GetPageViewSessions.HandleAsync(new GetPageViewSessions.QueryRequest(Days: 7), DbContext, geo.Object, CancellationToken.None);
        var row = list.Value!.Sessions.Single();
        row.Country.Should().Be("US");
        row.Region.Should().Be("Washington");
        row.City.Should().Be("Seattle");
        row.IpAddress.Should().Be("203.0.113.0/24");

        var detail = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("geo-1"), DbContext, geo.Object, CancellationToken.None);
        detail.Value!.City.Should().Be("Seattle");
        detail.Value.Region.Should().Be("Washington");
        detail.Value.IpAddress.Should().Be("203.0.113.0/24");
    }
}
