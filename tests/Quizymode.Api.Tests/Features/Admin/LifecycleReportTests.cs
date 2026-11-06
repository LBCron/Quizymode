using System.Net;
using FluentAssertions;
using Moq;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

public sealed class LifecycleReportTests : DatabaseTestFixture
{
    private static readonly DateTime Now = DateTime.UtcNow;

    private static IIpGeolocationService NullGeoService()
    {
        var mock = new Mock<IIpGeolocationService>();
        mock.Setup(g => g.GetCountryAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        return mock.Object;
    }

    private async Task<User> AddUser(string name, DateTime createdAt, bool isInternal = false)
    {
        User user = new()
        {
            Id = Guid.NewGuid(), Subject = "sub-" + name, Email = name + "@example.com", Name = name,
            CreatedAt = createdAt, LastLogin = createdAt, IsInternal = isInternal
        };
        await DbContext.Users.AddAsync(user);
        return user;
    }

    private static PageView Hit(Guid userId, DateTime at, string session = "s", string? area = null) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, IsAuthenticated = true, SessionId = session + userId.ToString("N")[..4],
        IpAddress = "203.0.113.1", Path = "/", Url = "/", Area = area, CreatedUtc = at
    };

    private static AnalyticsEvent Completed(Guid userId, DateTime at) => new()
    {
        Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.QuizCompleted, SessionId = "s", Path = "/", UserId = userId,
        RunId = Guid.NewGuid().ToString("N")[..8], Score = 5, Total = 10, OccurredUtc = at
    };

    private static AnalyticsSession Session(Guid? userId, string? visitorId, string channel, string? campaign, DateTime firstSeen) => new()
    {
        Id = Guid.NewGuid(), SessionId = Guid.NewGuid().ToString("N"), UserId = userId, VisitorId = visitorId, FirstSeenUtc = firstSeen,
        LandingPath = "/", LandingQuery = string.Empty, Channel = channel, UtmCampaign = campaign, DeviceClass = "desktop", CreatedUtc = firstSeen
    };

    [Fact]
    public async Task HandleAsync_CountsEachUserOnceAndComputesActivationAndRetention()
    {
        DateTime signup = Now.AddDays(-40);
        User activeAll = await AddUser("a", signup);
        User churned = await AddUser("b", signup);
        User internalUser = await AddUser("c", signup, isInternal: true);
        await DbContext.PageViews.AddRangeAsync(
            Hit(activeAll.Id, signup.AddDays(1)),
            Hit(activeAll.Id, signup.AddDays(1).AddHours(1)), // same day: still one active day
            Hit(activeAll.Id, signup.AddDays(8)), // week 1
            Hit(activeAll.Id, signup.AddDays(15)), // week 2
            Hit(activeAll.Id, signup.AddDays(29)), // week 4
            Hit(churned.Id, signup.AddDays(1)),
            Hit(internalUser.Id, signup.AddDays(8)));
        await DbContext.AnalyticsEvents.AddRangeAsync(
            Completed(activeAll.Id, signup.AddDays(2)),
            Completed(churned.Id, signup.AddDays(9))); // after the 7-day window
        await DbContext.SaveChangesAsync();

        GetLifecycleReport.Response report = (await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(12), DbContext, CancellationToken.None)).Value!;

        report.TotalSignups.Should().Be(2);
        GetLifecycleReport.CohortResponse cohort = report.Cohorts.Single();
        cohort.Signups.Should().Be(2);
        cohort.Activated7Days.Should().Be(1);
        cohort.ActivatedEligible.Should().Be(2);
        cohort.ActiveWeek1.Should().Be(1);
        cohort.ActiveWeek2.Should().Be(1);
        cohort.ActiveWeek4.Should().Be(1);
        cohort.EligibleWeek4.Should().Be(2);
    }

    [Fact]
    public async Task HandleAsync_RecentSignupsAreNotEligibleForLaterWeeks()
    {
        await AddUser("new", Now.AddDays(-2));
        await DbContext.SaveChangesAsync();

        GetLifecycleReport.CohortResponse cohort = (await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(4), DbContext, CancellationToken.None)).Value!.Cohorts.Single();

        cohort.Signups.Should().Be(1);
        cohort.ActivatedEligible.Should().Be(0);
        cohort.EligibleWeek1.Should().Be(0);
        cohort.EligibleWeek4.Should().Be(0);
    }

    [Fact]
    public async Task HandleAsync_SignupSourceIsTheVisitorsFirstSessionWithFallbackToConvertingSession()
    {
        User viaVisitor = await AddUser("v", Now.AddDays(-3));
        User noVisitor = await AddUser("n", Now.AddDays(-3));
        User noSessions = await AddUser("x", Now.AddDays(-3));
        await DbContext.AnalyticsSessions.AddRangeAsync(
            Session(null, "visitor-1", "paid-search", "spring", Now.AddDays(-10)), // first touch, anonymous
            Session(viaVisitor.Id, "visitor-1", "direct", null, Now.AddDays(-3)), // converting session
            Session(noVisitor.Id, null, "social", null, Now.AddDays(-3)));
        await DbContext.SaveChangesAsync();

        GetLifecycleReport.Response report = (await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(12), DbContext, CancellationToken.None)).Value!;

        report.Sources.Should().Contain(s => s.Channel == "paid-search" && s.Campaign == "spring" && s.Signups == 1);
        report.Sources.Should().Contain(s => s.Channel == "social" && s.Signups == 1);
        report.Sources.Should().Contain(s => s.Channel == GetLifecycleReport.UnknownChannel && s.Signups == 1);
        report.Sources.Should().NotContain(s => s.Channel == "direct");
        noSessions.Id.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public async Task HandleAsync_RejectsInvalidWeeks()
    {
        (await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(0), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();
        (await GetLifecycleReport.HandleAsync(new GetLifecycleReport.QueryRequest(26), DbContext, CancellationToken.None)).IsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task UsersList_SortsByColumnsAndFiltersDormantUsers()
    {
        User busy = await AddUser("busy", Now.AddDays(-90));
        User quiet = await AddUser("quiet", Now.AddDays(-90));
        User fresh = await AddUser("fresh", Now.AddDays(-2));
        await DbContext.PageViews.AddRangeAsync(
            Hit(busy.Id, Now.AddDays(-1), "a", "quiz"),
            Hit(busy.Id, Now.AddDays(-2), "b"),
            Hit(quiet.Id, Now.AddDays(-45)));
        await DbContext.Items.AddAsync(new Item { Id = Guid.NewGuid(), Question = "q", CorrectAnswer = "a", CreatedBy = busy.Id.ToString(), CreatedAt = Now });
        await DbContext.Collections.AddAsync(new Collection { Id = Guid.NewGuid(), Name = "c", CreatedBy = busy.Id.ToString(), CreatedAt = Now });
        await DbContext.SaveChangesAsync();

        AdminUsersActivity.UsersResponse bySessions = (await AdminUsersActivity.HandleGetUsersAsync(
            new AdminUsersActivity.UsersQueryRequest(ActivityDays: 30, SortBy: "sessions", SortDir: "desc"),
            DbContext, NullGeoService(), CancellationToken.None)).Value!;

        bySessions.Users[0].Name.Should().Be("busy");
        bySessions.Users[0].SessionsInWindow.Should().Be(2);
        bySessions.Users[0].StudySessionsInWindow.Should().Be(1);
        bySessions.Users[0].ItemsCreated.Should().Be(1);
        bySessions.Users[0].CollectionsCreated.Should().Be(1);

        AdminUsersActivity.UsersResponse ascending = (await AdminUsersActivity.HandleGetUsersAsync(
            new AdminUsersActivity.UsersQueryRequest(ActivityDays: 30, SortBy: "sessions", SortDir: "asc"),
            DbContext, NullGeoService(), CancellationToken.None)).Value!;
        ascending.Users.Last().Name.Should().Be("busy");

        AdminUsersActivity.UsersResponse dormant = (await AdminUsersActivity.HandleGetUsersAsync(
            new AdminUsersActivity.UsersQueryRequest(ActivityDays: 30, ActivityFilter: "dormant"),
            DbContext, NullGeoService(), CancellationToken.None)).Value!;
        dormant.Users.Select(u => u.Name).Should().BeEquivalentTo(["quiet"]);

        (await AdminUsersActivity.HandleGetUsersAsync(
            new AdminUsersActivity.UsersQueryRequest(SortBy: "nonsense"),
            DbContext, NullGeoService(), CancellationToken.None)).IsFailure.Should().BeTrue();
        fresh.Id.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public async Task Sessions_UserFilterReturnsOnlyThatUsersSessions()
    {
        User first = await AddUser("one", Now.AddDays(-5));
        User second = await AddUser("two", Now.AddDays(-5));
        await DbContext.PageViews.AddRangeAsync(
            Hit(first.Id, Now.AddHours(-3), "mine"),
            Hit(second.Id, Now.AddHours(-2), "theirs"));
        await DbContext.SaveChangesAsync();

        GetPageViewSessions.Response response = (await GetPageViewSessions.HandleAsync(
            new GetPageViewSessions.QueryRequest(Days: 7, UserId: first.Id), DbContext, NullGeoService(), CancellationToken.None)).Value!;

        response.Sessions.Should().ContainSingle();
        response.Sessions[0].SessionId.Should().StartWith("mine");
    }
}

/// <summary>ANALYTICS-010 (#130): only admins can read the lifecycle report, checked over real HTTP.</summary>
public sealed class LifecycleReportHttpTests : DatabaseTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];

    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(CreateDbContext, _ => { }, app => new GetLifecycleReport.Endpoint().MapEndpoint(app));
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private async Task<HttpStatusCode> GetAsync(string? token)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Get, "/admin/analytics/lifecycle?weeks=4", token);
        using HttpResponseMessage response = await _host.Client.SendAsync(request);
        return response.StatusCode;
    }

    [Fact]
    public async Task LifecycleReport_RejectsAnonymousAndNonAdminCallers()
    {
        (await GetAsync(null)).Should().Be(HttpStatusCode.Unauthorized);
        (await GetAsync(_host.CreateToken("member", "member@example.com"))).Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync(_host.CreateToken("admin", "admin@example.com", AdminGroups))).Should().Be(HttpStatusCode.OK);
    }
}
