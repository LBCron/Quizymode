using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Features.Admin.DailyDigest;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using static Quizymode.Api.Tests.Features.Admin.DailyDigest.DigestSeed;

namespace Quizymode.Api.Tests.Features.Admin.DailyDigest;

/// <summary>#509 AC 2, 5-9, 12-13: the digest numbers on a seeded database.</summary>
public sealed class DailySummaryBuilderTests : DatabaseTestFixture
{
    private static readonly DateTime Mid = Start.AddHours(10);

    private async Task<DaySummary> BuildAsync(DateTime? start = null, DateTime? end = null)
    {
        List<VisitorCohortReport.CohortRow> rows = await VisitorCohortReport.LoadRowsAsync(DbContext, false, false, CancellationToken.None);
        return await DailySummaryBuilder.BuildDayAsync(
            DbContext, start ?? Start, end ?? End, rows, true, NullLogger.Instance, CancellationToken.None);
    }

    [Fact]
    public async Task Window_IncludesHitAtStart_ExcludesHitAtEnd()
    {
        DbContext.PageViews.AddRange(Hit("at-start", Start), Hit("at-end", End), Hit("before", Start.AddTicks(-1)));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Visits!.Sessions.Should().Be(1);
        day.Visits.PageViews.Should().Be(1);
    }

    [Fact]
    public async Task Exclusions_InternalBotInternalUserAndSiblingSessions_ContributeNothing_ButAppearInRawCounts()
    {
        Guid staff = Guid.NewGuid();
        DbContext.Users.Add(new User { Id = staff, Subject = "staff", IsInternal = true, CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
        DbContext.AnalyticsSessions.AddRange(
            Session("internal-hit", Mid, "v-staff"),
            Session("sibling", Mid, "v-staff"),
            Session("staff-user", Mid, "v-other"),
            Session("bot", Mid, "v-bot"));
        DbContext.PageViews.AddRange(
            Hit("internal-hit", Mid, isInternal: true),
            Hit("sibling", Mid.AddMinutes(1)),
            Hit("staff-user", Mid, userId: staff),
            Hit("bot", Mid, isBot: true),
            Hit("human", Mid));
        DbContext.AnalyticsEvents.Add(Event(AnalyticsEventCatalog.QuickQuizStarted, "bot", "r1", Mid, isBot: true));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();
        DigestHealth health = await DailySummaryBuilder.BuildHealthAsync(DbContext, Start, End, CancellationToken.None);

        day.Visits!.Sessions.Should().Be(1);
        day.Visits.PageViews.Should().Be(1);
        day.Accounts!.ActiveAccounts.Should().Be(0);
        day.Quizzes!.Starts.Should().Be(0);
        health.RawPageViews.Should().Be(5);
        health.RawEvents.Should().Be(1);
    }

    [Fact]
    public async Task ConvertedSession_CountsOnce_AndMixAddsUpToSessions()
    {
        Guid user = Guid.NewGuid();
        Guid returning = Guid.NewGuid();
        DbContext.Users.AddRange(
            new User { Id = user, Subject = "u", CreatedAt = Mid },
            new User { Id = returning, Subject = "r", CreatedAt = Start.AddDays(-30) });
        DbContext.AnalyticsSessions.AddRange(Session("conv", Mid, "v1", userId: user), Session("anon", Mid, "v2"), Session("auth", Mid, "v3", userId: returning));
        DbContext.PageViews.AddRange(
            Hit("conv", Mid), Hit("conv", Mid.AddMinutes(1), "/quiz", userId: user),
            Hit("anon", Mid),
            Hit("auth", Mid, userId: returning));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Visits!.Sessions.Should().Be(3);
        day.Visits.Browsers.Should().Be(3);
        day.Accounts!.ConvertedSessions.Should().Be(1);
        day.Accounts.AnonymousSessions.Should().Be(1);
        day.Accounts.AuthenticatedSessions.Should().Be(1);
        (day.Accounts.AnonymousSessions + day.Accounts.ConvertedSessions + day.Accounts.AuthenticatedSessions).Should().Be(day.Visits.Sessions);
        day.Accounts.ActiveAccounts.Should().Be(2);
        day.Accounts.NewAccounts.Should().Be(1);
    }

    [Fact]
    public async Task Browsers_SameVisitorTwice_CountsOnce_AndSessionsWithoutIdAreNeverAddedToBrowsers()
    {
        DbContext.AnalyticsSessions.AddRange(
            Session("a", Mid, "v1"), Session("b", Mid, "v1"), Session("c", Mid, null), Session("d", Mid, null));
        DbContext.PageViews.AddRange(Hit("a", Mid), Hit("b", Mid), Hit("c", Mid), Hit("d", Mid));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Visits!.Sessions.Should().Be(4);
        day.Visits.Browsers.Should().Be(1);
        day.Visits.SessionsWithoutBrowserId.Should().Be(2);
    }

    [Fact]
    public async Task Accounts_OnlyActiveWhenTheyHaveASessionInTheWindow_AndInternalNewUsersAreExcluded()
    {
        DbContext.Users.AddRange(
            new User { Id = Guid.NewGuid(), Subject = "idle", CreatedAt = Start.AddDays(-90) },
            new User { Id = Guid.NewGuid(), Subject = "new", CreatedAt = Start },
            new User { Id = Guid.NewGuid(), Subject = "new-internal", CreatedAt = Mid, IsInternal = true },
            new User { Id = Guid.NewGuid(), Subject = "at-end", CreatedAt = End });
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Accounts!.ActiveAccounts.Should().Be(0);
        day.Accounts.NewAccounts.Should().Be(1);
    }

    [Fact]
    public async Task QuizRuns_StartedBeforeMidnightAndCompletedAfter_CountOnTheStartDay_NotTheNext()
    {
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s1", "r1", End.AddMinutes(-2)),
            Event(AnalyticsEventCatalog.QuizCompleted, "s1", "r1", End.AddMinutes(3), score: 3, total: 5));
        await DbContext.SaveChangesAsync();

        DaySummary today = await BuildAsync();
        DaySummary next = await BuildAsync(End, End.AddHours(24));

        today.Quizzes!.Starts.Should().Be(1);
        today.Quizzes.Completed.Should().Be(1);
        next.Quizzes!.Starts.Should().Be(0);
        next.Quizzes.Completed.Should().Be(0);
    }

    [Fact]
    public async Task QuizRuns_StartedYesterdayCompletedToday_CountOnNeither()
    {
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s1", "r1", Start.AddMinutes(-5)),
            Event(AnalyticsEventCatalog.QuizCompleted, "s1", "r1", Start.AddMinutes(5), score: 3, total: 5));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Quizzes!.Starts.Should().Be(0);
        day.Quizzes.Completed.Should().Be(0);
    }

    [Fact]
    public async Task QuizRuns_CompletionAtGraceBoundaryOrLater_DoesNotCount_AndDuplicatesCountOnce()
    {
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s1", "r-late", Start.AddHours(1)),
            Event(AnalyticsEventCatalog.QuizCompleted, "s1", "r-late", End.AddHours(6), score: 1, total: 1),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s2", "r-dup", Start.AddHours(1)),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s2", "r-dup", Start.AddHours(1).AddSeconds(1)),
            Event(AnalyticsEventCatalog.QuizCompleted, "s2", "r-dup", Start.AddHours(2), score: 1, total: 1),
            Event(AnalyticsEventCatalog.QuizCompleted, "s2", "r-dup", Start.AddHours(2).AddSeconds(1), score: 1, total: 1));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Quizzes!.Starts.Should().Be(2);
        day.Quizzes.Completed.Should().Be(1);
    }

    [Fact]
    public async Task QuizRuns_LearnStartsAreExcluded_AndInternalGraceCompletionsMakeTheSessionInternal()
    {
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "learner", "r-learn", Start.AddHours(1), contextType: "learn", contextId: "x"),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "staff", "r-staff", Start.AddHours(1)),
            Event(AnalyticsEventCatalog.QuizCompleted, "staff", "r-staff", End.AddHours(1), score: 1, total: 1, isInternal: true),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "human", "r-human", Start.AddHours(1)),
            Event(AnalyticsEventCatalog.QuizCompleted, "human", "r-human", End.AddHours(1), score: 1, total: 1));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Quizzes!.Starts.Should().Be(1);
        day.Quizzes.Completed.Should().Be(1);
    }

    [Fact]
    public async Task QuizTopics_UsePublicCollectionNames_PrivateOnesAreHidden_AndUnsafeCategoriesBecomeOther()
    {
        Guid publicId = Guid.NewGuid();
        Guid privateId = Guid.NewGuid();
        DbContext.Collections.AddRange(
            new Collection { Id = publicId, Name = "World Capitals", CreatedBy = "o", IsPublic = true },
            new Collection { Id = privateId, Name = "Secret Plans", CreatedBy = "o", IsPublic = false });
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s1", "r1", Mid, "collection", publicId.ToString()),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s2", "r2", Mid, "collection", privateId.ToString()),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s3", "r3", Mid, "category", "Geo Graphy:x"));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        List<string> labels = day.Quizzes!.Topics.Select(topic => topic.Label).ToList();
        labels.Should().BeEquivalentTo("World Capitals", "a private collection", "other");
        labels.Should().NotContain("Secret Plans");
    }

    [Fact]
    public async Task QuizParticipants_UseTheVisitorId_FallingBackToTheSession()
    {
        DbContext.AnalyticsSessions.AddRange(Session("a", Mid, "v1"), Session("b", Mid, "v1"), Session("c", Mid, null));
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "a", "r1", Mid),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "b", "r2", Mid),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "c", "r3", Mid),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "c", "r4", Mid));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Quizzes!.Starts.Should().Be(4);
        day.Quizzes.Participants.Should().Be(2);
    }

    [Theory]
    [InlineData("www.linkedin.com", null)]
    [InlineData("lnkd.in", null)]
    [InlineData(null, "LinkedIn")]
    public async Task Sources_LinkedInVariants_LandOnTheLinkedInLine(string? referrer, string? utmSource)
    {
        DbContext.AnalyticsSessions.AddRange(
            Session("li", Mid, "v1", channel: "social", referrerHost: referrer, utmSource: utmSource),
            Session("g", Mid, "v2", channel: "search", referrerHost: "google.com"));
        DbContext.PageViews.AddRange(Hit("li", Mid), Hit("g", Mid));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Sources!.LinkedIn.Sessions.Should().Be(1);
        day.Sources.Top.Select(row => row.Name).Should().Equal("google.com");
    }

    [Fact]
    public async Task Sources_LinkedInLineIsPresentWithZeros_AndUnsafeUtmValuesPrintAsOther()
    {
        DbContext.AnalyticsSessions.Add(Session("a", Mid, "v1", utmSource: "bob@example.com\nBcc: x"));
        DbContext.PageViews.Add(Hit("a", Mid));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Sources!.LinkedIn.Should().Be(new SourceRow("LinkedIn", 0, 0, 0, 0, 0));
        day.Sources.Top.Single().Name.Should().Be("other");
    }

    [Fact]
    public async Task Sources_CountEngagedQuizStartsConvertedAndNewAccountsPerSource()
    {
        Guid user = Guid.NewGuid();
        DbContext.Users.Add(new User { Id = user, Subject = "u", CreatedAt = Mid });
        DbContext.AnalyticsSessions.Add(Session("g1", Mid, "v1", channel: "search", referrerHost: "google.com", userId: user));
        DbContext.PageViews.AddRange(Hit("g1", Mid), Hit("g1", Mid.AddMinutes(1), "/quiz", userId: user));
        DbContext.AnalyticsEvents.Add(Event(AnalyticsEventCatalog.QuickQuizStarted, "g1", "r1", Mid.AddMinutes(2)));
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Sources!.Top.Single().Should().Be(new SourceRow("google.com", 1, 1, 1, 1, 1));
    }

    [Fact]
    public async Task Problems_CountErrorsFeedbackByTypeAndPictureReports_ExcludingBotsAndInternal()
    {
        DbContext.ClientErrors.AddRange(
            Error("f1", "e1", Mid),
            Error("f1", "e2", Mid),
            Error("f0", "e3", Mid),
            Error("f0", "old", Start.AddDays(-3)),
            Error("fb", "eb", Mid, isBot: true),
            Error("fi", "ei", Mid, isInternal: true));
        DbContext.FeedbackSubmissions.AddRange(
            new FeedbackSubmission { Id = Guid.NewGuid(), Type = "reportIssue", PageUrl = "/", Details = "secret details", CreatedAt = Mid },
            new FeedbackSubmission { Id = Guid.NewGuid(), Type = "generalFeedback", PageUrl = "/", Details = "d", CreatedAt = Mid },
            new FeedbackSubmission { Id = Guid.NewGuid(), Type = "requestItems", PageUrl = "/", Details = "d", CreatedAt = End });
        await DbContext.SaveChangesAsync();

        DaySummary day = await BuildAsync();

        day.Problems.Should().Be(new ProblemsSection(3, 3, 0, 1, 1, 1, 0));
    }

    [Fact]
    public async Task Overview_AndDigestBuilder_AgreeOnTheSameUtcBounds()
    {
        DateTime now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);
        DateTime windowStart = new(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc);
        DateTime windowEnd = new(2026, 10, 17, 0, 0, 0, DateTimeKind.Utc);
        Guid user = Guid.NewGuid();
        Guid signup = Guid.NewGuid();
        DbContext.Users.AddRange(
            new User { Id = user, Subject = "u", CreatedAt = windowStart.AddDays(-50) },
            new User { Id = signup, Subject = "s", CreatedAt = now.AddDays(-2) });
        DbContext.AnalyticsSessions.AddRange(
            Session("a", now.AddDays(-5), "v1"), Session("b", now.AddDays(-3), "v1"), Session("c", now.AddDays(-2), "v2", userId: signup),
            Session("d", now.AddDays(-1), "v3", userId: user), Session("old", windowStart.AddDays(-3), "v9"));
        DbContext.PageViews.AddRange(
            Hit("a", now.AddDays(-5)), Hit("a", now.AddDays(-5).AddMinutes(1), "/x"),
            Hit("b", now.AddDays(-3)),
            Hit("c", now.AddDays(-2)), Hit("c", now.AddDays(-2).AddMinutes(1), "/y", userId: signup),
            Hit("d", now.AddDays(-1), userId: user, itemStep: true),
            Hit("bot", now.AddDays(-1), isBot: true), Hit("old", windowStart.AddDays(-3)));
        await DbContext.SaveChangesAsync();

        GetAnalyticsOverview.Response overview = (await GetAnalyticsOverview.HandleAsync(new GetAnalyticsOverview.QueryRequest(7), DbContext, now, CancellationToken.None)).Value!;
        DaySummary digest = await BuildAsync(windowStart, windowEnd);

        overview.Current.HumanSessions.Should().Be(digest.Visits!.Sessions);
        overview.Current.EngagedSessions.Should().Be(digest.Visits.EngagedSessions);
        overview.Current.ConvertedSessions.Should().Be(digest.Accounts!.ConvertedSessions);
        overview.Current.NewSignups.Should().Be(digest.Accounts.NewAccounts);
        overview.Current.ActiveRegisteredUsers.Should().Be(digest.Accounts.ActiveAccounts);
        overview.Current.NewVisitors.Should().Be(digest.Visits.NewBrowsers);
        overview.Current.ReturningVisitors.Should().Be(digest.Visits.ReturningBrowsers);
        digest.Visits.Sessions.Should().Be(4);
    }

    [Fact]
    public async Task DigestQuizCounts_EqualTheLearningReport_WhenTheCompletionCutoffIsTheWindowEnd()
    {
        DateTime now = DateTime.UtcNow;
        DbContext.AnalyticsEvents.AddRange(
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s1", "r1", now.AddHours(-3), total: 5),
            Event(AnalyticsEventCatalog.QuizCompleted, "s1", "r1", now.AddHours(-2), score: 4, total: 5),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s2", "r2", now.AddHours(-3), total: 5),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s3", "r3", now.AddHours(-3), "learn", "x"),
            Event(AnalyticsEventCatalog.QuickQuizStarted, "s4", "r4", now.AddHours(-3), "collection", "c-1"),
            Event(AnalyticsEventCatalog.QuizCompleted, "s4", "r4", now.AddHours(-1), "collection", "c-1", score: 1, total: 2));
        await DbContext.SaveChangesAsync();

        GetLearningReport.Response learning = (await GetLearningReport.HandleAsync(new GetLearningReport.QueryRequest(7), DbContext, CancellationToken.None)).Value!;
        List<GetLearningReport.ScopeResponse> quizScopes = learning.Scopes.Where(scope => scope.Mode == GetLearningReport.QuizMode).ToList();
        DailySummaryBuilder.QuizRunCounts digest = await DailySummaryBuilder.LoadQuizRunsAsync(
            DbContext, learning.WindowStartUtc, learning.WindowEndUtc, learning.WindowEndUtc, CancellationToken.None);

        digest.Starts.Count.Should().Be(quizScopes.Sum(scope => scope.RunsStarted));
        digest.Completed.Should().Be(quizScopes.Sum(scope => scope.RunsCompleted ?? 0));
    }
}
