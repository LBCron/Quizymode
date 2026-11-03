using FluentAssertions;
using Quizymode.Api.Services;
using Xunit;

namespace Quizymode.Api.Tests.Services;

public sealed class DatabaseSeederFeaturedSetsTests
{
    [Fact]
    public void DefaultFeaturedSets_HasFourEntriesWithUniqueSortOrdersZeroToThree()
    {
        DatabaseSeederHostedService.DefaultFeaturedSets.Should().HaveCount(4);
        DatabaseSeederHostedService.DefaultFeaturedSets
            .Select(s => s.SortOrder)
            .Should().BeEquivalentTo(new[] { 0, 1, 2, 3 });
    }

    [Fact]
    public void DefaultFeaturedSets_PutsGuessTheFlagFirst()
    {
        var first = DatabaseSeederHostedService.DefaultFeaturedSets.Single(s => s.SortOrder == 0);

        first.DisplayName.Should().Be("Guess the Flag");
        first.CategorySlug.Should().Be("geography");
        first.Kw1.Should().Be("flags");
        first.Kw2.Should().Be("countries");
    }

    [Fact]
    public void DefaultFeaturedSets_DoesNotContainWorldCup()
    {
        DatabaseSeederHostedService.DefaultFeaturedSets
            .Should().NotContain(s => s.Kw2 == "world-cup" || s.DisplayName == "World Cup Starter");
    }
}
