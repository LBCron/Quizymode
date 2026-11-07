using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Features.Items.Add;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Features.Items.Get;
using Quizymode.Api.Features.Items.GetById;
using Quizymode.Api.Features.Items.ReviewBoard;
using Quizymode.Api.Features.Items.Update;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

/// <summary>#407: curated question picture is returned by every read path, ignored by write paths, and part of the duplicate rule.</summary>
public sealed class QuestionImageTests : ItemTestFixture
{
    private const string Key = "curated:flags/fr";
    private const string Alt = "Three vertical bands: blue, white, red";
    private const string ExplanationKey = "curated:diagrams/pythagorean-theorem";
    private const string ExplanationAlt = "Right triangle with legs a and b and hypotenuse c";
    private readonly string _userId = Guid.NewGuid().ToString();

    private Mock<IUserContext> User() => CreateUserContextMock(_userId);

    private async Task<Item> SeedAsync(bool withImage = true, string question = "Which country uses this flag?", bool withExplanationImage = false)
    {
        Item item = await CreateItemWithCategoryAsync(
            Guid.NewGuid(), "geography", question, "France", ["Italy"], "x", false, _userId);
        if (withImage)
        {
            item.QuestionImageKey = Key;
            item.QuestionImageAlt = Alt;
        }

        if (withExplanationImage)
        {
            item.ExplanationImageKey = ExplanationKey;
            item.ExplanationImageAlt = ExplanationAlt;
        }

        item.ReadyForReview = true;
        await DbContext.SaveChangesAsync();
        return item;
    }

    // --- read paths ---

    [Fact]
    public async Task GetItemById_ReturnsQuestionImage()
    {
        Item item = await SeedAsync();

        Result<GetItemById.Response> result = await GetItemById.HandleAsync(
            item.Id.ToString(), DbContext, User().Object, CancellationToken.None);

        result.Value.QuestionImage.Should().Be(new ItemImageReference(Key, Alt));
    }

    [Fact]
    public async Task GetItemById_WithoutImage_ReturnsNull()
    {
        Item item = await SeedAsync(withImage: false);

        Result<GetItemById.Response> result = await GetItemById.HandleAsync(
            item.Id.ToString(), DbContext, User().Object, CancellationToken.None);

        result.Value.QuestionImage.Should().BeNull();
    }

    [Fact]
    public async Task ReviewBoard_ReturnsQuestionImage()
    {
        await SeedAsync();

        Result<GetReviewBoardItems.Response> result = await GetReviewBoardItems.HandleAsync(DbContext, CancellationToken.None);

        result.Value.Items.Should().ContainSingle().Which.QuestionImage.Should().Be(new ItemImageReference(Key, Alt));
    }

    [Fact]
    public async Task ItemResponseMapper_ReturnsQuestionImageOrNull()
    {
        Item picture = await SeedAsync();
        Item plain = await SeedAsync(withImage: false, question: "Plain question?");
        ItemResponseMapper mapper = new(User().Object);

        mapper.MapToResponse(picture, []).QuestionImage.Should().Be(new ItemImageReference(Key, Alt));
        mapper.MapToResponse(plain, []).QuestionImage.Should().BeNull();
    }

    [Fact]
    public async Task ApproveAndReject_ReturnQuestionImage()
    {
        Item first = await SeedAsync();
        Item second = await SeedAsync(question: "Which country uses this other flag?");

        Result<ApproveItem.ApproveItemResponse> approved = await ApproveItem.HandleAsync(first.Id, DbContext, CancellationToken.None);
        Result<RejectItem.RejectItemResponse> rejected = await RejectItem.HandleAsync(
            second.Id, new RejectItem.Request("nope"), DbContext, User().Object, CancellationToken.None);

        approved.Value.QuestionImage.Should().Be(new ItemImageReference(Key, Alt));
        rejected.Value.QuestionImage.Should().Be(new ItemImageReference(Key, Alt));
    }

    [Fact]
    public async Task ReadPaths_ReturnExplanationImage_OrNull()
    {
        Item picture = await SeedAsync(withImage: false, question: "Pythagoras?", withExplanationImage: true);
        Item plain = await SeedAsync(withImage: false, question: "Plain question?");
        ItemImageReference expected = new(ExplanationKey, ExplanationAlt);

        Result<GetItemById.Response> byId = await GetItemById.HandleAsync(
            picture.Id.ToString(), DbContext, User().Object, CancellationToken.None);
        Result<GetReviewBoardItems.Response> board = await GetReviewBoardItems.HandleAsync(DbContext, CancellationToken.None);
        ItemResponseMapper mapper = new(User().Object);

        byId.Value.ExplanationImage.Should().Be(expected);
        board.Value.Items.Single(i => i.Id == picture.Id.ToString()).ExplanationImage.Should().Be(expected);
        mapper.MapToResponse(picture, []).ExplanationImage.Should().Be(expected);
        mapper.MapToResponse(plain, []).ExplanationImage.Should().BeNull();
    }

    [Fact]
    public async Task ApproveAndReject_ReturnExplanationImage()
    {
        Item first = await SeedAsync(withExplanationImage: true);
        Item second = await SeedAsync(question: "Which country uses this other flag?", withExplanationImage: true);

        Result<ApproveItem.ApproveItemResponse> approved = await ApproveItem.HandleAsync(first.Id, DbContext, CancellationToken.None);
        Result<RejectItem.RejectItemResponse> rejected = await RejectItem.HandleAsync(
            second.Id, new RejectItem.Request("nope"), DbContext, User().Object, CancellationToken.None);

        approved.Value.ExplanationImage.Should().Be(new ItemImageReference(ExplanationKey, ExplanationAlt));
        rejected.Value.ExplanationImage.Should().Be(new ItemImageReference(ExplanationKey, ExplanationAlt));
    }

    // --- write paths ---

    [Fact]
    public async Task Update_KeepsStoredExplanationImage_AndAllowsEmptyExplanation()
    {
        Item item = await SeedAsync(withExplanationImage: true);
        UpdateItem.Request Request(string explanation) => new(
            Category: "geography",
            NavigationKeyword1: "capitals",
            NavigationKeyword2: "europe",
            Question: item.Question,
            CorrectAnswer: "France",
            IncorrectAnswers: ["Italy", "Ireland"],
            Explanation: explanation,
            IsPrivate: false);

        Result<UpdateItem.Response> edited = await UpdateItem.HandleAsync(
            item.Id.ToString(), Request("Edited"), DbContext, SimHashService, User().Object, new Mock<IAuditService>().Object,
            TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);
        Result<UpdateItem.Response> emptied = await UpdateItem.HandleAsync(
            item.Id.ToString(), Request(" "), DbContext, SimHashService, User().Object, new Mock<IAuditService>().Object,
            TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);

        edited.IsSuccess.Should().BeTrue();
        emptied.IsSuccess.Should().BeTrue();
        Item stored = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id);
        stored.ExplanationImageKey.Should().Be(ExplanationKey);
        stored.ExplanationImageAlt.Should().Be(ExplanationAlt);
        stored.Explanation.Should().Be(" ");
    }

    [Fact]
    public async Task Update_KeepsStoredQuestionImage()
    {
        Item item = await SeedAsync();
        UpdateItem.Request request = new(
            Category: "geography",
            NavigationKeyword1: "capitals",
            NavigationKeyword2: "europe",
            Question: item.Question,
            CorrectAnswer: "France",
            IncorrectAnswers: ["Italy", "Ireland"],
            Explanation: "Edited",
            IsPrivate: false);

        Result<UpdateItem.Response> result = await UpdateItem.HandleAsync(
            item.Id.ToString(), request, DbContext, SimHashService, User().Object, new Mock<IAuditService>().Object,
            TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        Item stored = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id);
        stored.QuestionImageKey.Should().Be(Key);
        stored.QuestionImageAlt.Should().Be(Alt);
    }

    [Fact]
    public async Task AddItem_TextOnlyCopyOfPictureQuestion_IsAllowed()
    {
        Item picture = await SeedAsync();
        AddItem.Request request = new(
            Category: "geography",
            NavigationKeyword1: "capitals",
            NavigationKeyword2: "europe",
            IsPrivate: false,
            Question: picture.Question,
            CorrectAnswer: "France",
            IncorrectAnswers: ["Italy"],
            Explanation: "");

        Result<AddItem.Response> result = await AddItemHandler.HandleAsync(
            request, DbContext, SimHashService, User().Object, new Mock<IAuditService>().Object,
            TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        (await DbContext.Items.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task AddItem_SameTextAsTextOnlyItem_IsStillADuplicate()
    {
        Item plain = await SeedAsync(withImage: false);
        AddItem.Request request = new(
            Category: "geography",
            NavigationKeyword1: "capitals",
            NavigationKeyword2: "europe",
            IsPrivate: false,
            Question: plain.Question,
            CorrectAnswer: "France",
            IncorrectAnswers: ["Italy"],
            Explanation: "");

        Result<AddItem.Response> result = await AddItemHandler.HandleAsync(
            request, DbContext, SimHashService, User().Object, new Mock<IAuditService>().Object,
            TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);

        result.IsFailure.Should().BeTrue();
    }

    [Fact]
    public async Task AddBulk_TextOnlyCopyOfPictureQuestion_IsCreatedNotDuplicate()
    {
        Item picture = await SeedAsync();
        AddItemsBulk.Request request = new(
            IsPrivate: false,
            Category: "geography",
            Keyword1: "capitals",
            Keyword2: "europe",
            Keywords: [new AddItemsBulk.KeywordRequest("capitals", false), new AddItemsBulk.KeywordRequest("europe", false)],
            Items: [new AddItemsBulk.ItemRequest(picture.Question, "France", ["Italy"], "copy")]);

        Result<AddItemsBulk.Response> result = await AddItemsBulkHandler.HandleAsync(
            request, DbContext, SimHashService, User().Object, TaxonomyItemCategoryResolver, TaxonomyRegistry,
            new Mock<IAuditService>().Object, NullLogger.Instance, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.CreatedCount.Should().Be(1);
        result.Value.DuplicateCount.Should().Be(0);
    }

    // --- shared helper rules ---

    [Theory]
    [InlineData("a", "a", null, "a", "a", null, true)]
    [InlineData("a", "a", null, "A", "b", null, true)]
    [InlineData("a", "a", "curated:flags/fr", "A", "b", "curated:flags/fr", true)]
    [InlineData("a", "a", "curated:flags/fr", "a", "a", "curated:flags/it", false)]
    [InlineData("a", "a", "curated:flags/fr", "a", "a", null, false)]
    [InlineData("a", "a", null, "a", "a", "curated:flags/fr", false)]
    [InlineData("a", "a", null, "z", "z", null, false)]
    [InlineData("a", "a", "curated:flags/fr", "z", "z", "curated:flags/fr", false)]
    public void IsDuplicate_RequiresSameTextOrSimHashAndSameImageKey(
        string existingQ, string existingSig, string? existingKey,
        string newQ, string newSig, string? newKey, bool expected) =>
        ItemDuplicateRules.IsDuplicate(existingQ, existingSig, existingKey, newQ, newSig, newKey).Should().Be(expected);

    [Theory]
    [InlineData("curated:flags/fr", true)]
    [InlineData("curated:flags/fr-2/x", true)]
    [InlineData("curated:flags/FR", false)]
    [InlineData("curated:fr", false)]
    [InlineData("curated:../x", false)]
    [InlineData("curated:flags//fr", false)]
    [InlineData("https://evil/x.webp", false)]
    [InlineData("__proto__", false)]
    [InlineData("constructor", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsValidKey_AcceptsOnlyCuratedLowercasePaths(string? key, bool expected) =>
        ItemImageReferenceHelper.IsValidKey(key).Should().Be(expected);

    [Fact]
    public void IsValidKey_RejectsKeysOverOneHundredCharacters()
    {
        ItemImageReferenceHelper.IsValidKey("curated:flags/" + new string('a', 86)).Should().BeTrue();
        ItemImageReferenceHelper.IsValidKey("curated:flags/" + new string('a', 87)).Should().BeFalse();
    }

    [Theory]
    [InlineData("Blue, white, red bands", true)]
    [InlineData("  padded  ", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData(null, false)]
    [InlineData("two\nlines", false)]
    [InlineData("two\rlines", false)]
    [InlineData("tab\there", false)]
    [InlineData("nul\u0000here", false)]
    public void IsValidAltText_RequiresNonBlankSingleLineText(string? alt, bool expected) =>
        ItemImageReferenceHelper.IsValidAltText(alt).Should().Be(expected);

    [Fact]
    public void IsValidAltText_EnforcesThreeHundredCharacters()
    {
        ItemImageReferenceHelper.IsValidAltText(new string('a', 300)).Should().BeTrue();
        ItemImageReferenceHelper.IsValidAltText(new string('a', 301)).Should().BeFalse();
    }

    [Fact]
    public void Normalize_TrimsKeyAndAltAndMapsNullToNull()
    {
        ItemImageReferenceHelper.Normalize(null).Should().BeNull();
        ItemImageReferenceHelper.Normalize(new ItemImageReference(" curated:flags/fr ", "  alt  "))
            .Should().Be(new ItemImageReference("curated:flags/fr", "alt"));
    }
}
