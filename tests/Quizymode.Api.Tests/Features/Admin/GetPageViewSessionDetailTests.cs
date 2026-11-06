using FluentAssertions;
using Moq;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

public sealed class GetPageViewSessionDetailTests : DatabaseTestFixture
{
    private static IIpGeolocationService GeoService(string? country = null)
    {
        var mock = new Mock<IIpGeolocationService>();
        mock.Setup(g => g.GetCountryAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(country);
        return mock.Object;
    }

    private static PageView Hit(
        string sessionId,
        string path,
        DateTime createdUtc,
        bool isAuthenticated = false,
        Guid? userId = null)
    {
        return new PageView
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            IsAuthenticated = isAuthenticated,
            SessionId = sessionId,
            IpAddress = "203.0.113.7",
            Path = path,
            QueryString = string.Empty,
            Url = path,
            UserAgent = "Mozilla/5.0",
            IsBot = false,
            CreatedUtc = createdUtc
        };
    }

    [Fact]
    public async Task HandleAsync_ReturnsOrderedJourneyWithDwellTimes()
    {
        DateTime start = DateTime.UtcNow.AddMinutes(-30);

        // Inserted out of order to prove the handler sorts rather than relying on insert order.
        await DbContext.PageViews.AddRangeAsync(
            Hit("journey-1", "/categories", start.AddMinutes(2)),
            Hit("journey-1", "/", start),
            Hit("journey-1", "/categories/science", start.AddMinutes(7)));
        await DbContext.SaveChangesAsync();

        var result = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("journey-1"),
            DbContext,
            GeoService(),
            CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.PageHits.Should().Be(3);
        result.Value.DistinctPages.Should().Be(3);
        result.Value.IsBounce.Should().BeFalse();
        result.Value.DurationSeconds.Should().Be(420);

        result.Value.Steps.Select(step => step.Path)
            .Should().ContainInOrder("/", "/categories", "/categories/science");
        result.Value.Steps.Select(step => step.StepNumber).Should().ContainInOrder(1, 2, 3);

        result.Value.Steps[0].DwellSeconds.Should().Be(120);
        result.Value.Steps[1].DwellSeconds.Should().Be(300);
        // No exit event exists, so the final step's dwell time is unknown, not zero.
        result.Value.Steps[2].DwellSeconds.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_SingleHitSessionIsABounceWithNoDwellTime()
    {
        await DbContext.PageViews.AddRangeAsync(
            Hit("bounce-1", "/promo", DateTime.UtcNow.AddMinutes(-5)));
        await DbContext.SaveChangesAsync();

        var result = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("bounce-1"),
            DbContext,
            GeoService(),
            CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.IsBounce.Should().BeTrue();
        result.Value.DurationSeconds.Should().Be(0);
        result.Value.Steps.Should().ContainSingle();
        result.Value.Steps[0].DwellSeconds.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_ResolvesConvertedOutcomeAndUserEmail()
    {
        DateTime start = DateTime.UtcNow.AddMinutes(-20);
        Guid userId = Guid.NewGuid();

        await DbContext.Users.AddAsync(new User
        {
            Id = userId,
            Subject = "subject-1",
            Email = "visitor@example.com",
            Name = "Visitor",
            CreatedAt = start,
            LastLogin = DateTime.UtcNow
        });

        await DbContext.PageViews.AddRangeAsync(
            Hit("converted-1", "/", start),
            Hit("converted-1", "/collections", start.AddMinutes(3), isAuthenticated: true, userId: userId));
        await DbContext.SaveChangesAsync();

        var result = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("converted-1"),
            DbContext,
            GeoService("US"),
            CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Outcome.Should().Be(GetPageViewSessions.OutcomeConverted);
        result.Value.UserEmail.Should().Be("visitor@example.com");
        result.Value.Country.Should().Be("US");
        result.Value.Steps[0].IsAuthenticated.Should().BeFalse();
        result.Value.Steps[1].IsAuthenticated.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_UnknownSession_ReturnsNotFound()
    {
        var result = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("does-not-exist"),
            DbContext,
            GeoService(),
            CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Admin.PageViewSessionDetail.NotFound");
    }

    [Fact]
    public async Task HandleAsync_BlankSessionId_ReturnsValidationError()
    {
        var result = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("   "),
            DbContext,
            GeoService(),
            CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Admin.PageViewSessionDetail.InvalidSessionId");
    }

    [Fact]
    public async Task HandleAsync_ReturnsActivitiesVisitorAndChannel()
    {
        DateTime start = DateTime.UtcNow.AddMinutes(-30);
        string visitor = Guid.NewGuid().ToString();

        await DbContext.PageViews.AddAsync(Hit("act-d", "/", start));
        await DbContext.AnalyticsSessions.AddRangeAsync(
            new AnalyticsSession { Id = Guid.NewGuid(), SessionId = "earlier", VisitorId = visitor, FirstSeenUtc = start.AddDays(-1), Channel = "direct", DeviceClass = "desktop", CreatedUtc = start.AddDays(-1) },
            new AnalyticsSession { Id = Guid.NewGuid(), SessionId = "act-d", VisitorId = visitor, FirstSeenUtc = start, Channel = "search", DeviceClass = "desktop", CreatedUtc = start });
        await DbContext.AnalyticsEvents.AddRangeAsync(
            new AnalyticsEvent { Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.QuickQuizStarted, SessionId = "act-d", RunId = "r1", ContextType = "category", ContextId = "science", Path = "/quiz", OccurredUtc = start.AddMinutes(1) },
            new AnalyticsEvent { Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.QuizCompleted, SessionId = "act-d", RunId = "r1", Score = 4, Total = 5, Path = "/quiz", OccurredUtc = start.AddMinutes(3) },
            new AnalyticsEvent { Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.GameStarted, SessionId = "act-d", RunId = "r2", Path = "/games", OccurredUtc = start.AddMinutes(5) },
            new AnalyticsEvent { Id = Guid.NewGuid(), EventName = AnalyticsEventCatalog.GameStarted, SessionId = "other-session", RunId = "r9", Path = "/games", OccurredUtc = start.AddMinutes(5) });
        await DbContext.SaveChangesAsync();

        var result = await GetPageViewSessionDetail.HandleAsync(
            new GetPageViewSessionDetail.QueryRequest("act-d"), DbContext, GeoService(), CancellationToken.None);

        result.Value!.VisitorId.Should().Be(visitor);
        result.Value.VisitorType.Should().Be("returning");
        result.Value.SessionsFromVisitor.Should().Be(2);
        result.Value.Channel.Should().Be("search");
        result.Value.Activities.Should().HaveCount(2);
        result.Value.Activities[0].Kind.Should().Be("quiz");
        result.Value.Activities[0].Score.Should().Be(4);
        result.Value.Activities[0].Total.Should().Be(5);
        result.Value.Activities[0].CompletedUtc.Should().NotBeNull();
        result.Value.Activities[1].Kind.Should().Be("game");
        result.Value.Activities[1].CompletedUtc.Should().BeNull();
    }
}
