using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Features.Items.Add;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Features.Items.Update;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

public sealed class ItemDuplicateConsistencyTests : ItemTestFixture
{
    private readonly string _owner = Guid.NewGuid().ToString();
    private readonly Mock<IAuditService> _audit = new();

    private Task<Item> Seed(string question, string? owner = null) => CreateItemWithCategoryAsync(
        "geography", question, "Paris", ["Lyon"], "Explanation", false, owner ?? _owner);

    private static UpdateItem.Request Edit(string question) => new(
        "geography", "capitals", "europe", question, "Paris", ["Lyon"], "Changed explanation", true,
        Keywords: [new("new-keyword", true)]);

    private Task<Result<UpdateItem.Response>> Update(Item item, UpdateItem.Request request, string? editor = null) =>
        UpdateItem.HandleAsync(item.Id.ToString(), request, DbContext, SimHashService,
            CreateUserContextMock(editor ?? _owner).Object, _audit.Object, TaxonomyItemCategoryResolver,
            TaxonomyRegistry, CancellationToken.None);

    private Task<Result<AddItem.Response>> Add(string question, string? owner = null) => AddItemHandler.HandleAsync(
        new("geography", "capitals", "europe", true, question, "Different answer", ["Other answer"], "Different explanation"),
        DbContext, SimHashService, CreateUserContextMock(owner ?? _owner).Object, _audit.Object,
        TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);

    private Task<Result<AddItemsBulk.Response>> Bulk(string question, string? owner = null) => AddItemsBulkHandler.HandleAsync(
        new(true, "geography", "capitals", "europe", [], [new(question, "Another answer", ["Wrong answer"], "Bulk explanation")]),
        DbContext, SimHashService, CreateUserContextMock(owner ?? _owner).Object, TaxonomyItemCategoryResolver,
        TaxonomyRegistry, _audit.Object, NullLogger.Instance, CancellationToken.None);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DuplicateEdit_RejectsBeforeAnyMutation_EvenForAdminAndLegacyBucket(bool admin)
    {
        Item peer = await Seed("What is the capital of France?");
        peer.FuzzySignature = "legacy-answer-signature";
        peer.FuzzyBucket = -1;
        Item edited = await Seed("Original question?");
        edited.QuestionImageKey.Should().BeNull();
        Guid keywordId = edited.NavigationKeywordId1!.Value;
        DbContext.ItemKeywords.Add(new ItemKeyword { Id = Guid.NewGuid(), ItemId = edited.Id, KeywordId = keywordId });
        await DbContext.SaveChangesAsync();
        string signature = edited.FuzzySignature;
        int bucket = edited.FuzzyBucket;
        int keywordCount = await DbContext.Keywords.CountAsync();
        int reviewCount = await DbContext.ItemImageReviews.CountAsync();

        Mock<IUserContext> editor = CreateUserContextMock(admin ? "editing-admin" : _owner);
        editor.Setup(x => x.IsAdmin).Returns(admin);
        Result<UpdateItem.Response> result = await UpdateItem.HandleAsync(
            edited.Id.ToString(), Edit("  WHAT IS THE CAPITAL OF FRANCE?  "), DbContext, SimHashService,
            editor.Object, _audit.Object, TaxonomyItemCategoryResolver, TaxonomyRegistry, CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Should().Be(ItemDuplicateRules.Duplicate("geography"));
        edited.Question.Should().Be("Original question?");
        edited.Explanation.Should().Be("Explanation");
        edited.FuzzySignature.Should().Be(signature);
        edited.FuzzyBucket.Should().Be(bucket);
        edited.ImageRevision.Should().Be(0);
        edited.UpdatedAt.Should().BeNull();
        (await DbContext.ItemKeywords.CountAsync(x => x.ItemId == edited.Id)).Should().Be(1);
        (await DbContext.Keywords.CountAsync()).Should().Be(keywordCount);
        (await DbContext.ItemImageReviews.CountAsync()).Should().Be(reviewCount);
        _audit.Invocations.Should().BeEmpty();
        DbContext.ChangeTracker.HasChanges().Should().BeFalse();
    }

    [Fact]
    public async Task AddBulkAndEdit_UseSameQuestionOnlySignatureAndBucket_SelfExcluded()
    {
        await EnsureGeographyPublicWithNavAsync(_owner);
        string question = "  WHAT is the capital of France?  ";
        Result<AddItem.Response> added = await Add(question);
        Result<AddItemsBulk.Response> bulk = await Bulk(question.ToLowerInvariant(), "bulk-owner");
        Item edited = await Seed("Something entirely different?", "edit-owner");
        Result<UpdateItem.Response> updated = await Update(edited, Edit(question.Trim()), "edit-owner");
        added.IsSuccess.Should().BeTrue();
        bulk.IsSuccess.Should().BeTrue();
        bulk.Value.CreatedCount.Should().Be(1);
        updated.IsSuccess.Should().BeTrue();
        List<Item> items = await DbContext.Items.ToListAsync();
        items.Select(x => x.FuzzySignature).Distinct().Should().ContainSingle();
        items.Select(x => x.FuzzyBucket).Distinct().Should().ContainSingle();
        string signature = edited.FuzzySignature;
        int bucket = edited.FuzzyBucket;
        (await Update(edited, Edit(question) with { CorrectAnswer = "Changed", IncorrectAnswers = ["Different"] }, "edit-owner")).IsSuccess.Should().BeTrue();
        edited.FuzzySignature.Should().Be(signature);
        edited.FuzzyBucket.Should().Be(bucket);
    }

    [Theory]
    [InlineData("add", " ")]
    [InlineData("bulk", " ")]
    [InlineData("put", " ")]
    [InlineData("add", "\u00a0")]
    [InlineData("bulk", "\u00a0")]
    [InlineData("put", "\u00a0")]
    [InlineData("add", "\t\n")]
    [InlineData("bulk", "\t\n")]
    [InlineData("put", "\t\n")]
    public async Task Writes_RejectLegacyExactQuestionOutsideBucket_WithBoundaryWhitespace(string path, string whitespace)
    {
        Item peer = await Seed(whitespace + "What is the capital of France?" + whitespace);
        peer.FuzzySignature = "legacy-answer-signature";
        peer.FuzzyBucket = -1;
        await DbContext.SaveChangesAsync();
        const string question = "WHAT IS THE CAPITAL OF FRANCE?";
        int expectedItemCount = 1;
        if (path == "add")
        {
            Result<AddItem.Response> result = await Add(question);
            result.Error.Should().Be(ItemDuplicateRules.Duplicate("geography"));
        }
        else if (path == "bulk")
        {
            Result<AddItemsBulk.Response> result = await Bulk(question);
            result.IsSuccess.Should().BeTrue();
            result.Value.DuplicateCount.Should().Be(1);
            result.Value.CreatedCount.Should().Be(0);
        }
        else
        {
            Item edited = await Seed("Original question?");
            expectedItemCount = 2;
            Result<UpdateItem.Response> result = await Update(edited, Edit(question));
            result.Error.Should().Be(ItemDuplicateRules.Duplicate("geography"));
            edited.Question.Should().Be("Original question?");
        }
        (await DbContext.Items.CountAsync()).Should().Be(expectedItemCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Edit_AllowsPeersOfDifferentCreatorOrCategory(bool differentCategory)
    {
        Item peer = await Seed("What is the capital of France?", differentCategory ? _owner : "other-creator");
        if (differentCategory)
        {
            Category category = new() { Id = Guid.NewGuid(), Name = "other-category", CreatedBy = _owner };
            DbContext.Categories.Add(category);
            peer.CategoryId = category.Id;
            await DbContext.SaveChangesAsync();
        }
        Item edited = await Seed("Original question?");
        (await Update(edited, Edit(peer.Question))).IsSuccess.Should().BeTrue();
    }

    [Theory]
    [InlineData("same-curated", true)]
    [InlineData("different-curated", false)]
    [InlineData("text-only", false)]
    [InlineData("same-upload-kept", true)]
    [InlineData("same-upload-replaced", true)]
    [InlineData("different-upload", false)]
    [InlineData("remove-upload", true)]
    public async Task Edit_UsesEffectiveQuestionPictureIdentity(string scenario, bool duplicate)
    {
        Item peer = await Seed("What is the capital of France?");
        Item edited = await Seed("Original question?");
        UpdateItem.Request request = Edit(peer.Question);
        if (scenario.Contains("curated") || scenario == "text-only")
        {
            peer.QuestionImageKey = "curated:flags/fr";
            if (scenario != "text-only") edited.QuestionImageKey = scenario == "same-curated" ? peer.QuestionImageKey : "curated:flags/it";
        }
        else
        {
            MediaAsset first = Asset("same-bytes");
            MediaAsset second = Asset(scenario == "different-upload" ? "different-bytes" : "same-bytes");
            DbContext.MediaAssets.AddRange(first, second);
            if (scenario != "remove-upload")
            {
                peer.QuestionImageAssetId = first.Id;
                peer.QuestionImageKey = ItemImageReviewRules.KeyOf(first.Id);
            }
            edited.QuestionImageAssetId = second.Id;
            edited.QuestionImageKey = ItemImageReviewRules.KeyOf(second.Id);
            if (scenario == "same-upload-replaced") request = request with { QuestionImage = new(first.Id, "Picture") };
            if (scenario == "remove-upload") request = request with { QuestionImage = new(Remove: true) };
        }
        await DbContext.SaveChangesAsync();
        Guid? oldAsset = edited.QuestionImageAssetId;
        string? oldKey = edited.QuestionImageKey;
        Result<UpdateItem.Response> result = await Update(edited, request);
        result.IsFailure.Should().Be(duplicate, result.Error?.Description);
        if (duplicate)
        {
            result.Error!.Code.Should().Be("Item.Duplicate");
            edited.Question.Should().Be("Original question?");
            edited.QuestionImageAssetId.Should().Be(oldAsset);
            edited.QuestionImageKey.Should().Be(oldKey);
            edited.ImageRevision.Should().Be(0);
            (await DbContext.ItemImageReviews.CountAsync()).Should().Be(0);
        }
    }

    private MediaAsset Asset(string sha) => new() { Id = Guid.NewGuid(), OwnerUserId = _owner, State = MediaAssetState.Ready, Sha256 = sha };

    [Fact]
    public async Task Bulk_ExistingUploadedQuestion_IsNotTextOnly()
    {
        Item pictured = await Seed("What is the capital of France?");
        // Even a historical asset-bearing row without its media key remains pictured.
        MediaAsset asset = Asset("picture-bytes");
        DbContext.MediaAssets.Add(asset);
        pictured.QuestionImageAssetId = asset.Id;
        await DbContext.SaveChangesAsync();
        Result<AddItemsBulk.Response> result = await Bulk(pictured.Question);
        result.IsSuccess.Should().BeTrue();
        result.Value.CreatedCount.Should().Be(1);
        result.Value.DuplicateCount.Should().Be(0);
    }

    [Fact]
    public async Task ExplanationPicture_DoesNotDistinguishDuplicateQuestions()
    {
        Item peer = await Seed("What is the capital of France?");
        peer.ExplanationImageKey = "curated:diagram/fr";
        Item edited = await Seed("Original question?");
        edited.ExplanationImageKey = "curated:diagram/other";
        await DbContext.SaveChangesAsync();
        Result<UpdateItem.Response> result = await Update(edited, Edit(peer.Question));
        result.Error!.Code.Should().Be("Item.Duplicate");
    }

    [Fact]
    public async Task UnauthorizedEdit_PreservesAccessErrorBeforeDuplicateCheck()
    {
        Item peer = await Seed("What is the capital of France?");
        Item edited = await Seed("Original question?");
        Mock<IUserContext> outsider = CreateUserContextMock("outsider");
        outsider.Setup(x => x.IsAdmin).Returns(false);
        Result<UpdateItem.Response> result = await UpdateItem.HandleAsync(edited.Id.ToString(), Edit(peer.Question),
            DbContext, SimHashService, outsider.Object, _audit.Object, TaxonomyItemCategoryResolver,
            TaxonomyRegistry, CancellationToken.None);
        result.Error!.Code.Should().Be(ItemWriteAccess.ForbiddenCode);
        edited.Question.Should().Be("Original question?");
        _audit.Invocations.Should().BeEmpty();
    }

    [Fact]
    public async Task DuplicatePut_Returns400ProblemDetails()
    {
        // Admin editing another creator must compare against that creator's peers.
        Item peer = await Seed("What is the capital of France?");
        Item edited = await Seed("Original question?");
        await using JwtHttpTestHost host = await JwtHttpTestHost.StartAsync(CreateDbContext, services =>
        {
            services.AddScoped<IValidator<UpdateItem.Request>, UpdateItem.Validator>();
            services.AddSingleton(SimHashService);
            services.AddSingleton(TaxonomyItemCategoryResolver);
            services.AddSingleton(TaxonomyRegistry);
            services.AddSingleton(_audit.Object);
        }, app => new UpdateItem.Endpoint().MapEndpoint(app));
        using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Put, "/items/" + edited.Id,
            host.CreateToken("editing-admin", "admin-test@example.com", ["Admins"]), JsonContent.Create(Edit(peer.Question)));
        using HttpResponseMessage response = await host.Client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using JsonDocument body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("title").GetString().Should().Be("Item.Duplicate");
        body.RootElement.GetProperty("detail").GetString().Should().Be(ItemDuplicateRules.Duplicate("geography").Description);
    }
}
