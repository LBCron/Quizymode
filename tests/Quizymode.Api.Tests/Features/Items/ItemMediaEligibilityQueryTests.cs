using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Features.DailyQuiz;
using Quizymode.Api.Features.ReviewQueue;
using Quizymode.Api.Services.Taxonomy.Suggestions;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

/// <summary>
/// #400 (AC 3.25.7): the central eligibility helpers and the direct item queries run against a real model. An item whose uploaded pictures are
/// not Approved is invisible to everyone but its creator (and admins by id) on every one of these surfaces.
/// </summary>
public sealed class ItemMediaEligibilityQueryTests : DatabaseTestFixture
{
    private const string Creator = "creator";
    private const string Other = "other";

    private readonly Category _category;
    private readonly Item _approved;
    private readonly Item _pending;
    private readonly Item _rejected;
    private readonly Item _withdrawn;
    private readonly Item _textOnly;

    public ItemMediaEligibilityQueryTests()
    {
        _category = VisibilitySeed.AddCategory(DbContext);
        _approved = Picture(ItemImageReviewState.Approved);
        _pending = Picture(ItemImageReviewState.PendingReview);
        _rejected = Picture(ItemImageReviewState.Rejected);
        _withdrawn = Picture(ItemImageReviewState.Withdrawn);
        _textOnly = VisibilitySeed.AddItem(DbContext, _category, Creator, false);
        DbContext.SaveChanges();
    }

    private Item Picture(ItemImageReviewState state) =>
        PictureSeed.AddPictureItem(DbContext, _category, Creator, false, state, PictureSeed.AddAsset(DbContext, Creator));

    private HashSet<Guid> Ids(params Item[] items) => items.Select(i => i.Id).ToHashSet();

    private HashSet<Guid> AllIds => Ids(_approved, _pending, _rejected, _withdrawn, _textOnly);

    [Fact]
    public async Task VisibleToAndPublicEligible_HideUnapprovedFromOthersButNotFromTheCreator()
    {
        (await DbContext.Items.Where(ItemVisibility.VisibleTo(Other)).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly));
        (await DbContext.Items.Where(ItemVisibility.PublicEligible).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly));
        (await DbContext.Items.Where(ItemVisibility.VisibleTo(Creator)).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(AllIds);
        (await DbContext.Items.Where(ItemVisibility.EligibleFor(null)).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly));
        (await DbContext.Items.Where(ItemVisibility.EligibleFor(Creator)).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(AllIds);
    }

    [Theory]
    [InlineData(ItemImageReviewState.Processing)]
    [InlineData(ItemImageReviewState.Failed)]
    public async Task ProcessingAndFailedStates_RoundTripAndStayHiddenFromEveryoneButTheCreator(ItemImageReviewState state)
    {
        Item item = Picture(state);
        await DbContext.SaveChangesAsync();
        DbContext.ChangeTracker.Clear();

        (await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id)).ImageReviewState.Should().Be(state);
        (await DbContext.Items.Where(ItemVisibility.VisibleTo(Other)).Select(i => i.Id).ToListAsync()).Should().NotContain(item.Id);
        (await DbContext.Items.Where(ItemVisibility.PublicEligible).Select(i => i.Id).ToListAsync()).Should().NotContain(item.Id);
        (await DbContext.Items.Where(ItemVisibility.EligibleFor(null)).Select(i => i.Id).ToListAsync()).Should().NotContain(item.Id);
        (await DbContext.Items.Where(ItemVisibility.VisibleTo(Creator)).Select(i => i.Id).ToListAsync()).Should().Contain(item.Id);
    }

    [Fact]
    public async Task AccessibleById_KeepsTheAdminBypass_ButNotForAnonymousOrUnrelatedUsers()
    {
        (await DbContext.Items.Where(ItemVisibility.AccessibleById(FakeUserContext.Anonymous)).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly));
        (await DbContext.Items.Where(ItemVisibility.AccessibleById(FakeUserContext.User(Other))).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly));
        (await DbContext.Items.Where(ItemVisibility.AccessibleById(FakeUserContext.Admin())).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(AllIds);
    }

    [Fact]
    public async Task AddableToCollection_AndInteractableBy_RequireEligibilityUnlessTheCallerIsTheCreator()
    {
        Collection published = VisibilitySeed.AddCollection(DbContext, Creator, true);
        Item privatePending = PictureSeed.AddPictureItem(DbContext, _category, Creator, true, ItemImageReviewState.PendingReview, PictureSeed.AddAsset(DbContext, Creator));
        Item privateApproved = PictureSeed.AddPictureItem(DbContext, _category, Creator, true, ItemImageReviewState.Approved, PictureSeed.AddAsset(DbContext, Creator));
        VisibilitySeed.Link(DbContext, published, privatePending);
        VisibilitySeed.Link(DbContext, published, privateApproved);
        await DbContext.SaveChangesAsync();

        (await ItemVisibility.AddableToCollection(DbContext, Other).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly, privateApproved), "published-through-a-public-collection does not outrank review");
        (await ItemVisibility.AddableToCollection(DbContext, Creator).Select(i => i.Id).ToListAsync())
            .Should().Contain(Ids(_pending, _rejected, _withdrawn, privatePending));
        (await ItemVisibility.AddableToCollection(DbContext, null).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly, privateApproved));
        (await ItemVisibility.InteractableBy(DbContext, FakeUserContext.User(Other)).Select(i => i.Id).ToListAsync())
            .Should().BeEquivalentTo(Ids(_approved, _textOnly, privateApproved));
        (await ItemVisibility.InteractableBy(DbContext, FakeUserContext.Admin()).CountAsync())
            .Should().Be(await DbContext.Items.CountAsync(), "admins keep their bypass");
    }

    [Fact]
    public async Task EligibleCollectionItems_DropsOnlyHiddenItems_AndKeepsRowsWithNoItem()
    {
        Collection collection = VisibilitySeed.AddCollection(DbContext, Creator, true);
        foreach (Item item in new[] { _approved, _pending, _rejected, _textOnly })
        {
            VisibilitySeed.Link(DbContext, collection, item);
        }

        DbContext.CollectionItems.Add(new CollectionItem { Id = Guid.NewGuid(), CollectionId = collection.Id, ItemId = Guid.NewGuid() });
        await DbContext.SaveChangesAsync();

        (await ItemVisibility.EligibleCollectionItems(DbContext, Other).CountAsync(ci => ci.CollectionId == collection.Id)).Should().Be(3);
        (await ItemVisibility.EligibleCollectionItems(DbContext, null).CountAsync(ci => ci.CollectionId == collection.Id)).Should().Be(3);
        (await ItemVisibility.EligibleCollectionItems(DbContext, Creator).CountAsync(ci => ci.CollectionId == collection.Id)).Should().Be(5);
    }

    [Fact]
    public async Task DailyQuizCandidates_ExcludeUnapprovedItems()
    {
        List<Guid> ranked = await DailyQuiz.RankCandidatesAsync(DbContext, new DateOnly(2026, 11, 3), [], CancellationToken.None);

        ranked.Should().BeEquivalentTo(Ids(_approved, _textOnly));
    }

    [Fact]
    public async Task ReviewQueueSummary_CountsOnlyEligibleItemsForOthers()
    {
        DateTime now = DateTime.UtcNow;
        foreach (Item item in new[] { _approved, _pending, _rejected, _textOnly })
        {
            foreach (string user in new[] { Creator, Other })
            {
                DbContext.ReviewQueueEntries.Add(new ReviewQueueEntry { UserId = user, ItemId = item.Id, DueAt = now.AddDays(-1), ItemVersionAt = now });
            }
        }

        await DbContext.SaveChangesAsync();

        (await ReviewQueue.GetSummaryAsync(DbContext, Other, now, CancellationToken.None)).TotalCount.Should().Be(2);
        (await ReviewQueue.GetSummaryAsync(DbContext, Creator, now, CancellationToken.None)).TotalCount.Should().Be(4);
    }

    [Fact]
    public async Task TopicSuggestionRows_ExcludeUnapprovedItems()
    {
        Keyword k1 = new() { Id = Guid.NewGuid(), Name = "k-one", IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
        Keyword k2 = new() { Id = Guid.NewGuid(), Name = "k-two", IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
        DbContext.Keywords.AddRange(k1, k2);
        foreach (Item item in new[] { _approved, _pending, _rejected, _withdrawn, _textOnly })
        {
            item.NavigationKeywordId1 = k1.Id;
            item.NavigationKeywordId2 = k2.Id;
            item.Explanation = "Some explanation";
        }

        await DbContext.SaveChangesAsync();

        List<TopicSuggestionProfiles.ProfileRow> rows = await TopicSuggestionProfiles.ProjectEligibleRows(DbContext, 5).ToListAsync();

        rows.Should().HaveCount(2);
    }
}
