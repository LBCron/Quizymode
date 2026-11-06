using FluentAssertions;
using Moq;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

public sealed class GetPageViewSessionsTests : DatabaseTestFixture
{
    private static IIpGeolocationService NullGeoService()
    {
        var mock = new Mock<IIpGeolocationService>();
        mock.Setup(g => g.GetCountryAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        return mock.Object;
    }

    private static PageView Hit(
        string sessionId,
        string path,
        DateTime createdUtc,
        bool isAuthenticated = false,
        Guid? userId = null,
        bool isBot = false,
        string? userAgent = "Mozilla/5.0")
    {
        return new PageView
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            IsAuthenticated = isAuthenticated,
            SessionId = sessionId,
            IpAddress = "198.51.100.10",
            Path = path,
            QueryString = string.Empty,
            Url = path,
            UserAgent = userAgent,
            IsBot = isBot,
            CreatedUtc = createdUtc
        };
    }

    private Task<Quizymode.Api.Shared.Kernel.Result<GetPageViewSessions.Response>> Run(
        GetPageViewSessions.QueryRequest request)
    {
        return GetPageViewSessions.HandleAsync(request, DbContext, NullGeoService(), CancellationToken.None);
    }

    [Fact]
    public async Task HandleAsync_SeparatesBouncedFromEngagedSessions()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            // Bounce: a single hit and gone.
            Hit("bounce-1", "/categories", now.AddMinutes(-50)),
            // Engaged: four hits across three distinct pages.
            Hit("engaged-1", "/", now.AddMinutes(-40)),
            Hit("engaged-1", "/categories", now.AddMinutes(-38)),
            Hit("engaged-1", "/categories/science", now.AddMinutes(-35)),
            Hit("engaged-1", "/categories", now.AddMinutes(-30)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        result.IsSuccess.Should().BeTrue();
        GetPageViewSessions.SummaryResponse summary = result.Value!.Summary;

        summary.TotalSessions.Should().Be(2);
        summary.TotalPageHits.Should().Be(5);
        summary.BouncedSessions.Should().Be(1);
        summary.BounceRatePercent.Should().Be(50.0);
        summary.EngagedSessions.Should().Be(1);
        summary.AvgPagesPerSession.Should().Be(2.5);

        // Only the engaged session contributes duration; the bounce would otherwise
        // drag the average to zero.
        summary.AvgDurationSecondsEngaged.Should().Be(600);

        GetPageViewSessions.SessionResponse engaged =
            result.Value.Sessions.Single(session => session.SessionId == "engaged-1");
        engaged.PageHits.Should().Be(4);
        engaged.DistinctPages.Should().Be(3);
        engaged.IsBounce.Should().BeFalse();
        engaged.EntryPath.Should().Be("/");
        engaged.ExitPath.Should().Be("/categories");
        engaged.DurationSeconds.Should().Be(600);

        GetPageViewSessions.SessionResponse bounce =
            result.Value.Sessions.Single(session => session.SessionId == "bounce-1");
        bounce.IsBounce.Should().BeTrue();
        bounce.DurationSeconds.Should().Be(0);
        bounce.EntryPath.Should().Be("/categories");
        bounce.ExitPath.Should().Be("/categories");
    }

    [Fact]
    public async Task HandleAsync_ClassifiesOutcomesAndTheySumToTotalSessions()
    {
        DateTime now = DateTime.UtcNow;
        Guid userId = Guid.NewGuid();

        User user = new()
        {
            Id = userId,
            Subject = "subject-converted",
            Email = "converted@example.com",
            Name = "Converted User",
            CreatedAt = now.AddDays(-1),
            LastLogin = now
        };
        await DbContext.Users.AddAsync(user);

        await DbContext.PageViews.AddRangeAsync(
            // Never authenticated.
            Hit("anon-1", "/", now.AddMinutes(-60)),
            Hit("anon-1", "/about", now.AddMinutes(-58)),
            // Started anonymous, signed in partway through.
            Hit("converted-1", "/", now.AddMinutes(-50)),
            Hit("converted-1", "/login", now.AddMinutes(-48)),
            Hit("converted-1", "/collections", now.AddMinutes(-45), isAuthenticated: true, userId: userId),
            // Authenticated from the first hit.
            Hit("auth-1", "/collections", now.AddMinutes(-20), isAuthenticated: true, userId: userId));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        result.IsSuccess.Should().BeTrue();
        GetPageViewSessions.SummaryResponse summary = result.Value!.Summary;

        int anonymous = summary.ByOutcome.Single(o => o.Outcome == GetPageViewSessions.OutcomeAnonymous).Sessions;
        int converted = summary.ByOutcome.Single(o => o.Outcome == GetPageViewSessions.OutcomeConverted).Sessions;
        int authenticated = summary.ByOutcome.Single(o => o.Outcome == GetPageViewSessions.OutcomeAuthenticated).Sessions;

        anonymous.Should().Be(1);
        converted.Should().Be(1);
        authenticated.Should().Be(1);

        // The whole point of first-hit classification: buckets are mutually exclusive.
        (anonymous + converted + authenticated).Should().Be(summary.TotalSessions);

        GetPageViewSessions.SessionResponse convertedSession =
            result.Value.Sessions.Single(session => session.SessionId == "converted-1");
        convertedSession.Outcome.Should().Be(GetPageViewSessions.OutcomeConverted);
        convertedSession.EntryPath.Should().Be("/");
        convertedSession.ExitPath.Should().Be("/collections");
        // The user is only known from the later authenticated hit.
        convertedSession.UserEmail.Should().Be("converted@example.com");
    }

    [Fact]
    public async Task HandleAsync_MidSessionLogoutStaysAuthenticated()
    {
        DateTime now = DateTime.UtcNow;
        Guid userId = Guid.NewGuid();

        await DbContext.PageViews.AddRangeAsync(
            Hit("logout-1", "/collections", now.AddMinutes(-20), isAuthenticated: true, userId: userId),
            Hit("logout-1", "/", now.AddMinutes(-18)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        // Classifying on "all hits authenticated" would mislabel this as Converted.
        result.Value!.Sessions.Single().Outcome.Should().Be(GetPageViewSessions.OutcomeAuthenticated);
    }

    [Fact]
    public async Task HandleAsync_ExcludesBotsByDefaultAndIncludesThemOnRequest()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            Hit("human-1", "/", now.AddMinutes(-30)),
            Hit("human-1", "/categories", now.AddMinutes(-28)),
            Hit("bot-1", "/", now.AddMinutes(-25), isBot: true, userAgent: "Googlebot/2.1"),
            Hit("bot-2", "/about", now.AddMinutes(-24), isBot: true, userAgent: "AhrefsBot/7.0"));
        await DbContext.SaveChangesAsync();

        var excluded = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        excluded.Value!.Summary.TotalSessions.Should().Be(1);
        excluded.Value.Summary.BotSessions.Should().Be(2);
        excluded.Value.Summary.BotsExcluded.Should().BeTrue();
        // Without bot exclusion this would read as 67% bounce rate.
        excluded.Value.Summary.BounceRatePercent.Should().Be(0);

        var included = await Run(new GetPageViewSessions.QueryRequest(Days: 7, IncludeBots: true));

        included.Value!.Summary.TotalSessions.Should().Be(3);
        included.Value.Summary.BotsExcluded.Should().BeFalse();
        included.Value.Summary.BouncedSessions.Should().Be(2);
    }

    [Fact]
    public async Task HandleAsync_NullUserAgentIsTreatedAsHuman()
    {
        DateTime now = DateTime.UtcNow;

        // Rows recorded before user-agent capture existed.
        await DbContext.PageViews.AddRangeAsync(
            Hit("legacy-1", "/", now.AddMinutes(-30), userAgent: null));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        result.Value!.Summary.TotalSessions.Should().Be(1);
        result.Value.Sessions.Single().IsBot.Should().BeFalse();
        result.Value.Sessions.Single().UserAgent.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_PicksEntryAndExitDeterministicallyWhenTimestampsTie()
    {
        DateTime tie = DateTime.UtcNow.AddMinutes(-15);

        await DbContext.PageViews.AddRangeAsync(
            Hit("tie-1", "/first", tie),
            Hit("tie-1", "/second", tie),
            Hit("tie-1", "/last", tie.AddMinutes(5)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        // The duplicated boundary timestamp must still yield exactly one session row.
        result.Value!.Summary.TotalSessions.Should().Be(1);
        result.Value.Sessions.Should().ContainSingle();
        result.Value.Sessions.Single().PageHits.Should().Be(3);
        result.Value.Sessions.Single().ExitPath.Should().Be("/last");
    }

    [Fact]
    public async Task HandleAsync_BuildsDepthBucketsSplitByOutcome()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            Hit("anon-bounce", "/", now.AddMinutes(-40)),
            Hit("anon-two", "/", now.AddMinutes(-35)),
            Hit("anon-two", "/about", now.AddMinutes(-34)),
            Hit("anon-four", "/", now.AddMinutes(-30)),
            Hit("anon-four", "/a", now.AddMinutes(-29)),
            Hit("anon-four", "/b", now.AddMinutes(-28)),
            Hit("anon-four", "/c", now.AddMinutes(-27)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        List<GetPageViewSessions.DepthBucketResponse> buckets = result.Value!.DepthBuckets;

        buckets.Single(b => b.Label == "1 page").TotalSessions.Should().Be(1);
        buckets.Single(b => b.Label == "1 page").AnonymousSessions.Should().Be(1);
        buckets.Single(b => b.Label == "2 pages").TotalSessions.Should().Be(1);
        buckets.Single(b => b.Label == "3-5 pages").TotalSessions.Should().Be(1);
        buckets.Single(b => b.Label == "6-10 pages").TotalSessions.Should().Be(0);
        buckets.Sum(b => b.TotalSessions).Should().Be(result.Value.Summary.TotalSessions);
    }

    [Fact]
    public async Task HandleAsync_ReportsLandingPageBounceRates()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            // Two sessions land on /promo; both leave immediately.
            Hit("promo-1", "/promo", now.AddMinutes(-40)),
            Hit("promo-2", "/promo", now.AddMinutes(-38)),
            // One session lands on / and explores.
            Hit("home-1", "/", now.AddMinutes(-30)),
            Hit("home-1", "/categories", now.AddMinutes(-28)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        GetPageViewSessions.LandingPageResponse promo =
            result.Value!.LandingPages.Single(landing => landing.Path == "/promo");
        promo.Sessions.Should().Be(2);
        promo.BouncedSessions.Should().Be(2);
        promo.BounceRatePercent.Should().Be(100.0);

        GetPageViewSessions.LandingPageResponse home =
            result.Value.LandingPages.Single(landing => landing.Path == "/");
        home.Sessions.Should().Be(1);
        home.BounceRatePercent.Should().Be(0);
        home.AvgPagesPerSession.Should().Be(2);
    }

    [Fact]
    public async Task HandleAsync_OutcomeAndMinPagesFilterListButNotSummary()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            Hit("anon-bounce", "/", now.AddMinutes(-40)),
            Hit("anon-deep", "/", now.AddMinutes(-30)),
            Hit("anon-deep", "/a", now.AddMinutes(-29)),
            Hit("anon-deep", "/b", now.AddMinutes(-28)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7, MinPages: 2));

        // List narrows...
        result.Value!.Sessions.Should().ContainSingle();
        result.Value.Sessions.Single().SessionId.Should().Be("anon-deep");
        result.Value.TotalCount.Should().Be(1);

        // ...but the denominators stay describing the whole window.
        result.Value.Summary.TotalSessions.Should().Be(2);
        result.Value.Summary.BounceRatePercent.Should().Be(50.0);
    }

    [Fact]
    public async Task HandleAsync_SortsByPagesAndDuration()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            // Long but shallow: 2 hits an hour apart.
            Hit("long-1", "/", now.AddMinutes(-90)),
            Hit("long-1", "/a", now.AddMinutes(-30)),
            // Short but deep: 3 hits in two minutes.
            Hit("deep-1", "/", now.AddMinutes(-10)),
            Hit("deep-1", "/a", now.AddMinutes(-9)),
            Hit("deep-1", "/b", now.AddMinutes(-8)));
        await DbContext.SaveChangesAsync();

        var byPages = await Run(new GetPageViewSessions.QueryRequest(Days: 7, SortBy: "pages"));
        byPages.Value!.Sessions[0].SessionId.Should().Be("deep-1");

        var byDuration = await Run(new GetPageViewSessions.QueryRequest(Days: 7, SortBy: "duration"));
        byDuration.Value!.Sessions[0].SessionId.Should().Be("long-1");
    }

    [Fact]
    public async Task HandleAsync_InvalidDays_ReturnsValidationError()
    {
        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 0));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Admin.PageViewSessions.InvalidDays");
    }

    [Fact]
    public async Task HandleAsync_InvalidOutcome_ReturnsValidationError()
    {
        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7, Outcome: "lurkers"));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Admin.PageViewSessions.InvalidFilter");
    }

    [Fact]
    public async Task HandleAsync_InvalidSortBy_ReturnsValidationError()
    {
        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7, SortBy: "alphabetical"));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Admin.PageViewSessions.InvalidFilter");
    }

    [Fact]
    public async Task HandleAsync_ExcludesHitsOutsideTheWindow()
    {
        DateTime now = DateTime.UtcNow;

        await DbContext.PageViews.AddRangeAsync(
            Hit("old-1", "/", now.AddDays(-40)),
            Hit("recent-1", "/", now.AddHours(-2)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        result.Value!.Summary.TotalSessions.Should().Be(1);
        result.Value.Sessions.Single().SessionId.Should().Be("recent-1");
    }

    private static AnalyticsSession Snapshot(string sessionId, string? visitorId, DateTime firstSeenUtc, string channel = "direct")
    {
        return new AnalyticsSession
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            VisitorId = visitorId,
            FirstSeenUtc = firstSeenUtc,
            Channel = channel,
            DeviceClass = "desktop",
            CreatedUtc = firstSeenUtc
        };
    }

    private static AnalyticsEvent Event(string sessionId, string name, string runId, DateTime occurredUtc, int? score = null, int? total = null)
    {
        return new AnalyticsEvent
        {
            Id = Guid.NewGuid(),
            EventName = name,
            SessionId = sessionId,
            RunId = runId,
            ContextType = "category",
            ContextId = "science",
            Path = "/quiz",
            Score = score,
            Total = total,
            OccurredUtc = occurredUtc
        };
    }

    [Fact]
    public async Task HandleAsync_SessionIdFilter_KeepsOnlyThatSession_AndComposesWithUserId()
    {
        DateTime now = DateTime.UtcNow;
        Guid userId = Guid.NewGuid();

        await DbContext.PageViews.AddRangeAsync(
            Hit("s-a", "/", now.AddMinutes(-30), isAuthenticated: true, userId: userId),
            Hit("s-a", "/categories", now.AddMinutes(-29), isAuthenticated: true, userId: userId),
            Hit("s-b", "/", now.AddMinutes(-20)),
            Hit("s-c", "/", now.AddMinutes(-10), isAuthenticated: true, userId: userId));
        await DbContext.SaveChangesAsync();

        var only = await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: "  s-b "));
        only.Value!.Sessions.Should().ContainSingle().Which.SessionId.Should().Be("s-b");
        only.Value.TotalCount.Should().Be(1);

        var both = await Run(new GetPageViewSessions.QueryRequest(Days: 7, UserId: userId, SessionId: "s-b"));
        both.Value!.Sessions.Should().BeEmpty();

        var match = await Run(new GetPageViewSessions.QueryRequest(Days: 7, UserId: userId, SessionId: "s-a"));
        match.Value!.Sessions.Should().ContainSingle().Which.SessionId.Should().Be("s-a");
    }

    [Fact]
    public async Task HandleAsync_SessionIdFilter_StillExcludesBotsAndInternalByDefault()
    {
        DateTime now = DateTime.UtcNow;
        PageView internalHit = Hit("s-int", "/", now.AddMinutes(-5));
        internalHit.IsInternal = true;

        await DbContext.PageViews.AddRangeAsync(Hit("s-bot", "/", now.AddMinutes(-5), isBot: true), internalHit);
        await DbContext.SaveChangesAsync();

        (await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: "s-bot"))).Value!.Sessions.Should().BeEmpty();
        (await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: "s-int"))).Value!.Sessions.Should().BeEmpty();
        (await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: "s-bot", IncludeBots: true))).Value!.Sessions.Should().HaveCount(1);
        (await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: "s-int", IncludeInternal: true))).Value!.Sessions.Should().HaveCount(1);
    }

    [Fact]
    public async Task HandleAsync_OverLengthSessionId_ReturnsValidationError()
    {
        var accepted = await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: new string('x', 128)));
        accepted.IsSuccess.Should().BeTrue();

        var rejected = await Run(new GetPageViewSessions.QueryRequest(Days: 7, SessionId: new string('x', 129)));
        rejected.IsFailure.Should().BeTrue();
        rejected.Error.Code.Should().Be("Admin.PageViewSessions.InvalidFilter");
    }

    [Fact]
    public async Task HandleAsync_NonGuidVisitorId_ReturnsValidationError()
    {
        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7, VisitorId: "not-a-guid"));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Admin.PageViewSessions.InvalidFilter");
    }

    [Fact]
    public async Task HandleAsync_VisitorFilter_ReturnsOnlyThatVisitorsSessions_AndReportsVisitorType()
    {
        DateTime now = DateTime.UtcNow;
        string visitor = Guid.NewGuid().ToString();
        string other = Guid.NewGuid().ToString();

        await DbContext.PageViews.AddRangeAsync(
            Hit("v-1", "/", now.AddHours(-3)),
            Hit("v-2", "/", now.AddHours(-1)),
            Hit("o-1", "/", now.AddHours(-2)),
            Hit("n-1", "/", now.AddHours(-2)));
        await DbContext.AnalyticsSessions.AddRangeAsync(
            Snapshot("v-1", visitor, now.AddHours(-3), "search"),
            Snapshot("v-2", visitor, now.AddHours(-1)),
            Snapshot("o-1", other, now.AddHours(-2)),
            Snapshot("n-1", null, now.AddHours(-2)));
        await DbContext.SaveChangesAsync();

        var filtered = await Run(new GetPageViewSessions.QueryRequest(Days: 7, VisitorId: visitor.ToUpperInvariant()));
        filtered.Value!.Sessions.Select(s => s.SessionId).Should().BeEquivalentTo(["v-1", "v-2"]);

        var all = await Run(new GetPageViewSessions.QueryRequest(Days: 7));
        GetPageViewSessions.SessionResponse first = all.Value!.Sessions.Single(s => s.SessionId == "v-1");
        first.VisitorType.Should().Be("new");
        first.Channel.Should().Be("search");
        first.SessionsFromVisitor.Should().Be(2);
        all.Value.Sessions.Single(s => s.SessionId == "v-2").VisitorType.Should().Be("returning");

        GetPageViewSessions.SessionResponse noVisitor = all.Value.Sessions.Single(s => s.SessionId == "n-1");
        noVisitor.VisitorType.Should().Be("unknown");
        noVisitor.VisitorId.Should().BeNull();
        noVisitor.SessionsFromVisitor.Should().Be(0);
    }

    [Fact]
    public async Task HandleAsync_CountsGamesAndQuizRunsPerSession()
    {
        DateTime now = DateTime.UtcNow;
        await DbContext.PageViews.AddRangeAsync(
            Hit("act-1", "/", now.AddMinutes(-30)),
            Hit("act-2", "/", now.AddMinutes(-30)));
        await DbContext.AnalyticsEvents.AddRangeAsync(
            Event("act-1", AnalyticsEventCatalog.GameStarted, "g1", now.AddMinutes(-29)),
            Event("act-1", AnalyticsEventCatalog.GameCompleted, "g1", now.AddMinutes(-28)),
            Event("act-1", AnalyticsEventCatalog.GameStarted, "g2", now.AddMinutes(-27)),
            Event("act-1", AnalyticsEventCatalog.QuickQuizStarted, "q1", now.AddMinutes(-26)),
            Event("act-1", AnalyticsEventCatalog.QuizCompleted, "q1", now.AddMinutes(-25), score: 3, total: 5),
            Event("act-1", AnalyticsEventCatalog.FlashcardsStarted, "f1", now.AddMinutes(-24)),
            Event("act-1", AnalyticsEventCatalog.QuestionAnswered, "q1", now.AddMinutes(-25)));
        await DbContext.SaveChangesAsync();

        var result = await Run(new GetPageViewSessions.QueryRequest(Days: 7));

        GetPageViewSessions.SessionResponse busy = result.Value!.Sessions.Single(s => s.SessionId == "act-1");
        busy.GamesPlayed.Should().Be(2);
        busy.GamesCompleted.Should().Be(1);
        busy.QuizRuns.Should().Be(2);
        busy.QuizzesCompleted.Should().Be(1);

        GetPageViewSessions.SessionResponse idle = result.Value.Sessions.Single(s => s.SessionId == "act-2");
        (idle.GamesPlayed, idle.GamesCompleted, idle.QuizRuns, idle.QuizzesCompleted).Should().Be((0, 0, 0, 0));
    }
}
