using FluentAssertions;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Shared;

/// <summary>#400: content hash, state machine and the media-eligibility predicates (AC 3.25.3, 3.25.6, 3.25.7).</summary>
public sealed class ItemImageReviewRulesTests
{
    private static readonly PictureSlot Question = new(Guid.Parse("11111111-1111-1111-1111-111111111111"), PictureSeed.Sha('a'), "Alt", null);
    private static readonly PictureSlot Explanation = new(Guid.Parse("22222222-2222-2222-2222-222222222222"), PictureSeed.Sha('b'), "Other alt", "Credit");

    private static string Hash(
        string question = "Q?",
        string correct = "A",
        string[]? incorrect = null,
        string explanation = "E",
        ItemSpeechSupport? speech = null,
        PictureSlot? questionImage = null,
        PictureSlot? explanationImage = null) =>
        ItemImageReviewRules.ComputeContentHash(question, correct, incorrect ?? ["B", "C"], explanation, speech, questionImage ?? Question, explanationImage);

    [Fact]
    public void ContentHash_IsStableLowercaseHex()
    {
        string hash = Hash();

        hash.Should().MatchRegex("^[0-9a-f]{64}$");
        Hash().Should().Be(hash);
    }

    public static TheoryData<string> ChangedInputs => new()
    {
        "question", "correct", "incorrect", "incorrect-order", "explanation", "speech", "question-sha", "question-alt", "question-attribution", "explanation-slot"
    };

    [Theory]
    [MemberData(nameof(ChangedInputs))]
    public void ContentHash_ChangesWhenAnythingAReviewerJudgesChanges(string changed)
    {
        string baseline = Hash(explanationImage: Explanation);
        string different = changed switch
        {
            "question" => Hash(question: "Q2?", explanationImage: Explanation),
            "correct" => Hash(correct: "A2", explanationImage: Explanation),
            "incorrect" => Hash(incorrect: ["B", "D"], explanationImage: Explanation),
            "incorrect-order" => Hash(incorrect: ["C", "B"], explanationImage: Explanation),
            "explanation" => Hash(explanation: "E2", explanationImage: Explanation),
            "speech" => Hash(speech: new ItemSpeechSupport { Pronunciation = "kyoo", LanguageCode = "en" }, explanationImage: Explanation),
            "question-sha" => Hash(questionImage: Question with { Sha256 = PictureSeed.Sha('z') }, explanationImage: Explanation),
            "question-alt" => Hash(questionImage: Question with { AltText = "Changed" }, explanationImage: Explanation),
            "question-attribution" => Hash(questionImage: Question with { Attribution = "Someone" }, explanationImage: Explanation),
            _ => Hash(explanationImage: null)
        };

        different.Should().NotBe(baseline);
    }

    [Fact]
    public void ContentHash_IgnoresAssetIdWhenBytesAreTheSame()
    {
        Hash(questionImage: Question with { AssetId = Guid.NewGuid() }).Should().Be(Hash());
    }

    [Fact]
    public void Plan_NoUploadAndNoState_IsUnchanged()
    {
        ImageReviewTransition t = ItemImageReviewRules.Plan(null, 4, hasUpload: false, null, null);

        t.Should().Be(new ImageReviewTransition(false, null, 4, false));
    }

    [Theory]
    [InlineData(ItemImageReviewState.PendingReview)]
    [InlineData(ItemImageReviewState.Approved)]
    [InlineData(ItemImageReviewState.Rejected)]
    public void Plan_RemovingTheLastUpload_ClearsStateAndIncrementsRevision(ItemImageReviewState current)
    {
        ImageReviewTransition t = ItemImageReviewRules.Plan(current, 2, hasUpload: false, null, "h");

        t.Should().Be(new ImageReviewTransition(true, null, 3, false));
    }

    [Fact]
    public void Plan_FirstUpload_IsPendingWithTheNextRevisionEvenAfterARemoval()
    {
        ImageReviewTransition t = ItemImageReviewRules.Plan(null, 3, hasUpload: true, "h", null);

        t.Should().Be(new ImageReviewTransition(true, ItemImageReviewState.PendingReview, 4, true));
    }

    [Theory]
    [InlineData(ItemImageReviewState.PendingReview)]
    [InlineData(ItemImageReviewState.Approved)]
    [InlineData(ItemImageReviewState.Rejected)]
    [InlineData(ItemImageReviewState.Withdrawn)]
    public void Plan_UnchangedHash_KeepsTheStateAndRevision(ItemImageReviewState current)
    {
        ImageReviewTransition t = ItemImageReviewRules.Plan(current, 2, hasUpload: true, "same", "same");

        t.Should().Be(new ImageReviewTransition(false, current, 2, false));
    }

    [Theory]
    [InlineData(ItemImageReviewState.PendingReview)]
    [InlineData(ItemImageReviewState.Approved)]
    [InlineData(ItemImageReviewState.Rejected)]
    [InlineData(ItemImageReviewState.Withdrawn)]
    public void Plan_ChangedHash_ResubmitsFromAnyState(ItemImageReviewState current)
    {
        ImageReviewTransition t = ItemImageReviewRules.Plan(current, 2, hasUpload: true, "new", "old");

        t.Should().Be(new ImageReviewTransition(true, ItemImageReviewState.PendingReview, 3, true));
    }

    [Theory]
    [InlineData(ItemImageReviewState.PendingReview)]
    [InlineData(ItemImageReviewState.Approved)]
    [InlineData(ItemImageReviewState.Rejected)]
    public void Plan_ANewAssetIdWithTheSameHash_StillResubmits(ItemImageReviewState current)
    {
        ImageReviewTransition t = ItemImageReviewRules.Plan(current, 2, hasUpload: true, "same", "same", assetsChanged: true);

        t.Should().Be(new ImageReviewTransition(true, ItemImageReviewState.PendingReview, 3, true));
    }

    [Fact]
    public void IsRevisionConflict_OnlyMatchesTheReviewRevisionIndex()
    {
        ItemImageReviewRules.IsRevisionConflict(new Microsoft.EntityFrameworkCore.DbUpdateException(
            "x", new Exception("SQLite Error 19: 'UNIQUE constraint failed: ItemImageReviews.ItemId, ItemImageReviews.Revision'."))).Should().BeTrue();
        ItemImageReviewRules.IsRevisionConflict(new Microsoft.EntityFrameworkCore.DbUpdateException(
            "x", new Exception("SQLite Error 19: 'UNIQUE constraint failed: Keywords.Name'."))).Should().BeFalse();
    }

    [Fact]
    public void Plan_NonNullStateWithNoStoredHash_Resubmits()
    {
        ItemImageReviewRules.Plan(ItemImageReviewState.Approved, 1, true, "h", null).Changed.Should().BeTrue();
    }

    [Theory]
    [InlineData(true, false, ItemImageReviewState.PendingReview, true)]
    [InlineData(true, false, ItemImageReviewState.Rejected, true)]
    [InlineData(true, false, ItemImageReviewState.Withdrawn, true)]
    [InlineData(true, false, ItemImageReviewState.Approved, false)]
    [InlineData(true, false, null, false)]
    [InlineData(true, true, ItemImageReviewState.PendingReview, false)]
    [InlineData(false, false, ItemImageReviewState.PendingReview, false)]
    [InlineData(false, true, ItemImageReviewState.PendingReview, false)]
    public void BlocksPublish_OnlyForPrivateToPublicWithUnapprovedPictures(bool wasPrivate, bool willBePrivate, ItemImageReviewState? state, bool blocked)
    {
        ItemImageReviewRules.BlocksPublish(wasPrivate, willBePrivate, state).Should().Be(blocked);
    }

    public static TheoryData<ItemImageReviewState?, bool> Eligibility => new()
    {
        { null, true },
        { ItemImageReviewState.Approved, true },
        { ItemImageReviewState.PendingReview, false },
        { ItemImageReviewState.Rejected, false },
        { ItemImageReviewState.Withdrawn, false },
    };

    [Theory]
    [MemberData(nameof(Eligibility))]
    public void MediaEligibility_PredicatesAgree(ItemImageReviewState? state, bool eligible)
    {
        Item publicItem = new() { IsPrivate = false, CreatedBy = "owner", ImageReviewState = state };
        Item privateItem = new() { IsPrivate = true, CreatedBy = "owner", ImageReviewState = state };

        ItemVisibility.IsMediaEligible(publicItem).Should().Be(eligible);
        ItemVisibility.MediaEligible.Compile()(publicItem).Should().Be(eligible);
        ItemVisibility.PublicEligible.Compile()(publicItem).Should().Be(eligible);
        ItemVisibility.PublicEligible.Compile()(privateItem).Should().BeFalse();

        // Everyone but the creator needs eligibility; the creator always sees their own item.
        foreach (string? caller in new[] { null, "", "other" })
        {
            ItemVisibility.IsVisibleTo(publicItem, caller).Should().Be(eligible);
            ItemVisibility.VisibleTo(caller).Compile()(publicItem).Should().Be(eligible);
            ItemVisibility.EligibleFor(caller).Compile()(publicItem).Should().Be(eligible);
        }

        ItemVisibility.IsVisibleTo(publicItem, "owner").Should().BeTrue();
        ItemVisibility.VisibleTo("owner").Compile()(publicItem).Should().BeTrue();
        ItemVisibility.EligibleFor("owner").Compile()(publicItem).Should().BeTrue();
        ItemVisibility.EligibleFor("owner").Compile()(privateItem).Should().BeTrue();
    }

    [Theory]
    [MemberData(nameof(Eligibility))]
    public void AccessibleById_HidesUnapprovedFromEveryoneButCreatorAndAdmin(ItemImageReviewState? state, bool eligible)
    {
        Item item = new() { IsPrivate = false, CreatedBy = "owner", ImageReviewState = state };

        ItemVisibility.AccessibleById(FakeUserContext.Anonymous).Compile()(item).Should().Be(eligible);
        ItemVisibility.AccessibleById(FakeUserContext.User("other")).Compile()(item).Should().Be(eligible);
        ItemVisibility.CanAccessById(item, FakeUserContext.User("other")).Should().Be(eligible);
        ItemVisibility.AccessibleById(FakeUserContext.User("owner")).Compile()(item).Should().BeTrue();
        ItemVisibility.AccessibleById(FakeUserContext.Admin()).Compile()(item).Should().BeTrue();
        ItemVisibility.CanAccessById(item, FakeUserContext.Admin()).Should().BeTrue();
    }

    [Fact]
    public void DuplicateIdentity_UsesBytesForUploadsAndKeyForCurated()
    {
        ItemImageReviewRules.DuplicateIdentity("media:abc", Guid.NewGuid(), PictureSeed.Sha('a')).Should().Be("sha256:" + PictureSeed.Sha('a'));
        ItemImageReviewRules.DuplicateIdentity("curated:flags/fr", null, null).Should().Be("curated:flags/fr");
        ItemImageReviewRules.DuplicateIdentity(null, null, null).Should().BeNull();
    }
    [Fact]
    public void NullDescriptionKeepsLegacyCanonicalHashButDescriptionChangesRequireNewReview()
    {
        Hash().Should().Be("e7ffbb76d0cb6631725afcd8df6bc3527c78e0ab19b8f4f1c970cd9d93e3569d");
        Hash(questionImage: Question with { LongDescription = "A rising line." }).Should().NotBe(Hash());
    }


    [Fact]
    public void OptionalRationalePreservesOldHashAndUsesDeterministicSemanticOrder()
    {
        string Hash(IReadOnlyDictionary<int, string>? reasons) => ItemImageReviewRules.ComputeContentHash("Q", "A", ["B", "C"], "E", null, null, null, reasons);
        Hash(null).Should().Be(Hash(new Dictionary<int, string>()));
        Hash(new Dictionary<int, string> { [1] = "C reason", [0] = "B reason" }).Should().Be(Hash(new Dictionary<int, string> { [0] = "B reason", [1] = "C reason" }));
        Hash(new Dictionary<int, string> { [0] = "B reason" }).Should().NotBe(Hash(null));
    }
}
