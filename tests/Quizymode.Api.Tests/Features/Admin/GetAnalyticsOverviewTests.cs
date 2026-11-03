using System.Net;
using FluentAssertions;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.Features.LearningLoop;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

/// <summary>ANALYTICS-005 (#125) admin overview: KPIs, previous-window comparison, zero-filled days, release markers.</summary>
public sealed class GetAnalyticsOverviewTests : DatabaseTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];
    private static readonly DateTime Now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);

    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(CreateDbContext, _ => { }, app => new GetAnalyticsOverview.Endpoint().MapEndpoint(app));
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private static PageView Hit(string sessionId, string path, DateTime createdUtc, bool isBot = false, bool isInternal = false, bool itemStep = false, Guid? userId = null) => new()
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

    private static AnalyticsSession Session(string sessionId, DateTime firstSeenUtc, string? appVersion) => new()
    {
        Id = Guid.NewGuid(),
        SessionId = sessionId,
        FirstSeenUtc = firstSeenUtc,
        LandingPath = "/",
        Channel = "direct",
        DeviceClass = "desktop",
        AppVersion = appVersion,
        CreatedUtc = firstSeenUtc
    };

    private Task<Result<GetAnalyticsOverview.Response>> Run(int days = 7) =>
        GetAnalyticsOverview.HandleAsync(new GetAnalyticsOverview.QueryRequest(days), DbContext, Now, CancellationToken.None);

    [Fact]
    public async Task Overview_ComputesKpisPreviousWindowAndZeroFilledDays()
    {
        Guid userId = Guid.NewGuid();
        DbContext.Users.Add(new User { Id = userId, Subject = "s1", CreatedAt = Now.AddDays(-1) });
        DbContext.Users.Add(new User { Id = Guid.NewGuid(), Subject = "s2", CreatedAt = Now.AddDays(-1), IsInternal = true });
        DbContext.Users.Add(new User { Id = Guid.NewGuid(), Subject = "s3", CreatedAt = Now.AddDays(-9) });
        DbContext.PageViews.AddRange(
            // current window: engaged + study session, bounce session, bot, internal
            Hit("a", "/quiz/x", Now.AddDays(-1)),
            Hit("a", "/quiz/x/item/1", Now.AddDays(-1).AddMinutes(1), itemStep: true),
            Hit("b", "/", Now.AddDays(-3)),
            Hit("bot", "/", Now.AddDays(-1), isBot: true),
            Hit("int", "/", Now.AddDays(-1), isInternal: true),
            // previous window
            Hit("p1", "/", Now.AddDays(-9)),
            Hit("p2", "/", Now.AddDays(-10)));
        await DbContext.SaveChangesAsync();

        Result<GetAnalyticsOverview.Response> result = await Run(7);

        result.IsSuccess.Should().BeTrue();
        GetAnalyticsOverview.Response response = result.Value;
        response.Current.HumanSessions.Should().Be(2);
        response.Current.EngagedSessions.Should().Be(1);
        response.Current.StudySessions.Should().Be(1);
        response.Current.NewSignups.Should().Be(1, "internal users are excluded");
        response.Previous.HumanSessions.Should().Be(2);
        response.Previous.NewSignups.Should().Be(1);
        response.Daily.Should().HaveCount(7);
        response.Daily.Select(point => point.Day).Should().BeInAscendingOrder().And.OnlyHaveUniqueItems();
        response.Daily.Sum(point => point.HumanSessions).Should().Be(2);
        response.Daily.Count(point => point.HumanSessions == 0).Should().Be(5);
        response.Daily[^1].Day.Should().Be(DateOnly.FromDateTime(Now));
    }

    [Fact]
    public async Task Overview_CountsPendingPicturesAndReportsTheOldestSubmission()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Item older = PictureSeed.AddPictureItem(DbContext, category, "u", false, ItemImageReviewState.PendingReview, PictureSeed.AddAsset(DbContext, "u"));
        Item newer = PictureSeed.AddPictureItem(DbContext, category, "u", true, ItemImageReviewState.PendingReview, PictureSeed.AddAsset(DbContext, "u"));
        PictureSeed.AddPictureItem(DbContext, category, "u", false, ItemImageReviewState.Approved, PictureSeed.AddAsset(DbContext, "u"));
        PictureSeed.AddPictureItem(DbContext, category, "u", false, ItemImageReviewState.Rejected, PictureSeed.AddAsset(DbContext, "u"));
        await DbContext.SaveChangesAsync();
        DateTime oldest = Now.AddDays(-4);
        DbContext.ItemImageReviews.Single(r => r.ItemId == older.Id).SubmittedAt = oldest;
        DbContext.ItemImageReviews.Single(r => r.ItemId == newer.Id).SubmittedAt = Now.AddDays(-1);
        await DbContext.SaveChangesAsync();

        Result<GetAnalyticsOverview.Response> result = await Run();

        result.Value.WorkQueue.PicturesAwaitingReview.Should().Be(2);
        result.Value.WorkQueue.OldestPictureSubmittedAt.Should().Be(oldest);
    }

    [Fact]
    public async Task Overview_WithNoPendingPictures_ReportsZeroAndNoOldest()
    {
        Result<GetAnalyticsOverview.Response> result = await Run();

        result.Value.WorkQueue.PicturesAwaitingReview.Should().Be(0);
        result.Value.WorkQueue.OldestPictureSubmittedAt.Should().BeNull();
    }

    [Fact]
    public async Task Overview_CountsWorkQueueIdeas()
    {
        DbContext.Ideas.Add(new Idea { Id = Guid.NewGuid(), Title = "t", Problem = "p", ProposedChange = "c", CreatedBy = "u" });
        await DbContext.SaveChangesAsync();

        Result<GetAnalyticsOverview.Response> result = await Run();

        result.Value.WorkQueue.IdeasAwaitingModeration.Should().Be(1);
        result.Value.WorkQueue.ItemsAwaitingReview.Should().Be(0);
        result.Value.WorkQueue.NewClientErrorGroups.Should().Be(0);
    }

    [Fact]
    public async Task Overview_CountsNewClientErrorGroupsExcludingInternalAndBots()
    {
        // The client-error report windows on the real clock, so these rows are dated relative to it.
        static ClientError Error(string fingerprint, string session, int daysAgo = 1, bool internalTraffic = false, bool bot = false) => new()
        {
            Id = Guid.NewGuid(),
            Source = "window",
            ErrorName = "TypeError",
            Message = "boom " + fingerprint,
            Path = "/",
            SessionId = session,
            Fingerprint = fingerprint,
            DeviceClass = "desktop",
            IsInternal = internalTraffic,
            IsBot = bot,
            OccurredUtc = DateTime.UtcNow.AddDays(-daysAgo)
        };

        DbContext.ClientErrors.AddRange(
            Error("fp-new", "s1"),
            Error("fp-new", "s2"),
            Error("fp-old", "s3", daysAgo: 20),
            Error("fp-old", "s4"),
            Error("fp-internal", "s5", internalTraffic: true),
            Error("fp-bot", "s6", bot: true));
        await DbContext.SaveChangesAsync();

        Result<GetAnalyticsOverview.Response> result = await Run();

        result.Value.WorkQueue.NewClientErrorGroups.Should().Be(1);
    }

    [Fact]
    public async Task Overview_RejectsUnsupportedDays()
    {
        (await Run(14)).IsSuccess.Should().BeFalse();
    }

    [Fact]
    public void ReleaseMarkers_SitOnFirstDayEachVersionAppearedAndOnlyInsideWindow()
    {
        DateTime start = new(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc);
        DateTime end = start.AddDays(7);

        List<GetAnalyticsOverview.ReleaseMarker> markers = GetAnalyticsOverview.ComputeReleaseMarkers(
            [
                ("3.62.0", start.AddDays(-20)),
                ("3.63.0", start.AddDays(2).AddHours(5)),
                ("3.64.0", start.AddDays(5))
            ],
            start,
            end);

        markers.Select(marker => marker.Version).Should().Equal("3.63.0", "3.64.0");
        markers[0].Day.Should().Be(new DateOnly(2026, 10, 12));
    }

    [Fact]
    public async Task Overview_PlacesMarkerOnFirstNonInternalDayOfVersion()
    {
        DbContext.PageViews.AddRange(
            Hit("v1", "/", Now.AddDays(-4)),
            Hit("v2", "/", Now.AddDays(-2)),
            Hit("vi", "/", Now.AddDays(-6), isInternal: true));
        DbContext.AnalyticsSessions.AddRange(
            Session("v1", Now.AddDays(-4), "3.64.0"),
            Session("v2", Now.AddDays(-2), "3.64.0"),
            Session("vi", Now.AddDays(-6), "3.64.0"));
        await DbContext.SaveChangesAsync();

        Result<GetAnalyticsOverview.Response> result = await Run();

        result.Value.ReleaseMarkers.Should().ContainSingle()
            .Which.Day.Should().Be(DateOnly.FromDateTime(Now.AddDays(-4)));
    }

    [Fact]
    public async Task Endpoint_RequiresAdmin()
    {
        async Task<HttpStatusCode> Get(string? token)
        {
            using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Get, "/admin/analytics/overview?days=7", token);
            using HttpResponseMessage response = await _host.Client.SendAsync(request);
            return response.StatusCode;
        }

        (await Get(null)).Should().Be(HttpStatusCode.Unauthorized);
        (await Get(_host.CreateToken("member", "member@example.com"))).Should().Be(HttpStatusCode.Forbidden);
        (await Get(_host.CreateToken("admin", "admin@example.com", AdminGroups))).Should().Be(HttpStatusCode.OK);
    }
}
