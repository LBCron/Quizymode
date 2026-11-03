using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using Daily = Quizymode.Api.Features.DailyQuiz.DailyQuiz;

namespace Quizymode.Api.Tests.Features.LearningLoop;

public sealed class DailyQuizTests : DatabaseTestFixture
{
    private static readonly DateTime Now = new(2026, 10, 18, 15, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = DateOnly.FromDateTime(Now);

    private async Task<List<Item>> SeedPublicItemsAsync(int count)
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        List<Item> items = new();
        for (int i = 0; i < count; i++)
        {
            items.Add(await LearningLoopTestData.AddItemAsync(DbContext, category));
        }
        return items;
    }

    private Task<Daily.DailyQuizResponse> GetAsync(string? userId = null, DateTime? now = null) =>
        Daily.GetAsync(DbContext, LearningLoopTestData.User(userId), now ?? Now, CancellationToken.None);

    [Fact]
    public async Task Get_PicksFiveEligibleItems_DeterministicallyBySeed()
    {
        List<Item> items = await SeedPublicItemsAsync(12);

        Daily.DailyQuizResponse first = await GetAsync();
        Daily.DailyQuizResponse again = await GetAsync("user-a");

        first.Date.Should().Be("2026-10-18");
        first.Items.Should().HaveCount(Daily.SetSize);
        again.Items.Select(i => i.Id).Should().Equal(first.Items.Select(i => i.Id));
        List<string> expected = items
            .Select(i => i.Id)
            .OrderBy(id => Daily.SeedRank("2026-10-18", id)).ThenBy(id => id)
            .Take(Daily.SetSize)
            .Select(id => id.ToString())
            .ToList();
        first.Items.Select(i => i.Id).Should().Equal(expected);
        DbContext.DailyQuizSets.Count().Should().Be(1);
    }

    [Fact]
    public async Task Get_NeverIncludesImageReview_EvenForAnApprovedPictureItem()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Item item = await LearningLoopTestData.AddItemAsync(DbContext, category);
        item.ImageReviewState = ItemImageReviewState.Approved;
        item.ImageRevision = 1;
        await DbContext.SaveChangesAsync();

        Daily.DailyQuizResponse response = await GetAsync();

        response.Items.Should().ContainSingle().Which.ImageReview.Should().BeNull();
    }

    [Fact]
    public async Task Get_ExcludesPrivateItems_PrivateCategories_AndItemsWithoutWrongAnswers()
    {
        Category publicCategory = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Category privateCategory = await LearningLoopTestData.AddCategoryAsync(DbContext, "mine", isPrivate: true);
        Item eligible = await LearningLoopTestData.AddItemAsync(DbContext, publicCategory);
        await LearningLoopTestData.AddItemAsync(DbContext, publicCategory, isPrivate: true);
        await LearningLoopTestData.AddItemAsync(DbContext, privateCategory);
        await LearningLoopTestData.AddItemAsync(DbContext, publicCategory, incorrect: new List<string>());
        await LearningLoopTestData.AddItemAsync(DbContext, null);

        Daily.DailyQuizResponse response = await GetAsync();

        response.Items.Select(i => i.Id).Should().Equal(eligible.Id.ToString());
    }

    [Fact]
    public async Task Get_ExcludesItemsWithOnlyBlankOrCorrectEquivalentWrongAnswers()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Item eligible = await LearningLoopTestData.AddItemAsync(DbContext, category);
        await LearningLoopTestData.AddItemAsync(DbContext, category, incorrect: new List<string> { "  ", "" });
        await LearningLoopTestData.AddItemAsync(DbContext, category, incorrect: new List<string> { "right" });

        Daily.DailyQuizResponse response = await GetAsync();

        response.Items.Select(i => i.Id).Should().Equal(eligible.Id.ToString());
    }

    [Fact]
    public async Task Get_DoesNotRepeatItemsUsedWithin30Days()
    {
        List<Item> items = await SeedPublicItemsAsync(10);
        Daily.DailyQuizResponse yesterday = await GetAsync(now: Now.AddDays(-1));

        Daily.DailyQuizResponse today = await GetAsync();

        today.Items.Select(i => i.Id).Should().NotIntersectWith(yesterday.Items.Select(i => i.Id));
        today.Items.Should().HaveCount(5);
    }

    [Fact]
    public async Task Get_WithNothingEligible_StoresEmptyHeader_AndReturnsNoItems()
    {
        Daily.DailyQuizResponse response = await GetAsync();
        await LearningLoopTestData.AddItemAsync(DbContext, await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia"));
        Daily.DailyQuizResponse later = await GetAsync();

        response.Items.Should().BeEmpty();
        later.Items.Should().BeEmpty("the day's set is fixed once created");
        DbContext.DailyQuizSets.Count().Should().Be(1);
    }

    [Fact]
    public async Task Complete_IsIdempotent_AndStreakCountsConsecutiveDays()
    {
        await SeedPublicItemsAsync(30);
        await GetAsync(now: Now.AddDays(-1));
        await GetAsync();
        DbContext.DailyQuizCompletions.Add(new DailyQuizCompletion { UserId = "user-a", Date = Today.AddDays(-1), Correct = 3, Total = 5 });
        DbContext.DailyQuizCompletions.Add(new DailyQuizCompletion { UserId = "user-a", Date = Today.AddDays(-3), Correct = 3, Total = 5 });
        await DbContext.SaveChangesAsync();

        Result<Daily.CompleteResponse> first = await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-18", 4, 5), DbContext, "user-a", Now, CancellationToken.None);
        Result<Daily.CompleteResponse> retry = await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-18", 1, 5), DbContext, "user-a", Now, CancellationToken.None);

        first.Value.Created.Should().BeTrue();
        first.Value.Streak.Should().Be(2);
        retry.Value.Created.Should().BeFalse();
        retry.Value.Completion.Correct.Should().Be(4, "the first stored result wins");

        Daily.DailyQuizResponse view = await GetAsync("user-a");
        view.Completion!.Correct.Should().Be(4);
        view.Streak.Should().Be(2);
        (await GetAsync()).Streak.Should().BeNull("anonymous callers keep their streak in the browser");
    }

    [Fact]
    public async Task Complete_WithSkipped_StoresItAndReturnsItOnTheCompletion()
    {
        await SeedPublicItemsAsync(10);
        await GetAsync();

        Result<Daily.CompleteResponse> result = await Daily.CompleteAsync(
            new Daily.CompleteRequest("2026-10-18", 2, 5, 2), DbContext, "user-a", Now, CancellationToken.None);

        result.Value.Completion.Should().Match<Daily.CompletionDto>(c => c.Correct == 2 && c.Total == 5 && c.Skipped == 2);
        (await GetAsync("user-a")).Completion!.Skipped.Should().Be(2);
        (await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-18", 0, 5, 5), DbContext, "user-b", Now, CancellationToken.None))
            .Value.Completion.Skipped.Should().Be(5, "an all-skipped run still records the completion");
    }

    [Theory]
    [InlineData(4, 5, 2, false)]
    [InlineData(3, 5, 2, true)]
    [InlineData(0, 5, 5, true)]
    [InlineData(0, 5, 6, false)]
    [InlineData(0, 5, -1, false)]
    [InlineData(5, 5, 0, true)]
    public void CompleteValidator_EnforcesSkippedBounds(int correct, int total, int skipped, bool valid) =>
        new Daily.CompleteValidator().Validate(new Daily.CompleteRequest("2026-10-18", correct, total, skipped)).IsValid.Should().Be(valid);

    [Fact]
    public void CompleteRequest_WithoutSkipped_DefaultsToZero() =>
        new Daily.CompleteRequest("2026-10-18", 3, 5).Skipped.Should().Be(0);

    [Fact]
    public async Task Complete_RejectsDaysOutsideWindow_DaysWithoutQuiz_AndWrongTotals()
    {
        await SeedPublicItemsAsync(10);
        await GetAsync();

        (await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-16", 1, 5), DbContext, "u", Now, CancellationToken.None)).IsFailure.Should().BeTrue();
        (await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-19", 1, 5), DbContext, "u", Now, CancellationToken.None)).IsFailure.Should().BeTrue();
        (await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-17", 1, 5), DbContext, "u", Now, CancellationToken.None)).IsFailure.Should().BeTrue("no set exists for that day");
        (await Daily.CompleteAsync(new Daily.CompleteRequest("2026-10-18", 1, 3), DbContext, "u", Now, CancellationToken.None)).IsFailure.Should().BeTrue();
        DbContext.DailyQuizCompletions.Count().Should().Be(0);
    }

    [Fact]
    public async Task Exclude_ReplacesItemInSameSlot_WithNextSeedCandidate()
    {
        await SeedPublicItemsAsync(10);
        Daily.DailyQuizResponse before = await GetAsync();
        Guid removed = Guid.Parse(before.Items[2].Id);
        List<Guid> ranked = DbContext.Items.AsNoTracking().Select(i => i.Id).ToList()
            .OrderBy(id => Daily.SeedRank("2026-10-18", id)).ThenBy(id => id).ToList();

        Result<Daily.AdminDayResponse> result = await Daily.ExcludeAsync("2026-10-18", removed, DbContext, "admin-1", Now, CancellationToken.None);
        Daily.DailyQuizResponse after = await GetAsync();

        result.IsSuccess.Should().BeTrue();
        after.Items.Should().HaveCount(5);
        after.Items[2].Id.Should().Be(ranked[5].ToString());
        after.Items.Select(i => i.Id).Should().NotContain(removed.ToString());
        result.Value.Items.Should().ContainSingle(i => i.Excluded && i.ItemId == removed);
        (await Daily.ExcludeAsync("2026-10-18", removed, DbContext, "admin-1", Now, CancellationToken.None)).IsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task AdminGetAndExclude_ReturnQuestionImage_AndNullForPlainOrDeletedItems()
    {
        await SeedPublicItemsAsync(10);
        Daily.DailyQuizResponse set = await GetAsync();
        Guid withPicture = Guid.Parse(set.Items[0].Id);
        Guid deleted = Guid.Parse(set.Items[1].Id);
        Guid removed = Guid.Parse(set.Items[2].Id);
        Item pictureItem = await DbContext.Items.SingleAsync(i => i.Id == withPicture);
        pictureItem.QuestionImageKey = "curated:flags/fr";
        pictureItem.QuestionImageAlt = "Three vertical bands";
        DbContext.Items.Remove(await DbContext.Items.SingleAsync(i => i.Id == deleted));
        await DbContext.SaveChangesAsync();

        Daily.AdminDayResponse got = (await Daily.AdminGetAsync("2026-10-18", DbContext, Now, CancellationToken.None)).Value;
        Daily.AdminDayResponse excluded = (await Daily.ExcludeAsync("2026-10-18", removed, DbContext, "admin-1", Now, CancellationToken.None)).Value;

        foreach (Daily.AdminDayResponse day in new[] { got, excluded })
        {
            day.Items.Single(i => i.ItemId == withPicture).QuestionImage
                .Should().Be(new ItemImageReference("curated:flags/fr", "Three vertical bands"));
            Daily.AdminItemDto placeholder = day.Items.Single(i => i.ItemId == deleted);
            placeholder.Question.Should().Be("(item no longer exists)");
            placeholder.QuestionImage.Should().BeNull();
            day.Items.Where(i => i.ItemId != withPicture && i.ItemId != deleted).Should().OnlyContain(i => i.QuestionImage == null);
        }
    }

    [Fact]
    public async Task AdminGet_AllowsTodayThroughSevenDaysAhead_Only()
    {
        await SeedPublicItemsAsync(40);

        (await Daily.AdminGetAsync(null, DbContext, Now, CancellationToken.None)).Value.Date.Should().Be("2026-10-18");
        (await Daily.AdminGetAsync("2026-10-25", DbContext, Now, CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await Daily.AdminGetAsync("2026-10-26", DbContext, Now, CancellationToken.None)).IsFailure.Should().BeTrue();
        (await Daily.AdminGetAsync("2026-10-17", DbContext, Now, CancellationToken.None)).IsFailure.Should().BeTrue();
        (await Daily.AdminGetAsync("not-a-date", DbContext, Now, CancellationToken.None)).IsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task FutureSetCreatedFirst_IsStillExcludedFromEarlierDays()
    {
        await SeedPublicItemsAsync(40);
        Daily.AdminDayResponse future = (await Daily.AdminGetAsync("2026-10-25", DbContext, Now, CancellationToken.None)).Value;

        Daily.DailyQuizResponse today = await GetAsync();

        today.Items.Select(i => Guid.Parse(i.Id)).Should().NotIntersectWith(future.Items.Select(i => i.ItemId));
    }

    [Theory]
    [InlineData(new[] { 0, -1, -2 }, 3)]
    [InlineData(new[] { -1, -2 }, 2)]
    [InlineData(new[] { -2, -3 }, 0)]
    [InlineData(new int[0], 0)]
    public void Streak_EndsTodayOrYesterday(int[] offsets, int expected)
    {
        Daily.ComputeStreak(offsets.Select(o => Today.AddDays(o)), Today).Should().Be(expected);
    }
}
