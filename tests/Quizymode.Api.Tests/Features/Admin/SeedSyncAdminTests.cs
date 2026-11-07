using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

public sealed class SeedSyncAdminTests : ItemTestFixture
{
    private readonly FakeGitHubSeedSource _gitHubSeedSource = new();
    private readonly SeedSyncAdminService _service;
    private readonly RecordingInvalidator _topicSuggestionInvalidator = new();

    private sealed class RecordingInvalidator : Quizymode.Api.Services.Taxonomy.Suggestions.ITopicSuggestionInvalidator
    {
        public int Calls { get; private set; }

        public void Invalidate() => Calls++;
    }

    public SeedSyncAdminTests()
    {
        Mock<IWebHostEnvironment> webHostEnvironment = new();
        webHostEnvironment.Setup(env => env.ContentRootPath).Returns("/nonexistent");
        LocalSeedLoader localSeedLoader = new(
            webHostEnvironment.Object,
            NullLogger<LocalSeedLoader>.Instance);

        Mock<IUserContext> userContext = new();
        _service = new SeedSyncAdminService(
            DbContext,
            TaxonomyRegistry,
            _gitHubSeedSource,
            localSeedLoader,
            userContext.Object,
            _topicSuggestionInvalidator);
    }

    [Fact]
    public async Task PreviewAsync_InitialSeed_ReturnsCreatedDeltaForGitHubRef()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(
                    Guid.Parse("11111111-1111-1111-1111-111111111111"),
                    "What is the capital of France?",
                    "Paris",
                    ["Lyon", "Marseille", "Nice"],
                    explanation: "Paris is the capital city of France.",
                    keywords: ["european-union"]),
                BuildItem(
                    Guid.Parse("22222222-2222-2222-2222-222222222222"),
                    "What is the capital of Germany?",
                    "Berlin",
                    ["Munich", "Hamburg", "Frankfurt"],
                    explanation: "Berlin is the capital city of Germany.")
            ]);

        Result<SeedSyncAdmin.PreviewResponse> result = await _service.PreviewAsync(request, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        result.Value!.RepositoryOwner.Should().Be("quizymode");
        result.Value.RepositoryName.Should().Be("quizymode");
        result.Value.GitRef.Should().Be("main");
        result.Value.ResolvedCommitSha.Should().Be("abc123def456");
        result.Value.ExistingItemCount.Should().Be(0);
        result.Value.CreatedCount.Should().Be(2);
        result.Value.UpdatedCount.Should().Be(0);
        result.Value.UnchangedCount.Should().Be(0);
        result.Value.HasMoreChanges.Should().BeFalse();
        result.Value.Changes.Should().HaveCount(2);
        result.Value.Changes.Should().OnlyContain(change => change.Action == "Created");
    }

    [Fact]
    public async Task ApplyAsync_UpsertsRepoManagedPublicItems_AndCreatesPublicKeywords()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Guid itemId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(
                    itemId,
                    "What is the capital of Italy?",
                    "Rome",
                    ["Milan", "Naples", "Turin"],
                    explanation: "Rome is the capital city of Italy.",
                    keywords: ["eurozone", "mediterranean"])
            ]);

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(request, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.CreatedCount.Should().Be(1);
        result.Value.ResolvedCommitSha.Should().Be("abc123def456");

        Item item = await DbContext.Items
            .Include(i => i.ItemKeywords)
                .ThenInclude(ik => ik.Keyword)
            .SingleAsync();

        item.Id.Should().Be(itemId);
        item.IsRepoManaged.Should().BeTrue();
        item.IsPrivate.Should().BeFalse();
        item.CreatedBy.Should().Be("seeder");

        List<string> attachedKeywords = item.ItemKeywords
            .Select(ik => ik.Keyword.Name)
            .OrderBy(x => x)
            .ToList();

        attachedKeywords.Should().Contain("capitals");
        attachedKeywords.Should().Contain("europe");
        attachedKeywords.Should().Contain("eurozone");
        attachedKeywords.Should().Contain("mediterranean");

        DbContext.Keywords.Should().Contain(k => k.Name == "eurozone" && !k.IsPrivate);
        DbContext.Keywords.Should().Contain(k => k.Name == "mediterranean" && !k.IsPrivate);
    }

    [Fact]
    public async Task ApplyAsync_InvalidatesTopicSuggestionProfiles_OnlyAfterASuccessfulApply()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(Guid.Parse("33333333-3333-3333-3333-333333333335"), "What is the capital of Spain?", "Madrid", ["Lisbon"])
            ]);

        Result<SeedSyncAdmin.PreviewResponse> preview = await _service.PreviewAsync(request, CancellationToken.None);
        preview.IsSuccess.Should().BeTrue();
        _topicSuggestionInvalidator.Calls.Should().Be(0, "a preview changes nothing");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(request, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        _topicSuggestionInvalidator.Calls.Should().Be(1);
    }

    [Fact]
    public async Task ApplyAsync_UpsertsRepoManagedSpeechMetadata()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Guid itemId = Guid.Parse("33333333-3333-3333-3333-333333333334");
        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(
                    itemId,
                    "How do you say black in beginner Japanese?",
                    "黒い",
                    ["白い"],
                    questionSpeech: new ItemSpeechSupport { Pronunciation = "how do you say black in beginner japanese", LanguageCode = "en-US" },
                    correctAnswerSpeech: new ItemSpeechSupport { Pronunciation = "kuroi", LanguageCode = "ja-JP" },
                    incorrectAnswerSpeech: new Dictionary<int, ItemSpeechSupport>
                    {
                        [0] = new() { Pronunciation = "shiroi", LanguageCode = "ja-JP" }
                    })
            ]);

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(request, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();

        Item item = await DbContext.Items.SingleAsync(i => i.Id == itemId);
        item.CorrectAnswerSpeech!.Pronunciation.Should().Be("kuroi");
        item.CorrectAnswerSpeech.LanguageCode.Should().Be("ja-JP");
        item.IncorrectAnswerSpeech.Should().ContainKey(0);
    }

    [Fact]
    public async Task ApplyAsync_UpsertsRepoManagedPublicCollections_FromManifest()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Guid itemId = Guid.Parse("12345678-1234-1234-1234-123456789012");
        Guid collectionId = Guid.Parse("87654321-4321-4321-4321-210987654321");

        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(
                    itemId,
                    "What is the capital of Austria?",
                    "Vienna",
                    ["Salzburg", "Graz", "Linz"])
            ],
            [
                new SeedSyncAdmin.SeedCollectionRequest(
                    CollectionId: collectionId,
                    Name: "European Capitals",
                    Description: "Repo-managed collection from admin sync.",
                    ItemIds: [itemId])
            ]);

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(request, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.CollectionCreatedCount.Should().Be(1);

        Collection collection = await DbContext.Collections.SingleAsync(c => c.Id == collectionId);
        collection.IsRepoManaged.Should().BeTrue();
        collection.IsPublic.Should().BeTrue();
        collection.CreatedBy.Should().Be("seeder");

        List<Guid> collectionItemIds = await DbContext.CollectionItems
            .Where(link => link.CollectionId == collectionId)
            .Select(link => link.ItemId)
            .ToListAsync();

        collectionItemIds.Should().Equal(itemId);
    }

    [Fact]
    public async Task PreviewAsync_AfterInitialSeed_ReturnsOnlyDelta()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Guid franceItemId = Guid.Parse("44444444-4444-4444-4444-444444444444");
        Guid germanyItemId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        Guid spainItemId = Guid.Parse("66666666-6666-6666-6666-666666666666");

        SeedSyncAdmin.Request initialRequest = BuildRequest(
            [
                BuildItem(franceItemId, "What is the capital of France?", "Paris", ["Lyon", "Marseille", "Nice"], explanation: "Initial explanation."),
                BuildItem(germanyItemId, "What is the capital of Germany?", "Berlin", ["Munich", "Hamburg", "Frankfurt"])
            ]);

        Result<SeedSyncAdmin.ApplyResponse> initialApply = await _service.ApplyAsync(initialRequest, CancellationToken.None);
        initialApply.IsSuccess.Should().BeTrue();

        SeedSyncAdmin.Request updatedRequest = BuildRequest(
            [
                BuildItem(franceItemId, "What is the capital of France?", "Paris", ["Lyon", "Marseille", "Nice"], explanation: "Updated explanation."),
                BuildItem(germanyItemId, "What is the capital of Germany?", "Berlin", ["Munich", "Hamburg", "Frankfurt"]),
                BuildItem(spainItemId, "What is the capital of Spain?", "Madrid", ["Barcelona", "Valencia", "Seville"])
            ]);

        Result<SeedSyncAdmin.PreviewResponse> preview = await _service.PreviewAsync(updatedRequest, CancellationToken.None);

        preview.IsSuccess.Should().BeTrue();
        preview.Value!.ExistingItemCount.Should().Be(2);
        preview.Value.CreatedCount.Should().Be(1);
        preview.Value.UpdatedCount.Should().Be(1);
        preview.Value.UnchangedCount.Should().Be(1);
        preview.Value.Changes.Should().HaveCount(2);
        preview.Value.Changes.Should().OnlyContain(change => change.Action == "Created" || change.Action == "Updated");
        preview.Value.Changes.Should().Contain(change =>
            change.ItemId == franceItemId && change.ChangedFields.Contains("explanation"));
        preview.Value.Changes.Should().Contain(change => change.ItemId == spainItemId && change.Action == "Created");
    }

    [Fact]
    public async Task ApplyAsync_RecreatesRepoManagedItem_WhenRemovedFromDatabase()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Guid itemId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(itemId, "What is the capital of Portugal?", "Lisbon", ["Porto", "Braga", "Coimbra"])
            ]);

        Result<SeedSyncAdmin.ApplyResponse> firstApply = await _service.ApplyAsync(request, CancellationToken.None);
        firstApply.IsSuccess.Should().BeTrue();

        Item existing = await DbContext.Items
            .Include(i => i.ItemKeywords)
            .SingleAsync(i => i.Id == itemId);

        DbContext.ItemKeywords.RemoveRange(existing.ItemKeywords);
        DbContext.Items.Remove(existing);
        await DbContext.SaveChangesAsync();

        Result<SeedSyncAdmin.ApplyResponse> secondApply = await _service.ApplyAsync(request, CancellationToken.None);

        secondApply.IsSuccess.Should().BeTrue();
        secondApply.Value!.CreatedCount.Should().Be(1);

        int itemCount = await DbContext.Items.CountAsync(i => i.Id == itemId);
        itemCount.Should().Be(1);
        DbContext.Items.Should().Contain(i => i.Id == itemId && i.CreatedBy == "seeder" && i.IsRepoManaged && !i.IsPrivate);
    }

    [Fact]
    public async Task PreviewAsync_AllowsLongSourceUrlsWithinExpandedLimit()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        string longSourceUrl = "https://www.wordreference.com/search?q=%D0%9F%D1%80%D0%BE%D1%87%D0%B8%D1%82%D0%B0%D0%B9%D1%82%D0%B5%20%D1%8D%D1%82%D0%BE%20%D0%BF%D1%80%D0%B5%D0%B4%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5%2C%20%D0%BF%D0%BE%D0%B6%D0%B0%D0%BB%D1%83%D0%B9%D1%81%D1%82%D0%B0.";
        longSourceUrl.Length.Should().BeGreaterThan(200);

        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(
                    Guid.Parse("99999999-9999-9999-9999-999999999999"),
                    "What is the capital of France?",
                    "Paris",
                    ["Lyon", "Marseille", "Nice"],
                    source: longSourceUrl)
            ]);

        Result<SeedSyncAdmin.PreviewResponse> result = await _service.PreviewAsync(request, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.CreatedCount.Should().Be(1);
    }

    [Fact]
    public async Task ApplyAsync_ReturnsValidationError_WhenItemIdAlreadyBelongsToNonRepoManagedItem()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Guid conflictingItemId = Guid.Parse("88888888-8888-8888-8888-888888888888");
        Item existing = await CreateItemWithCategoryAsync(
            itemId: conflictingItemId,
            categoryName: "geography",
            question: "Legacy row with conflicting item id",
            correctAnswer: "Paris",
            incorrectAnswers: ["Lyon", "Marseille", "Nice"],
            explanation: "Legacy explanation.",
            isPrivate: false,
            createdBy: "seed-import");
        await DbContext.SaveChangesAsync();

        SeedSyncAdmin.Request request = BuildRequest(
            [
                BuildItem(
                    conflictingItemId,
                    "What is the capital of France?",
                    "Paris",
                    ["Lyon", "Marseille", "Nice"])
            ]);

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(request, CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().NotBeNull();
        result.Error!.Code.Should().Be("Admin.ItemSyncIdConflict");
        result.Error.Description.Should().Contain(conflictingItemId.ToString());
        existing.Id.Should().Be(conflictingItemId);
    }

    [Fact]
    public async Task ApplyAsync_RefusesAnExistingItemThatHoldsUploadedPictureState_AndLeavesItUntouched()
    {
        // #400/#403 (AC 3.27.4): sync cannot overwrite or orphan an owner's uploaded attachment, even for a repo-managed public item.
        await EnsureGeographyPublicWithNavAsync("seeder");
        Category category = await DbContext.Categories.FirstAsync(c => c.Name == "geography");
        MediaAsset asset = PictureSeed.AddAsset(DbContext, "owner");
        Item uploaded = PictureSeed.AddPictureItem(DbContext, category, "owner", false, ItemImageReviewState.Approved, asset);
        uploaded.IsRepoManaged = true;
        string originalQuestion = uploaded.Question;
        await DbContext.SaveChangesAsync();

        SeedSyncAdmin.Request request = BuildRequest(
            [BuildItem(uploaded.Id, "What is the capital of France?", "Paris", ["Lyon", "Marseille", "Nice"])]);

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(request, CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error!.Code.Should().Be("Admin.ItemSyncIdConflict");
        DbContext.ChangeTracker.Clear();
        Item after = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == uploaded.Id);
        after.QuestionImageAssetId.Should().Be(asset.Id);
        after.ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        after.Question.Should().Be(originalQuestion);
    }

    // --- #273: ValidateManifest must not throw on null lists ---

    private static SeedSyncAdmin.ManifestRequest Manifest(
        List<SeedSyncAdmin.SeedItemRequest>? items,
        List<SeedSyncAdmin.SeedCollectionRequest>? collections) =>
        new("seed", items!, collections!);

    private static List<string> ManifestErrors(SeedSyncAdmin.ManifestRequest manifest)
    {
        FluentValidation.Results.ValidationResult result = null!;
        Action act = () => result = SeedSyncAdmin.ValidateManifest(manifest);
        act.Should().NotThrow();
        result.IsValid.Should().BeFalse();
        return result.Errors.Select(e => e.ErrorMessage).ToList();
    }

    private static SeedSyncAdmin.SeedItemRequest ValidItem() =>
        BuildItem(Guid.NewGuid(), "What is the capital of France?", "Paris", ["Lyon"]);

    private static SeedSyncAdmin.SeedCollectionRequest ValidCollection() =>
        new(Guid.NewGuid(), "Collection", null, [Guid.NewGuid()]);

    [Fact]
    public void ValidateManifest_NullItems_ReturnsOnlyItemsRequired()
    {
        ManifestErrors(Manifest(null, [ValidCollection()])).Should().Equal("Items is required.");
    }

    [Fact]
    public void ValidateManifest_NullCollections_ReturnsOnlyCollectionsRequired()
    {
        ManifestErrors(Manifest([ValidItem()], null)).Should().Equal("Collections is required.");
    }

    [Fact]
    public void ValidateManifest_BothNull_ReturnsBothRequiredMessages()
    {
        ManifestErrors(Manifest(null, null)).Should().BeEquivalentTo("Items is required.", "Collections is required.");
    }

    [Fact]
    public void ValidateManifest_CollectionItemIdsNull_ReturnsOnlyItemIdsRequired()
    {
        SeedSyncAdmin.SeedCollectionRequest collection = new(Guid.NewGuid(), "Collection", null, null!);

        ManifestErrors(Manifest([ValidItem()], [collection])).Should().Equal("Collection itemIds are required.");
    }

    [Fact]
    public void ValidateManifest_CollectionJsonWithoutItemIds_ReturnsItemIdsRequired()
    {
        SeedSyncAdmin.SeedCollectionRequest? collection = System.Text.Json.JsonSerializer.Deserialize<SeedSyncAdmin.SeedCollectionRequest>(
            "{\"collectionId\":\"11111111-1111-1111-1111-111111111111\",\"name\":\"Collection\"}",
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        ManifestErrors(Manifest([ValidItem()], [collection!])).Should().Equal("Collection itemIds are required.");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ValidateManifest_NullIncorrectAnswers_ReturnsIncorrectAnswersRequired(bool withSpeech)
    {
        SeedSyncAdmin.SeedItemRequest item = ValidItem() with
        {
            IncorrectAnswers = null!,
            IncorrectAnswerSpeech = withSpeech
                ? new Dictionary<int, ItemSpeechSupport> { [0] = new ItemSpeechSupport { Pronunciation = "x" } }
                : null
        };

        ManifestErrors(Manifest([item], [ValidCollection()])).Should().Contain("IncorrectAnswers is required.");
    }

    // --- #281: null list elements are rejected with a clear message, not a NullReferenceException ---

    [Fact]
    public void ValidateManifest_NullItemEntry_ReturnsOnlyNullEntriesMessage()
    {
        ManifestErrors(Manifest([null!], [ValidCollection()])).Should().Equal("Items must not contain null entries.");
    }

    [Fact]
    public void ValidateManifest_ValidAndNullItemEntry_ReturnsSingleMessage()
    {
        ManifestErrors(Manifest([ValidItem(), null!], [ValidCollection()])).Should().Equal("Items must not contain null entries.");
    }

    [Fact]
    public void ValidateManifest_TwoNullItemEntries_ReturnsSingleMessage()
    {
        ManifestErrors(Manifest([null!, null!], [ValidCollection()])).Should().Equal("Items must not contain null entries.");
    }

    [Fact]
    public void ValidateManifest_NullCollectionEntry_ReturnsOnlyNullEntriesMessage()
    {
        ManifestErrors(Manifest([ValidItem()], [null!])).Should().Equal("Collections must not contain null entries.");
    }

    [Fact]
    public async Task PreviewManifestAsync_NullItemEntry_ReturnsManifestInvalid()
    {
        SeedSyncAdmin.ManifestRequest manifest = Manifest([null!], [ValidCollection()]);
        SeedSyncAdmin.SourceContext context = new("quizymode", "quizymode", "main", "abc", "items", 1, "collections", 1);

        Result<SeedSyncAdmin.PreviewResponse> result = await _service.PreviewManifestAsync(manifest, context, CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error!.Code.Should().Be("Admin.SeedSyncManifestInvalid");
        result.Error.Description.Should().Be("Items must not contain null entries.");
    }

    // --- #326: retired Languages paths are rejected at ingest (no startup normalization any more) ---

    [Theory]
    [InlineData("esl", "beginner")]
    [InlineData("other-langs", "spanish")]
    public async Task ApplyManifestAsync_RetiredLanguagesPath_IsRejectedAndSavesNothing(string nav1, string nav2)
    {
        DbContext.Categories.Add(new Category
        {
            Id = Guid.NewGuid(),
            Name = "languages",
            IsPrivate = false,
            CreatedBy = "seeder",
            CreatedAt = DateTime.UtcNow
        });
        await DbContext.SaveChangesAsync();

        Guid itemId = Guid.NewGuid();
        SeedSyncAdmin.SeedItemRequest legacyItem = new(
            ItemId: itemId,
            Category: "languages",
            NavigationKeyword1: nav1,
            NavigationKeyword2: nav2,
            Question: "How do you say hello?",
            CorrectAnswer: "Hola",
            IncorrectAnswers: ["Adios"],
            Explanation: null,
            Keywords: null,
            Source: "seed-test",
            QuestionSpeech: null,
            CorrectAnswerSpeech: null,
            IncorrectAnswerSpeech: null);
        SeedSyncAdmin.ManifestRequest manifest = new("seed", [legacyItem], [], DeltaPreviewLimit: 50);
        SeedSyncAdmin.SourceContext context = new("quizymode", "quizymode", "main", "abc", "items", 1, "collections", 0);

        Result<SeedSyncAdmin.ApplyResponse> applyResult = await _service.ApplyManifestAsync(
            manifest, context, CancellationToken.None, recordHistory: true);
        Result<SeedSyncAdmin.PreviewResponse> previewResult = await _service.PreviewManifestAsync(
            manifest, context, CancellationToken.None);

        applyResult.IsFailure.Should().BeTrue();
        applyResult.Error!.Code.Should().Be("Item.InvalidNavigationPath");
        previewResult.IsFailure.Should().BeTrue();
        previewResult.Error!.Code.Should().Be("Item.InvalidNavigationPath");
        (await DbContext.Items.AnyAsync(i => i.Id == itemId)).Should().BeFalse();
        (await DbContext.SeedSyncRuns.AnyAsync()).Should().BeFalse();
    }

    // --- #407 curated question pictures ---

    private static readonly Guid PictureItemId = Guid.Parse("88888888-8888-8888-8888-888888888801");

    private SeedSyncAdmin.Request PictureRequest(ItemImageReference? image) =>
        BuildRequest([BuildItem(PictureItemId, "Which country uses this flag?", "France", ["Italy", "Ireland"], questionImage: image)]);

    [Fact]
    public async Task ApplyAsync_CreatesItemWithQuestionImage()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(
            PictureRequest(new ItemImageReference("curated:flags/fr", "Three vertical bands: blue, white, red")), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        Item item = await DbContext.Items.SingleAsync(i => i.Id == PictureItemId);
        item.QuestionImageKey.Should().Be("curated:flags/fr");
        item.QuestionImageAlt.Should().Be("Three vertical bands: blue, white, red");
    }

    [Fact]
    public async Task ApplyAsync_UpdatesAndClearsQuestionImage_ReportingQuestionImageAsChangedField()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        ItemImageReference first = new("curated:flags/fr", "Vertical bands");
        (await _service.ApplyAsync(PictureRequest(first), CancellationToken.None)).IsSuccess.Should().BeTrue();

        ItemImageReference second = new("curated:flags/it", "Green, white, red");
        Result<SeedSyncAdmin.PreviewResponse> preview = await _service.PreviewAsync(PictureRequest(second), CancellationToken.None);
        preview.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Contain("questionImage");
        (await _service.ApplyAsync(PictureRequest(second), CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == PictureItemId)).QuestionImageKey.Should().Be("curated:flags/it");

        Result<SeedSyncAdmin.PreviewResponse> altOnly = await _service.PreviewAsync(
            PictureRequest(new ItemImageReference("curated:flags/it", "Other description")), CancellationToken.None);
        altOnly.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Contain("questionImage");

        (await _service.ApplyAsync(PictureRequest(null), CancellationToken.None)).IsSuccess.Should().BeTrue();
        Item cleared = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == PictureItemId);
        cleared.QuestionImageKey.Should().BeNull();
        cleared.QuestionImageAlt.Should().BeNull();
    }

    [Fact]
    public async Task PreviewAsync_UnchangedQuestionImage_IsReportedAsUnchanged()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        ItemImageReference image = new("curated:flags/fr", "Vertical bands");
        (await _service.ApplyAsync(PictureRequest(image), CancellationToken.None)).IsSuccess.Should().BeTrue();

        Result<SeedSyncAdmin.PreviewResponse> preview = await _service.PreviewAsync(PictureRequest(image), CancellationToken.None);

        preview.Value!.UnchangedCount.Should().Be(1);
        preview.Value.UpdatedCount.Should().Be(0);
    }

    [Theory]
    [InlineData("__proto__", "alt")]
    [InlineData("constructor", "alt")]
    [InlineData("https://evil/x.webp", "alt")]
    [InlineData("curated:../x", "alt")]
    [InlineData("curated:flags/FR", "alt")]
    [InlineData("curated:fr", "alt")]
    [InlineData("curated:flags/fr", "")]
    [InlineData("curated:flags/fr", "line one\nline two")]
    [InlineData("curated:flags/fr", "tab\there")]
    public async Task ApplyAsync_InvalidQuestionImage_IsRejected(string key, string altText)
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(
            PictureRequest(new ItemImageReference(key, altText)), CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        (await DbContext.Items.AnyAsync(i => i.Id == PictureItemId)).Should().BeFalse();
    }

    [Fact]
    public async Task ApplyAsync_QuestionImageOverLengthLimits_IsRejected()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        string longKey = "curated:flags/" + new string('a', 90);

        (await _service.ApplyAsync(PictureRequest(new ItemImageReference(longKey, "alt")), CancellationToken.None))
            .IsFailure.Should().BeTrue();
        (await _service.ApplyAsync(PictureRequest(new ItemImageReference("curated:flags/fr", new string('a', 301))), CancellationToken.None))
            .IsFailure.Should().BeTrue();
    }

    // --- #462 starter quiz fields ---

    private SeedSyncAdmin.Request StarterRequest(string? world, string? wowLine) =>
        BuildRequest([BuildItem(PictureItemId, "Which planet is third from the Sun?", "Earth", ["Venus", "Mars"], starterWorld: world, wowLine: wowLine)]);

    [Fact]
    public async Task ApplyAsync_CreatesItemWithStarterFields_TrimmedAndRoundTripped()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(
            StarterRequest(" space ", "  Earth is the only planet known to have life.  "), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        Item item = await DbContext.Items.SingleAsync(i => i.Id == PictureItemId);
        item.StarterWorld.Should().Be("space");
        item.WowLine.Should().Be("Earth is the only planet known to have life.");
    }

    [Fact]
    public async Task PreviewAsync_StarterFieldChanges_AreDetectedAndClearable()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        (await _service.ApplyAsync(StarterRequest("space", "First line."), CancellationToken.None)).IsSuccess.Should().BeTrue();

        (await _service.PreviewAsync(StarterRequest("space", "First line."), CancellationToken.None))
            .Value!.UnchangedCount.Should().Be(1);

        Result<SeedSyncAdmin.PreviewResponse> lineOnly = await _service.PreviewAsync(StarterRequest("space", "Second line."), CancellationToken.None);
        lineOnly.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Equal("wowLine");

        Result<SeedSyncAdmin.PreviewResponse> both = await _service.PreviewAsync(StarterRequest("animals", "Second line."), CancellationToken.None);
        both.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Equal("starterWorld", "wowLine");

        Result<SeedSyncAdmin.PreviewResponse> removed = await _service.PreviewAsync(StarterRequest(null, null), CancellationToken.None);
        removed.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Equal("starterWorld", "wowLine");

        (await _service.ApplyAsync(StarterRequest("animals", "Second line."), CancellationToken.None)).IsSuccess.Should().BeTrue();
        (await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == PictureItemId)).StarterWorld.Should().Be("animals");

        (await _service.ApplyAsync(StarterRequest(null, null), CancellationToken.None)).IsSuccess.Should().BeTrue();
        Item cleared = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == PictureItemId);
        cleared.StarterWorld.Should().BeNull();
        cleared.WowLine.Should().BeNull();
    }

    [Theory]
    [InlineData("music", "A valid line.")]
    [InlineData("Space", "A valid line.")]
    [InlineData("space", null)]
    [InlineData("space", "   ")]
    [InlineData(null, "A line without a world.")]
    [InlineData("   ", "A line without a world.")]
    public async Task ApplyAsync_InvalidStarterFields_AreRejected(string? world, string? wowLine)
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(StarterRequest(world, wowLine), CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        (await DbContext.Items.AnyAsync(i => i.Id == PictureItemId)).Should().BeFalse();
    }

    [Fact]
    public async Task ApplyAsync_WowLineOver140Characters_IsRejected_And140IsAccepted()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        (await _service.ApplyAsync(StarterRequest("space", new string('a', 141)), CancellationToken.None)).IsFailure.Should().BeTrue();
        (await _service.ApplyAsync(StarterRequest("space", new string('a', 140)), CancellationToken.None)).IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task ApplyAsync_WowLineWithLineBreak_IsRejected()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        (await _service.ApplyAsync(StarterRequest("space", "First line\nsecond line"), CancellationToken.None)).IsFailure.Should().BeTrue();
    }

    // --- #403 curated explanation pictures ---

    private static readonly ItemImageReference Diagram = new("curated:diagrams/pythagorean-theorem", "Right triangle with legs a, b and hypotenuse c");

    private SeedSyncAdmin.Request DiagramRequest(ItemImageReference? image, string? explanation = "a squared plus b squared equals c squared") =>
        BuildRequest([BuildItem(PictureItemId, "State the Pythagorean theorem?", "a2+b2=c2", ["a+b=c", "a2-b2=c2"], explanation, explanationImage: image)]);

    [Fact]
    public async Task ApplyAsync_CreatesItemWithExplanationImage_AndAllowsAltNamingTheAnswer()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        ItemImageReference namesAnswer = new(Diagram.Key, "Triangle labelled a2 + b2 = c2");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(DiagramRequest(namesAnswer), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        Item item = await DbContext.Items.SingleAsync(i => i.Id == PictureItemId);
        item.ExplanationImageKey.Should().Be(Diagram.Key);
        item.ExplanationImageAlt.Should().Be(namesAnswer.AltText);
        item.QuestionImageKey.Should().BeNull();
    }

    [Fact]
    public async Task ApplyAsync_ManifestWithoutExplanationImage_ClearsItAndRerunReportsNoChange()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        (await _service.ApplyAsync(DiagramRequest(Diagram), CancellationToken.None)).IsSuccess.Should().BeTrue();

        Result<SeedSyncAdmin.PreviewResponse> preview = await _service.PreviewAsync(DiagramRequest(null), CancellationToken.None);
        preview.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Equal("explanationImage");

        (await _service.ApplyAsync(DiagramRequest(null), CancellationToken.None)).IsSuccess.Should().BeTrue();
        Item cleared = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == PictureItemId);
        cleared.ExplanationImageKey.Should().BeNull();
        cleared.ExplanationImageAlt.Should().BeNull();

        Result<SeedSyncAdmin.PreviewResponse> rerun = await _service.PreviewAsync(DiagramRequest(null), CancellationToken.None);
        rerun.Value!.UnchangedCount.Should().Be(1);
        rerun.Value.UpdatedCount.Should().Be(0);
    }

    [Fact]
    public async Task PreviewAsync_AltOnlyChange_ReportsExplanationImage_AndSameImageIsUnchanged()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        (await _service.ApplyAsync(DiagramRequest(Diagram), CancellationToken.None)).IsSuccess.Should().BeTrue();

        Result<SeedSyncAdmin.PreviewResponse> same = await _service.PreviewAsync(DiagramRequest(Diagram), CancellationToken.None);
        same.Value!.UnchangedCount.Should().Be(1);

        Result<SeedSyncAdmin.PreviewResponse> alt = await _service.PreviewAsync(
            DiagramRequest(new ItemImageReference(Diagram.Key, "Other description")), CancellationToken.None);
        alt.Value!.Changes.Should().ContainSingle().Which.ChangedFields.Should().Contain("explanationImage");
    }

    [Theory]
    [InlineData("__proto__", "alt", "text")]
    [InlineData("https://evil/x.webp", "alt", "text")]
    [InlineData("curated:diagrams/X", "alt", "text")]
    [InlineData("curated:diagrams/x", "", "text")]
    [InlineData("curated:diagrams/x", "line one\nline two", "text")]
    public async Task ApplyAsync_InvalidExplanationImage_IsRejectedAndNothingApplied(string key, string altText, string explanation)
    {
        await EnsureGeographyPublicWithNavAsync("seeder");

        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(
            DiagramRequest(new ItemImageReference(key, altText), explanation), CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        (await DbContext.Items.AnyAsync(i => i.Id == PictureItemId)).Should().BeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ApplyAsync_ExplanationPictureWithoutProse_PreservesPictureAndIdentity(string explanation)
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        Result<SeedSyncAdmin.ApplyResponse> result = await _service.ApplyAsync(DiagramRequest(Diagram, explanation), CancellationToken.None);
        result.IsSuccess.Should().BeTrue();
        Item item = await DbContext.Items.AsNoTracking().SingleAsync(i => i.Id == PictureItemId);
        item.Id.Should().Be(PictureItemId);
        item.ExplanationImageKey.Should().Be(Diagram.Key);
        item.ExplanationImageAlt.Should().Be(Diagram.AltText);
        item.Explanation.Should().Be(explanation.Trim());
    }

    private SeedSyncAdmin.Request BuildRequest(
        List<SeedSyncAdmin.SeedItemRequest> items,
        List<SeedSyncAdmin.SeedCollectionRequest>? collections = null)
    {
        _gitHubSeedSource.LoadedManifest = new LoadedGitHubSeedManifest(
            new SeedSyncAdmin.ManifestRequest(
                SeedSet: "data/seed-source/items/geography",
                Items: items,
                Collections: collections ?? [],
                DeltaPreviewLimit: 50),
            new SeedSyncAdmin.SourceContext(
                RepositoryOwner: "quizymode",
                RepositoryName: "quizymode",
                GitRef: "main",
                ResolvedCommitSha: "abc123def456",
                ItemsPath: "data/seed-source/items/geography",
                SourceFileCount: 1,
                CollectionsPath: "data/seed-source/collections/public",
                CollectionSourceFileCount: collections?.Count ?? 0),
            BranchTaxonomyYaml: null,
            BranchTaxonomySql: null);

        return new SeedSyncAdmin.Request(
            SchemaVersion: 2,
            RepositoryOwner: "quizymode",
            RepositoryName: "quizymode",
            GitRef: "main",
            DeltaPreviewLimit: 50);
    }

    private static SeedSyncAdmin.SeedItemRequest BuildItem(
        Guid itemId,
        string question,
        string correctAnswer,
        List<string> incorrectAnswers,
        string? explanation = null,
        List<string>? keywords = null,
        string? source = null,
        ItemSpeechSupport? questionSpeech = null,
        ItemSpeechSupport? correctAnswerSpeech = null,
        Dictionary<int, ItemSpeechSupport>? incorrectAnswerSpeech = null,
        ItemImageReference? questionImage = null,
        ItemImageReference? explanationImage = null,
        string? starterWorld = null,
        string? wowLine = null)
    {
        return new SeedSyncAdmin.SeedItemRequest(
            ItemId: itemId,
            Category: "geography",
            NavigationKeyword1: "capitals",
            NavigationKeyword2: "europe",
            Question: question,
            CorrectAnswer: correctAnswer,
            IncorrectAnswers: incorrectAnswers,
            Explanation: explanation,
            Keywords: keywords,
            Source: source ?? "seed-test",
            QuestionSpeech: questionSpeech,
            CorrectAnswerSpeech: correctAnswerSpeech,
            IncorrectAnswerSpeech: incorrectAnswerSpeech,
            QuestionImage: questionImage,
            ExplanationImage: explanationImage,
            StarterWorld: starterWorld,
            WowLine: wowLine);
    }

    private sealed class FakeGitHubSeedSource : IGitHubSeedSource
    {
        public LoadedGitHubSeedManifest? LoadedManifest { get; set; }

        public Task<Result<LoadedGitHubSeedManifest>> LoadManifestAsync(
            SeedSyncAdmin.Request request,
            CancellationToken cancellationToken)
        {
            LoadedManifest.Should().NotBeNull();
            return Task.FromResult(Result.Success(LoadedManifest!));
        }
    }
}
