using System.Net;
using FluentAssertions;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

public sealed class GetQuestionQualityReportTests : DatabaseTestFixture
{
    private static readonly DateTime Now = DateTime.UtcNow;

    private static Item NewItem(int incorrect = 3, DateTime? updatedAt = null) => new()
    {
        Id = Guid.NewGuid(),
        Question = "Q?",
        CorrectAnswer = "A",
        IncorrectAnswers = Enumerable.Range(0, incorrect).Select(i => "wrong" + i).ToList(),
        CreatedBy = "u",
        CreatedAt = Now.AddDays(-60),
        UpdatedAt = updatedAt
    };

    private static AnalyticsEvent Answer(Guid itemId, string session, bool correct, int minutesAgo = 30, bool isBot = false) => new()
    {
        Id = Guid.NewGuid(),
        EventName = AnalyticsEventCatalog.QuestionAnswered,
        SessionId = session,
        Path = "/",
        RunId = "r-" + session + Guid.NewGuid().ToString("N")[..6],
        ItemId = itemId,
        Position = 1,
        IsCorrect = correct,
        IsBot = isBot,
        OccurredUtc = Now.AddMinutes(-minutesAgo)
    };

    private async Task AddAnswers(Guid itemId, int correct, int wrong, int minutesAgo = 30)
    {
        List<AnalyticsEvent> events = [];
        for (int i = 0; i < correct + wrong; i++)
        {
            events.Add(Answer(itemId, "s" + Guid.NewGuid().ToString("N"), i < correct, minutesAgo));
        }

        await DbContext.AnalyticsEvents.AddRangeAsync(events);
    }

    private Task<Result<GetQuestionQualityReport.Response>> Run(int minAnswers = 10, int days = 30) =>
        GetQuestionQualityReport.HandleAsync(new GetQuestionQualityReport.QueryRequest(days, minAnswers), DbContext, CancellationToken.None);

    [Fact]
    public async Task HandleAsync_ReturnsQuestionImage_OrNullWhenItemHasNone()
    {
        Item withPicture = NewItem();
        withPicture.QuestionImageKey = "curated:flags/fr";
        withPicture.QuestionImageAlt = "Three vertical bands";
        Item plain = NewItem();
        await DbContext.Items.AddRangeAsync(withPicture, plain);
        await AddAnswers(withPicture.Id, correct: 4, wrong: 6);
        await AddAnswers(plain.Id, correct: 5, wrong: 5);
        await DbContext.SaveChangesAsync();

        GetQuestionQualityReport.Response report = (await Run()).Value!;

        report.Items.Single(i => i.ItemId == withPicture.Id).QuestionImage
            .Should().Be(new ItemImageReference("curated:flags/fr", "Three vertical bands"));
        report.Items.Single(i => i.ItemId == plain.Id).QuestionImage.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_ListsOnlyItemsAtOrAboveMinimumSortedByCorrectRate()
    {
        Item hard = NewItem();
        Item easy = NewItem();
        Item thin = NewItem();
        await DbContext.Items.AddRangeAsync(hard, easy, thin);
        await AddAnswers(hard.Id, correct: 4, wrong: 6);
        await AddAnswers(easy.Id, correct: 9, wrong: 1);
        await AddAnswers(thin.Id, correct: 0, wrong: 9);
        await DbContext.SaveChangesAsync();

        GetQuestionQualityReport.Response report = (await Run()).Value!;

        report.Items.Select(i => i.ItemId).Should().Equal(hard.Id, easy.Id);
        report.Items[0].Answers.Should().Be(10);
        report.Items[0].CorrectRatePercent.Should().Be(40);
        report.Items[0].CheckAnswerKey.Should().BeFalse();
        (await Run(minAnswers: 9)).Value!.Items.Should().Contain(i => i.ItemId == thin.Id);
    }

    [Fact]
    public async Task HandleAsync_FlagsItemsBelowRandomGuessRateForTheirOptionCount()
    {
        Item fourOptions = NewItem(incorrect: 3); // threshold 25%
        Item twoOptions = NewItem(incorrect: 1); // threshold 50%
        Item atThreshold = NewItem(incorrect: 3);
        await DbContext.Items.AddRangeAsync(fourOptions, twoOptions, atThreshold);
        await AddAnswers(fourOptions.Id, correct: 2, wrong: 18); // 10%
        await AddAnswers(twoOptions.Id, correct: 4, wrong: 6); // 40% < 50%
        await AddAnswers(atThreshold.Id, correct: 5, wrong: 15); // exactly 25%
        await DbContext.SaveChangesAsync();

        GetQuestionQualityReport.Response report = (await Run()).Value!;

        report.Items.Single(i => i.ItemId == fourOptions.Id).CheckAnswerKey.Should().BeTrue();
        report.Items.Single(i => i.ItemId == fourOptions.Id).RandomGuessPercent.Should().Be(25);
        report.Items.Single(i => i.ItemId == twoOptions.Id).CheckAnswerKey.Should().BeTrue();
        report.Items.Single(i => i.ItemId == atThreshold.Id).CheckAnswerKey.Should().BeFalse();
    }

    [Fact]
    public async Task HandleAsync_EditingAnItemResetsItsStatistics()
    {
        Item edited = NewItem(updatedAt: Now.AddMinutes(-20));
        await DbContext.Items.AddAsync(edited);
        await AddAnswers(edited.Id, correct: 0, wrong: 12, minutesAgo: 60); // before the edit
        await AddAnswers(edited.Id, correct: 8, wrong: 2, minutesAgo: 10); // after the edit
        await DbContext.SaveChangesAsync();

        GetQuestionQualityReport.QuestionResponse row = (await Run()).Value!.Items.Single();

        row.Answers.Should().Be(10);
        row.CorrectRatePercent.Should().Be(80);
        row.LastEditedUtc.Should().NotBeNull();
        (await Run(minAnswers: 11)).Value!.Items.Should().BeEmpty();
    }

    [Fact]
    public async Task HandleAsync_CountsOnlyFirstAttemptPerSessionAndSkipsBots()
    {
        Item item = NewItem();
        await DbContext.Items.AddAsync(item);
        List<AnalyticsEvent> events = [];
        for (int i = 0; i < 10; i++)
        {
            string session = "s" + i;
            events.Add(Answer(item.Id, session, correct: false, minutesAgo: 30));
            events.Add(Answer(item.Id, session, correct: true, minutesAgo: 20)); // retry, not a first attempt
        }

        events.Add(Answer(item.Id, "bot", correct: true, isBot: true));
        await DbContext.AnalyticsEvents.AddRangeAsync(events);
        await DbContext.SaveChangesAsync();

        GetQuestionQualityReport.QuestionResponse row = (await Run()).Value!.Items.Single();

        row.Answers.Should().Be(10);
        row.CorrectRatePercent.Should().Be(0);
        row.CheckAnswerKey.Should().BeTrue();
    }

    [Fact]
    public async Task HandleAsync_RejectsInvalidParameters()
    {
        (await Run(days: 0)).IsFailure.Should().BeTrue();
        (await Run(minAnswers: 0)).IsFailure.Should().BeTrue();
    }
}

/// <summary>ANALYTICS-009 (#129): only admins can read the question quality report, checked over real HTTP.</summary>
public sealed class QuestionQualityReportHttpTests : DatabaseTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];

    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(CreateDbContext, _ => { }, app => new GetQuestionQualityReport.Endpoint().MapEndpoint(app));
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private async Task<HttpStatusCode> GetAsync(string? token)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Get, "/admin/analytics/question-quality?days=7", token);
        using HttpResponseMessage response = await _host.Client.SendAsync(request);
        return response.StatusCode;
    }

    [Fact]
    public async Task QuestionQualityReport_RejectsAnonymousAndNonAdminCallers()
    {
        (await GetAsync(null)).Should().Be(HttpStatusCode.Unauthorized);
        (await GetAsync(_host.CreateToken("member", "member@example.com"))).Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync(_host.CreateToken("admin", "admin@example.com", AdminGroups))).Should().Be(HttpStatusCode.OK);
    }
}
