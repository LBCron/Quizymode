using FluentAssertions;
using Quizymode.Api.Features.Personalization;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.LearningLoop;

public sealed class GetTopicActivityTests : DatabaseTestFixture
{
    private static readonly DateTime Now = new(2026, 11, 6, 12, 0, 0, DateTimeKind.Utc);

    private void Add(string user, DateTime at, string kind = "category", string? slug = "history", string nav = "", string mode = "quiz")
    {
        DbContext.StudySessions.Add(new StudySession
        {
            Id = Guid.NewGuid(), UserId = user, RunId = Guid.NewGuid().ToString(), CompletedAt = at, Mode = mode,
            SourceKind = kind, SourceCategorySlug = slug, NavigationKeywords = nav, Total = 5, Correct = 3
        });
    }

    [Fact]
    public async Task RollsUpToL1_CountsBothModes_AndIgnoresUnattributableRuns()
    {
        Add("u", Now.AddDays(-1), nav: "wwii,europe");
        Add("u", Now.AddDays(-2), nav: "wwii", mode: "learn");
        Add("u", Now.AddDays(-3), kind: "global", slug: null);
        Add("u", Now.AddDays(-3), kind: "collection", slug: null);
        await DbContext.SaveChangesAsync();

        GetTopicActivity.Response r = await GetTopicActivity.GetAsync(DbContext, "u", Now, CancellationToken.None);

        r.Topics.Should().ContainSingle();
        r.Topics[0].Path.Should().Be("history/wwii");
        r.Topics[0].Runs.Should().Be(2);
        r.Topics[0].LastCompletedAt.Should().Be(Now.AddDays(-1));
    }

    [Fact]
    public async Task ExcludesRunsOutsideThirtyDays_AndRequiresTwoRuns()
    {
        Add("u", Now.AddDays(-31));
        Add("u", Now.AddDays(-29));
        Add("u", Now.AddDays(-5), slug: "science");
        Add("u", Now.AddDays(-4), slug: "science");
        Add("u", Now.AddDays(1), slug: "science");
        await DbContext.SaveChangesAsync();

        GetTopicActivity.Response r = await GetTopicActivity.GetAsync(DbContext, "u", Now, CancellationToken.None);

        r.Topics.Select(t => t.Path).Should().Equal("science");
        r.Topics[0].Runs.Should().Be(2);
    }

    [Fact]
    public async Task Orders_ByRuns_ThenRecency_ThenPath()
    {
        foreach (int d in new[] { 10, 11, 12 }) Add("u", Now.AddDays(-d), slug: "a-many");
        foreach (int d in new[] { 1, 20 }) Add("u", Now.AddDays(-d), slug: "b-recent");
        foreach (int d in new[] { 2, 3 }) Add("u", Now.AddDays(-d), slug: "d-tie");
        foreach (int d in new[] { 2, 3 }) Add("u", Now.AddDays(-d), slug: "c-tie");
        await DbContext.SaveChangesAsync();

        GetTopicActivity.Response r = await GetTopicActivity.GetAsync(DbContext, "u", Now, CancellationToken.None);

        r.Topics.Select(t => t.Path).Should().Equal("a-many", "b-recent", "c-tie", "d-tie");
    }

    [Fact]
    public async Task IsScopedToTheCaller()
    {
        Add("other", Now.AddDays(-1));
        Add("other", Now.AddDays(-2));
        Add("u", Now.AddDays(-1));
        await DbContext.SaveChangesAsync();

        (await GetTopicActivity.GetAsync(DbContext, "u", Now, CancellationToken.None)).Topics.Should().BeEmpty();
        (await GetTopicActivity.GetAsync(DbContext, "other", Now, CancellationToken.None)).Topics.Should().ContainSingle();
    }
}
