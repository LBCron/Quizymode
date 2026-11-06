using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Quizymode.Api.Features.Analytics;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Analytics;

public sealed class TrackPageViewTests : DatabaseTestFixture
{
    private readonly Mock<IUserContext> _userContextMock = new();
    private readonly IAttributionClassifier _classifier = new AttributionClassifier();

    [Fact]
    public async Task HandleAsync_StoresAnonymousPageView()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext("198.51.100.24");

        TrackPageView.Request request = new("/categories/science", "?sort=popular", "session-anon-1");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView.Should().NotBeNull();
        pageView!.IsAuthenticated.Should().BeFalse();
        pageView.UserId.Should().BeNull();
        pageView.Path.Should().Be("/categories/science");
        pageView.QueryString.Should().Be("?sort=popular");
        pageView.Url.Should().Be("/categories/science?sort=popular");
        pageView.SessionId.Should().Be("session-anon-1");
        pageView.IpAddress.Should().Be("198.51.100.24");
        pageView.Area.Should().Be("browse");
        pageView.ScopeType.Should().Be("category");
        pageView.ScopeKey.Should().Be("science");
        pageView.NavPath.Should().Be("science");
        pageView.IsItemStep.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_ClassifiesQuizItemStepAtWriteTime()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext("198.51.100.25");

        TrackPageView.Request request = new("/quiz/geography/item/abc", "nav=capitals", "session-quiz-1");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();
        PageView pageView = await DbContext.PageViews.SingleAsync();
        pageView.Area.Should().Be("quiz");
        pageView.ScopeType.Should().Be("category");
        pageView.ScopeKey.Should().Be("geography");
        pageView.NavPath.Should().Be("geography/capitals");
        pageView.IsItemStep.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_StoresAuthenticatedPageView()
    {
        Guid userId = Guid.NewGuid();
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(true);
        _userContextMock.SetupGet(context => context.UserId).Returns(userId.ToString());
        DefaultHttpContext httpContext = CreateHttpContext("203.0.113.8");

        TrackPageView.Request request = new("/admin", string.Empty, "session-auth-1");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView.Should().NotBeNull();
        pageView!.IsAuthenticated.Should().BeTrue();
        pageView.UserId.Should().Be(userId);
        pageView.QueryString.Should().BeEmpty();
        pageView.Url.Should().Be("/admin");
    }

    [Theory]
    [InlineData("")]
    [InlineData("categories")]
    [InlineData(" ")]
    public async Task HandleAsync_InvalidPath_ReturnsValidationError(string path)
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext("203.0.113.99");

        TrackPageView.Request request = new(path, string.Empty, "session-1");

        var result = await HandleAsync(request, httpContext);

        result.IsFailure.Should().BeTrue();
        (await DbContext.PageViews.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task HandleAsync_NormalizesQueryStringWithoutLeadingQuestionMark()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext("192.0.2.50");

        TrackPageView.Request request = new("/collections", "page=2", "session-2");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView.Should().NotBeNull();
        pageView!.QueryString.Should().Be("?page=2");
        pageView.Url.Should().Be("/collections?page=2");
    }

    [Fact]
    public async Task HandleAsync_StoresUserAgentAndFlagsHumanTraffic()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        const string browserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        DefaultHttpContext httpContext = CreateHttpContext("198.51.100.24", browserAgent);

        TrackPageView.Request request = new("/categories", string.Empty, "session-human-1");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView!.UserAgent.Should().Be(browserAgent);
        pageView.IsBot.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_FlagsCrawlerTrafficAsBot()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext(
            "66.249.66.1",
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");

        TrackPageView.Request request = new("/", string.Empty, "session-bot-1");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView!.IsBot.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_MissingUserAgent_StoresNullAndIsNotABot()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext("198.51.100.30");

        TrackPageView.Request request = new("/", string.Empty, "session-no-ua");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView!.UserAgent.Should().BeNull();
        pageView.IsBot.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_TruncatesOverlongUserAgent()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        DefaultHttpContext httpContext = CreateHttpContext("198.51.100.31", new string('a', 900));

        TrackPageView.Request request = new("/", string.Empty, "session-long-ua");

        var result = await HandleAsync(request, httpContext);

        result.IsSuccess.Should().BeTrue();

        PageView? pageView = await DbContext.PageViews.SingleOrDefaultAsync();
        pageView!.UserAgent.Should().HaveLength(512);
    }

    [Fact]
    public async Task HandleAsync_OrdinaryVisitor_IsNotInternal()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        var result = await HandleAsync(
            new TrackPageView.Request("/", string.Empty, "session-visitor"),
            CreateHttpContext("198.51.100.40"));

        result.IsSuccess.Should().BeTrue();
        (await DbContext.PageViews.SingleAsync()).IsInternal.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_AdminCaller_IsStoredAsInternal()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(true);
        _userContextMock.SetupGet(context => context.UserId).Returns(Guid.NewGuid().ToString());
        _userContextMock.SetupGet(context => context.IsAdmin).Returns(true);

        var result = await HandleAsync(
            new TrackPageView.Request("/categories", string.Empty, "session-admin"),
            CreateHttpContext("198.51.100.41"));

        result.IsSuccess.Should().BeTrue();
        (await DbContext.PageViews.SingleAsync()).IsInternal.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_UserFlaggedInternal_IsStoredAsInternal()
    {
        Guid userId = Guid.NewGuid();
        DbContext.Users.Add(new User { Id = userId, Subject = "subject-internal", IsInternal = true });
        await DbContext.SaveChangesAsync();

        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(true);
        _userContextMock.SetupGet(context => context.UserId).Returns(userId.ToString());

        var result = await HandleAsync(
            new TrackPageView.Request("/collections", string.Empty, "session-internal-user"),
            CreateHttpContext("198.51.100.42"));

        result.IsSuccess.Should().BeTrue();
        (await DbContext.PageViews.SingleAsync()).IsInternal.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_InternalBrowserMarker_IsStoredAsInternalForAnonymousVisitor()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        var result = await HandleAsync(
            new TrackPageView.Request("/", string.Empty, "session-marked", InternalBrowser: true),
            CreateHttpContext("198.51.100.43"));

        result.IsSuccess.Should().BeTrue();
        PageView pageView = await DbContext.PageViews.SingleAsync();
        pageView.IsInternal.Should().BeTrue();
        pageView.IsAuthenticated.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_FirstHit_CreatesAnalyticsSessionWithAttribution()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        string visitorId = Guid.NewGuid().ToString();

        var result = await HandleAsync(
            new TrackPageView.Request(
                "/categories/science",
                "?utm_source=newsletter&utm_medium=email",
                "session-first-hit",
                VisitorId: visitorId,
                Referrer: "https://mail.google.com/",
                UtmSource: "newsletter",
                UtmMedium: "email"),
            CreateHttpContext("198.51.100.50", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"));

        result.IsSuccess.Should().BeTrue();

        AnalyticsSession session = await DbContext.AnalyticsSessions.SingleAsync();
        session.SessionId.Should().Be("session-first-hit");
        session.VisitorId.Should().Be(visitorId);
        session.LandingPath.Should().Be("/categories/science");
        session.LandingQuery.Should().Be("?utm_source=newsletter&utm_medium=email");
        session.UtmSource.Should().Be("newsletter");
        session.Channel.Should().Be("email");
        session.DeviceClass.Should().Be("desktop");
    }

    [Fact]
    public async Task HandleAsync_SubsequentHit_DoesNotModifyExistingAnalyticsSession()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        await HandleAsync(
            new TrackPageView.Request(
                "/",
                "?utm_source=first",
                "session-repeat",
                Referrer: "https://www.bing.com/search",
                UtmSource: "first"),
            CreateHttpContext("198.51.100.51"));

        await HandleAsync(
            new TrackPageView.Request(
                "/categories",
                "?utm_source=second",
                "session-repeat",
                Referrer: "https://www.facebook.com/",
                UtmSource: "second"),
            CreateHttpContext("198.51.100.51"));

        (await DbContext.AnalyticsSessions.CountAsync()).Should().Be(1);
        AnalyticsSession session = await DbContext.AnalyticsSessions.SingleAsync();
        session.LandingPath.Should().Be("/");
        session.UtmSource.Should().Be("first");
        // A utm_* tag takes priority over referrer-based classification (rule 3 before rule 4).
        session.Channel.Should().Be("campaign");

        (await DbContext.PageViews.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task HandleAsync_SignInLaterInSession_LinksUserAndVisitorWithoutChangingAttribution()
    {
        Guid userId = Guid.NewGuid();
        DbContext.Users.Add(new User { Id = userId, Subject = "sub-link", Email = "link@example.com" });
        await DbContext.SaveChangesAsync();

        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        await HandleAsync(
            new TrackPageView.Request("/", "?utm_source=reddit", "session-link", UtmSource: "reddit"),
            CreateHttpContext("198.51.100.60"));

        string visitorId = Guid.NewGuid().ToString();
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(true);
        _userContextMock.SetupGet(context => context.UserId).Returns(userId.ToString());

        await HandleAsync(
            new TrackPageView.Request("/collections", string.Empty, "session-link", VisitorId: visitorId, UtmSource: "other"),
            CreateHttpContext("198.51.100.60"));

        AnalyticsSession session = await DbContext.AnalyticsSessions.AsNoTracking().SingleAsync();
        session.UserId.Should().Be(userId);
        session.VisitorId.Should().Be(visitorId);
        session.UtmSource.Should().Be("reddit");
        session.LandingPath.Should().Be("/");
    }

    [Fact]
    public async Task HandleAsync_AppVersion_IsStoredOnFirstHitSnapshot()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        await HandleAsync(
            new TrackPageView.Request("/", string.Empty, "session-version", AppVersion: "3.60.0"),
            CreateHttpContext("198.51.100.61"));

        (await DbContext.AnalyticsSessions.SingleAsync()).AppVersion.Should().Be("3.60.0");
    }

    [Fact]
    public async Task HandleAsync_InvalidVisitorId_IsIgnoredButHitIsStillStored()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);

        var result = await HandleAsync(
            new TrackPageView.Request("/", string.Empty, "session-bad-visitor", VisitorId: "not-a-uuid"),
            CreateHttpContext("198.51.100.52"));

        result.IsSuccess.Should().BeTrue();
        (await DbContext.PageViews.CountAsync()).Should().Be(1);
        AnalyticsSession session = await DbContext.AnalyticsSessions.SingleAsync();
        session.VisitorId.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_OversizedUtmValues_AreTruncatedAndHitIsStillStored()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
        string oversizedUtmSource = new('x', 250);

        var result = await HandleAsync(
            new TrackPageView.Request(
                "/",
                string.Empty,
                "session-oversized-utm",
                UtmSource: oversizedUtmSource),
            CreateHttpContext("198.51.100.53"));

        result.IsSuccess.Should().BeTrue();
        AnalyticsSession session = await DbContext.AnalyticsSessions.SingleAsync();
        session.UtmSource.Should().HaveLength(100);
    }

    [Fact]
    public async Task HandleAsync_StoresRegionAndCityOnTheSessionSnapshot()
    {
        Mock<IIpGeolocationService> geo = new();
        geo.Setup(g => g.GetLocationAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new IpLocation("US", "Washington", "Seattle"));

        var result = await TrackPageView.HandleAsync(
            new TrackPageView.Request("/", string.Empty, "session-geo"),
            CreateHttpContext("198.51.100.77"),
            DbContext,
            _userContextMock.Object,
            _classifier,
            geo.Object,
            CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        AnalyticsSession session = await DbContext.AnalyticsSessions.SingleAsync();
        session.Country.Should().Be("US");
        session.Region.Should().Be("Washington");
        session.City.Should().Be("Seattle");
    }

    private Task<Result<TrackPageView.Response>> HandleAsync(TrackPageView.Request request, DefaultHttpContext httpContext)
    {
        return TrackPageView.HandleAsync(
            request,
            httpContext,
            DbContext,
            _userContextMock.Object,
            _classifier,
            NullGeoService(),
            CancellationToken.None);
    }

    private static IIpGeolocationService NullGeoService()
    {
        Mock<IIpGeolocationService> mock = new();
        mock.Setup(g => g.GetCountryAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        return mock.Object;
    }

    private static DefaultHttpContext CreateHttpContext(string ipAddress, string? userAgent = null)
    {
        DefaultHttpContext httpContext = new();
        httpContext.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(ipAddress);

        if (userAgent is not null)
        {
            httpContext.Request.Headers.UserAgent = userAgent;
        }

        return httpContext;
    }
}
