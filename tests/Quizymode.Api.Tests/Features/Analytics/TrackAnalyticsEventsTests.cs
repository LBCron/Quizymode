using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using FluentValidation.Results;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Quizymode.Api.Features.Analytics;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.StartupExtensions;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Analytics;

public sealed class TrackAnalyticsEventsTests : DatabaseTestFixture
{
    private readonly Mock<IUserContext> _userContextMock = new();

    public TrackAnalyticsEventsTests()
    {
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(false);
        _userContextMock.SetupGet(context => context.UserId).Returns((string?)null);
    }

    private static DefaultHttpContext HttpContext(string userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0")
    {
        DefaultHttpContext context = new();
        context.Request.Headers.UserAgent = userAgent;
        return context;
    }

    private async Task<TrackAnalyticsEvents.Response> Track(
        string sessionId,
        params TrackAnalyticsEvents.EventRequest[] events)
    {
        TrackAnalyticsEvents.Request request = new(sessionId, [.. events]);
        new TrackAnalyticsEvents.Validator().Validate(request).IsValid.Should().BeTrue();

        var result = await TrackAnalyticsEvents.HandleAsync(
            request, HttpContext(), DbContext, _userContextMock.Object, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    [Fact]
    public async Task HandleAsync_FlagsInternalTrafficAtWriteTime()
    {
        Guid flaggedUserId = Guid.NewGuid();
        await DbContext.Users.AddAsync(new User { Id = flaggedUserId, Subject = "flagged", Email = "flagged@example.com", Name = "Flagged", IsInternal = true });
        await DbContext.SaveChangesAsync();
        TrackAnalyticsEvents.EventRequest started = new(AnalyticsEventCatalog.QuickQuizStarted, "/", RunId: "r");

        // Plain anonymous visitor.
        await Track("s-plain", started);

        // Browser carrying the internal marker.
        TrackAnalyticsEvents.Request marked = new("s-marked", [started], InternalBrowser: true);
        (await TrackAnalyticsEvents.HandleAsync(marked, HttpContext(), DbContext, _userContextMock.Object, CancellationToken.None))
            .IsSuccess.Should().BeTrue();

        // Admin caller.
        _userContextMock.SetupGet(context => context.IsAdmin).Returns(true);
        await Track("s-admin", started);
        _userContextMock.SetupGet(context => context.IsAdmin).Returns(false);

        // User already flagged internal.
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(true);
        _userContextMock.SetupGet(context => context.UserId).Returns(flaggedUserId.ToString());
        await Track("s-flagged", started);

        Dictionary<string, bool> internalBySession = await DbContext.AnalyticsEvents.AsNoTracking()
            .ToDictionaryAsync(analyticsEvent => analyticsEvent.SessionId, analyticsEvent => analyticsEvent.IsInternal);
        internalBySession.Should().BeEquivalentTo(new Dictionary<string, bool>
        {
            ["s-plain"] = false,
            ["s-marked"] = true,
            ["s-admin"] = true,
            ["s-flagged"] = true
        });
    }

    private static TrackAnalyticsEvents.EventRequest Completed(string runId, int score = 7, int total = 10) =>
        new(AnalyticsEventCatalog.QuizCompleted, "/quiz/science", "category", "science", RunId: runId, Score: score, Total: total);

    [Fact]
    public async Task HandleAsync_StoresAnonymousEventWithBoundedFieldsAndServerTime()
    {
        DateTime before = DateTime.UtcNow;

        TrackAnalyticsEvents.Response response = await Track(
            "session-anon",
            new TrackAnalyticsEvents.EventRequest(
                AnalyticsEventCatalog.QuickQuizStarted, "/quiz/science?item=abc#top", "quiz", "home-quick", RunId: "run-1", Total: 10));

        response.Should().Be(new TrackAnalyticsEvents.Response(1, 0));
        AnalyticsEvent stored = await DbContext.AnalyticsEvents.SingleAsync();
        stored.EventName.Should().Be("quick_quiz_started");
        stored.SessionId.Should().Be("session-anon");
        stored.Path.Should().Be("/quiz/science", "query strings and fragments are never stored");
        stored.ContextType.Should().Be("quiz");
        stored.ContextId.Should().Be("home-quick");
        stored.RunId.Should().Be("run-1");
        stored.Total.Should().Be(10);
        stored.UserId.Should().BeNull();
        stored.IsAuthenticated.Should().BeFalse();
        stored.IsBot.Should().BeFalse();
        stored.OccurredUtc.Should().BeOnOrAfter(before);
    }

    [Fact]
    public async Task HandleAsync_AcceptsLearnContextTypeWithPrefixedContextId()
    {
        string collectionId = $"collection:{Guid.NewGuid()}";

        TrackAnalyticsEvents.Response response = await Track(
            "session-learn",
            new TrackAnalyticsEvents.EventRequest(
                AnalyticsEventCatalog.QuickQuizStarted, "/learn/science", "learn", collectionId, RunId: "learn-run", Total: 12),
            new TrackAnalyticsEvents.EventRequest(
                AnalyticsEventCatalog.QuizCompleted, "/learn/science", "learn", "category:science", RunId: "learn-run", Score: 9, Total: 12));

        response.Should().Be(new TrackAnalyticsEvents.Response(2, 0));
        List<AnalyticsEvent> stored = await DbContext.AnalyticsEvents.OrderBy(e => e.EventName).ToListAsync();
        stored.Should().OnlyContain(e => e.ContextType == "learn");
        stored.Select(e => e.ContextId).Should().BeEquivalentTo(collectionId, "category:science");
    }

    [Fact]
    public async Task HandleAsync_AssociatesAuthenticatedUser()
    {
        Guid userId = Guid.NewGuid();
        _userContextMock.SetupGet(context => context.IsAuthenticated).Returns(true);
        _userContextMock.SetupGet(context => context.UserId).Returns(userId.ToString());

        await Track("session-auth", new TrackAnalyticsEvents.EventRequest(AnalyticsEventCatalog.SignInCompleted, "/login"));

        AnalyticsEvent stored = await DbContext.AnalyticsEvents.SingleAsync();
        stored.UserId.Should().Be(userId);
        stored.IsAuthenticated.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_RetriedQuizCompletionForSameRun_IsStoredOnce()
    {
        TrackAnalyticsEvents.Response first = await Track("session-1", Completed("run-a"));
        TrackAnalyticsEvents.Response retry = await Track("session-1", Completed("run-a", score: 9));
        TrackAnalyticsEvents.Response replay = await Track("session-1", Completed("run-b"));

        first.Should().Be(new TrackAnalyticsEvents.Response(1, 0));
        retry.Should().Be(new TrackAnalyticsEvents.Response(0, 1));
        replay.Should().Be(new TrackAnalyticsEvents.Response(1, 0), "Play again is a new run");

        List<AnalyticsEvent> completions = await DbContext.AnalyticsEvents.OrderBy(e => e.RunId).ToListAsync();
        completions.Select(e => e.RunId).Should().Equal("run-a", "run-b");
        completions[0].Score.Should().Be(7, "the first completion for a run is kept");
    }

    [Fact]
    public async Task HandleAsync_DuplicatesInsideOneBatch_AreStoredOnce()
    {
        TrackAnalyticsEvents.Response response = await Track("session-2", Completed("run-a"), Completed("run-a"));

        response.Should().Be(new TrackAnalyticsEvents.Response(1, 1));
        (await DbContext.AnalyticsEvents.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task HandleAsync_SameRunIdInDifferentSessions_IsStoredForEach()
    {
        await Track("session-x", Completed("run-a"));
        await Track("session-y", Completed("run-a"));

        (await DbContext.AnalyticsEvents.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task HandleAsync_ClientEventIdDedupesImpressions_AndEventsWithoutIdsAreKept()
    {
        TrackAnalyticsEvents.EventRequest impression = new(
            AnalyticsEventCatalog.SignupPromptViewed, "/quiz/science", "quiz", "results-panel", ClientEventId: "impression-1");
        TrackAnalyticsEvents.EventRequest untracked = new(AnalyticsEventCatalog.SignupFormStarted, "/signup");

        await Track("session-3", impression, untracked);
        TrackAnalyticsEvents.Response again = await Track("session-3", impression, untracked);

        again.Should().Be(new TrackAnalyticsEvents.Response(1, 1));
        (await DbContext.AnalyticsEvents.CountAsync(e => e.EventName == AnalyticsEventCatalog.SignupPromptViewed)).Should().Be(1);
        (await DbContext.AnalyticsEvents.CountAsync(e => e.EventName == AnalyticsEventCatalog.SignupFormStarted)).Should().Be(2);
    }

    [Fact]
    public async Task HandleAsync_FlagsCrawlerEventsAsBot()
    {
        TrackAnalyticsEvents.Request request = new(
            "session-bot",
            [new TrackAnalyticsEvents.EventRequest(AnalyticsEventCatalog.SignupPromptViewed, "/")]);

        await TrackAnalyticsEvents.HandleAsync(
            request,
            HttpContext("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
            DbContext,
            _userContextMock.Object,
            CancellationToken.None);

        (await DbContext.AnalyticsEvents.SingleAsync()).IsBot.Should().BeTrue();
    }

    public static TheoryData<string, TrackAnalyticsEvents.EventRequest> InvalidEvents => new()
    {
        { "unknown name", new("page_scrolled", "/") },
        { "blank name", new("", "/") },
        { "absolute url path", new(AnalyticsEventCatalog.SignupSubmitted, "https://evil.example/") },
        { "protocol-relative path", new(AnalyticsEventCatalog.SignupSubmitted, "//evil.example/") },
        { "oversized path", new(AnalyticsEventCatalog.SignupSubmitted, "/" + new string('a', 512)) },
        { "unknown context type", new(AnalyticsEventCatalog.SignupPromptViewed, "/", "email", "x") },
        { "context id without type", new(AnalyticsEventCatalog.SignupPromptViewed, "/", null, "x") },
        { "oversized context id", new(AnalyticsEventCatalog.SignupPromptViewed, "/", "quiz", new string('a', 129)) },
        { "context id with spaces", new(AnalyticsEventCatalog.SignupPromptViewed, "/", "quiz", "has spaces") },
        { "oversized client event id", new(AnalyticsEventCatalog.SignupPromptViewed, "/", ClientEventId: new string('a', 65)) },
        { "completion without run", new(AnalyticsEventCatalog.QuizCompleted, "/", Score: 1, Total: 2) },
        { "completion without score", new(AnalyticsEventCatalog.QuizCompleted, "/", RunId: "r", Total: 2) },
        { "score above total", new(AnalyticsEventCatalog.QuizCompleted, "/", RunId: "r", Score: 3, Total: 2) },
        { "negative score", new(AnalyticsEventCatalog.QuizCompleted, "/", RunId: "r", Score: -1, Total: 2) },
        { "total out of range", new(AnalyticsEventCatalog.QuizCompleted, "/", RunId: "r", Score: 1, Total: 1001) },
        { "score out of range", new(AnalyticsEventCatalog.QuizCompleted, "/", RunId: "r", Score: 1001, Total: 1001) },
        { "field not allowed for event", new(AnalyticsEventCatalog.SignupSubmitted, "/", Score: 1) },
        { "item fields reserved for study events", new(AnalyticsEventCatalog.QuizCompleted, "/", RunId: "r", Score: 1, Total: 2, ItemId: Guid.NewGuid()) },
        { "answer without correctness", new(AnalyticsEventCatalog.QuestionAnswered, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1) },
        { "answer without item", new(AnalyticsEventCatalog.QuestionAnswered, "/", RunId: "r", Position: 1, IsCorrect: true) },
        { "answer position zero", new(AnalyticsEventCatalog.QuestionAnswered, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 0, IsCorrect: true) },
        { "answer position out of range", new(AnalyticsEventCatalog.QuestionAnswered, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1001, IsCorrect: true) },
        { "answer with score", new(AnalyticsEventCatalog.QuestionAnswered, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1, IsCorrect: true, Score: 1) },
        { "reveal without position", new(AnalyticsEventCatalog.FlashcardRevealed, "/", RunId: "r", ItemId: Guid.NewGuid()) },
        { "reveal with correctness", new(AnalyticsEventCatalog.FlashcardRevealed, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1, IsCorrect: true) },
        { "grade without correctness", new(AnalyticsEventCatalog.FlashcardGraded, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1) },
        { "grade without item", new(AnalyticsEventCatalog.FlashcardGraded, "/", RunId: "r", Position: 1, IsCorrect: true) },
        { "grade without position", new(AnalyticsEventCatalog.FlashcardGraded, "/", RunId: "r", ItemId: Guid.NewGuid(), IsCorrect: true) },
        { "grade with score", new(AnalyticsEventCatalog.FlashcardGraded, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1, IsCorrect: true, Score: 1) },
        { "share without score", new(AnalyticsEventCatalog.QuizResultShared, "/", RunId: "r", Total: 2) },
        { "share without run", new(AnalyticsEventCatalog.QuizResultShared, "/", Score: 1, Total: 2) },
        { "share with item", new(AnalyticsEventCatalog.QuizResultShared, "/", RunId: "r", Score: 1, Total: 2, ItemId: Guid.NewGuid()) },
        { "share with position", new(AnalyticsEventCatalog.QuizResultShared, "/", RunId: "r", Score: 1, Total: 2, Position: 1) },
        { "share with correctness", new(AnalyticsEventCatalog.QuizResultShared, "/", RunId: "r", Score: 1, Total: 2, IsCorrect: true) },
        { "share score above total", new(AnalyticsEventCatalog.QuizResultShared, "/", RunId: "r", Score: 3, Total: 2) },
        { "flashcards start total above deck cap", new(AnalyticsEventCatalog.FlashcardsStarted, "/", "flashcards", RunId: "r", Total: 1001) },
        { "flashcards start total zero", new(AnalyticsEventCatalog.FlashcardsStarted, "/", "flashcards", RunId: "r", Total: 0) },
        { "reveal position above deck cap", new(AnalyticsEventCatalog.FlashcardRevealed, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1001) },
        { "reveal position zero", new(AnalyticsEventCatalog.FlashcardRevealed, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 0) },
        { "grade position above deck cap", new(AnalyticsEventCatalog.FlashcardGraded, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 1001, IsCorrect: true) },
        { "grade position zero", new(AnalyticsEventCatalog.FlashcardGraded, "/", RunId: "r", ItemId: Guid.NewGuid(), Position: 0, IsCorrect: true) },
        { "quick quiz start total above run cap", new(AnalyticsEventCatalog.QuickQuizStarted, "/", RunId: "r", Total: 1001) },
        { "share total above run cap", new(AnalyticsEventCatalog.QuizResultShared, "/", RunId: "r", Score: 1, Total: 1001) },
        { "starter next without position", new(AnalyticsEventCatalog.StarterNextClicked, "/start", "home", "next:flags", RunId: "r") },
        { "starter next without run", new(AnalyticsEventCatalog.StarterNextClicked, "/start", "home", "next:flags", Position: 1) },
        { "starter next with score", new(AnalyticsEventCatalog.StarterNextClicked, "/start", "home", "next:flags", RunId: "r", Position: 1, Score: 1) },
        { "flashcards start without run", new(AnalyticsEventCatalog.FlashcardsStarted, "/", "flashcards") },
    };

    [Fact]
    public void Validator_AcceptsStarterNextClicked()
    {
        TrackAnalyticsEvents.Request request = new("session",
        [
            new(AnalyticsEventCatalog.StarterNextClicked, "/start", "home", "next:flags", RunId: "r", Position: 1)
        ]);

        new TrackAnalyticsEvents.Validator().Validate(request).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData(501)]
    [InlineData(1000)]
    public void Validator_AcceptsFlashcardDecksPastFiveHundred(int size)
    {
        TrackAnalyticsEvents.Request request = new("session",
        [
            new(AnalyticsEventCatalog.FlashcardsStarted, "/flashcards", "flashcards", RunId: "r", Total: size),
            new(AnalyticsEventCatalog.FlashcardRevealed, "/flashcards", RunId: "r", ItemId: Guid.NewGuid(), Position: size),
            new(AnalyticsEventCatalog.FlashcardGraded, "/flashcards", RunId: "r", ItemId: Guid.NewGuid(), Position: size, IsCorrect: true)
        ]);

        new TrackAnalyticsEvents.Validator().Validate(request).IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData(501)]
    [InlineData(1000)]
    public void Validator_AcceptsQuizRunsPastFiveHundred(int size)
    {
        TrackAnalyticsEvents.Request request = new("session",
        [
            new(AnalyticsEventCatalog.QuickQuizStarted, "/quiz", "quiz", RunId: "r", Total: size),
            new(AnalyticsEventCatalog.QuestionAnswered, "/quiz", RunId: "r", ItemId: Guid.NewGuid(), Position: size, IsCorrect: true),
            new(AnalyticsEventCatalog.QuizCompleted, "/quiz", RunId: "r", Score: size, Total: size),
            new(AnalyticsEventCatalog.QuizResultShared, "/quiz", RunId: "r", Score: size, Total: size)
        ]);

        new TrackAnalyticsEvents.Validator().Validate(request).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_AcceptsLargeQuizRunBatch()
    {
        TrackAnalyticsEvents.Response response = await Track(
            "s",
            new(AnalyticsEventCatalog.QuickQuizStarted, "/quiz", "quiz", RunId: "run-1", Total: 1000),
            new(AnalyticsEventCatalog.QuestionAnswered, "/quiz", "quiz", RunId: "run-1", ItemId: Guid.NewGuid(), Position: 750, IsCorrect: true),
            new(AnalyticsEventCatalog.QuizCompleted, "/quiz", "quiz", RunId: "run-1", Score: 600, Total: 1000));

        response.Should().Be(new TrackAnalyticsEvents.Response(3, 0));
        (await DbContext.AnalyticsEvents.CountAsync()).Should().Be(3);
    }

    [Fact]
    public async Task HandleAsync_AcceptsLargeFlashcardDeckBatch()
    {
        TrackAnalyticsEvents.Response response = await Track(
            "s",
            new(AnalyticsEventCatalog.FlashcardsStarted, "/flashcards", "flashcards", RunId: "run-1", Total: 1000),
            new(AnalyticsEventCatalog.FlashcardGraded, "/flashcards", "flashcards", RunId: "run-1", ItemId: Guid.NewGuid(), Position: 750, IsCorrect: true));

        response.Should().Be(new TrackAnalyticsEvents.Response(2, 0));
        (await DbContext.AnalyticsEvents.CountAsync()).Should().Be(2);
    }

    [Fact]
    public void Validator_KeepsFiveHundredBoundForNonFlashcardNonQuizEvents()
    {
        TrackAnalyticsEvents.Validator validator = new();
        validator.Validate(new TrackAnalyticsEvents.Request("s",
            [new(AnalyticsEventCatalog.GameStarted, "/", RunId: "r", Total: 501)])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s",
            [new(AnalyticsEventCatalog.GameCompleted, "/", RunId: "r", Score: 1, Total: 501)])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s",
            [new(AnalyticsEventCatalog.SearchResultClicked, "/", Position: 501)])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s",
            [new(AnalyticsEventCatalog.TopicSuggestionShown, "/", RunId: "r", Total: 501)])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s",
            [new(AnalyticsEventCatalog.FlashcardsStarted, "/", "flashcards", RunId: "r", Total: 1001),
             new(AnalyticsEventCatalog.FlashcardsStarted, "/", "flashcards", RunId: "r2", Total: 5)])).IsValid.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_StoresOneQuizResultSharePerRun()
    {
        TrackAnalyticsEvents.EventRequest first = new(AnalyticsEventCatalog.QuizResultShared, "/quiz", "daily", "2026-10-20", RunId: "run-1", Score: 4, Total: 5);

        TrackAnalyticsEvents.Response response = await Track("s", first, first with { Score = 5 });

        response.Accepted.Should().Be(1);
        response.Duplicates.Should().Be(1);
        AnalyticsEvent stored = await DbContext.AnalyticsEvents.SingleAsync();
        stored.Score.Should().Be(4);
        stored.ContextType.Should().Be("daily");
    }

    [Fact]
    public async Task HandleAsync_StoresOneFlashcardGradePerItemPerRun()
    {
        Guid itemId = Guid.NewGuid();
        TrackAnalyticsEvents.EventRequest first = new(AnalyticsEventCatalog.FlashcardGraded, "/flashcards", "flashcards", "c", RunId: "run-1", ItemId: itemId, Position: 2, IsCorrect: false);
        TrackAnalyticsEvents.EventRequest changed = first with { IsCorrect = true };

        TrackAnalyticsEvents.Response response = await Track("s", first, changed);

        response.Accepted.Should().Be(1);
        response.Duplicates.Should().Be(1);
        (await DbContext.AnalyticsEvents.SingleAsync()).IsCorrect.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_StoresOneAnswerPerItemPerRun()
    {
        Guid itemId = Guid.NewGuid();
        TrackAnalyticsEvents.EventRequest first = new(AnalyticsEventCatalog.QuestionAnswered, "/quiz", RunId: "run-1", ItemId: itemId, Position: 1, IsCorrect: false);
        // A changed answer for the same item, a retry, and the same item in a new run.
        TrackAnalyticsEvents.EventRequest changed = first with { IsCorrect = true };
        TrackAnalyticsEvents.EventRequest replay = first with { RunId = "run-2" };

        TrackAnalyticsEvents.Response response = await Track("s", first, changed, first, replay);

        response.Accepted.Should().Be(2);
        response.Duplicates.Should().Be(2);
        List<AnalyticsEvent> stored = await DbContext.AnalyticsEvents.AsNoTracking().OrderBy(analyticsEvent => analyticsEvent.RunId).ToListAsync();
        stored.Select(analyticsEvent => (analyticsEvent.RunId, analyticsEvent.IsCorrect)).Should().Equal(("run-1", false), ("run-2", false));
        stored.Should().OnlyContain(analyticsEvent => analyticsEvent.ItemId == itemId && analyticsEvent.Position == 1);
    }

    [Theory]
    [MemberData(nameof(InvalidEvents))]
    public void Validator_RejectsInvalidEvent(string because, TrackAnalyticsEvents.EventRequest invalid)
    {
        ValidationResult result = new TrackAnalyticsEvents.Validator()
            .Validate(new TrackAnalyticsEvents.Request("session", [invalid]));

        result.IsValid.Should().BeFalse(because);
    }

    [Fact]
    public void Validator_RejectsEmptyOversizedOrSessionlessBatches()
    {
        TrackAnalyticsEvents.Validator validator = new();
        TrackAnalyticsEvents.EventRequest valid = new(AnalyticsEventCatalog.SignupSubmitted, "/signup");

        validator.Validate(new TrackAnalyticsEvents.Request("s", [])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s", null)).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s", [.. Enumerable.Repeat(valid, 26)])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("", [valid])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request(new string('s', 129), [valid])).IsValid.Should().BeFalse();
        validator.Validate(new TrackAnalyticsEvents.Request("s", [.. Enumerable.Repeat(valid, 25)])).IsValid.Should().BeTrue();
    }

    [Fact]
    public void Endpoint_IsAnonymousAndRateLimited()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.Services.AddScoped<FluentValidation.IValidator<TrackAnalyticsEvents.Request>, TrackAnalyticsEvents.Validator>();
        builder.Services.AddScoped(_ => DbContext);
        builder.Services.AddSingleton(_userContextMock.Object);
        WebApplication app = builder.Build();

        new TrackAnalyticsEvents.Endpoint().MapEndpoint(app);

        RouteEndpoint endpoint = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(candidate => candidate.RoutePattern.RawText == "analytics/events");

        endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.IAllowAnonymous>().Should().NotBeNull();
        endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.RateLimiting.EnableRateLimitingAttribute>()!
            .PolicyName.Should().Be("analytics-events");
    }

    [Fact]
    public async Task RateLimitPolicy_Returns429AfterTheWindowBudget()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.AddRateLimitingServices();
        await using WebApplication app = builder.Build();
        app.UseRateLimiter();
        app.MapPost("/analytics/events", () => Results.Accepted()).RequireRateLimiting("analytics-events");
        await app.StartAsync();

        string address = app.Services.GetRequiredService<IServer>()
            .Features.Get<IServerAddressesFeature>()!.Addresses.First();
        using HttpClient client = new() { BaseAddress = new Uri(address) };

        List<HttpStatusCode> statuses = [];
        for (int attempt = 0; attempt < 121; attempt++)
        {
            using HttpResponseMessage response = await client.PostAsJsonAsync("/analytics/events", new { });
            statuses.Add(response.StatusCode);
        }

        statuses.Take(120).Should().OnlyContain(status => status == HttpStatusCode.Accepted);
        statuses[^1].Should().Be(HttpStatusCode.TooManyRequests);

        await app.StopAsync();
    }
}
