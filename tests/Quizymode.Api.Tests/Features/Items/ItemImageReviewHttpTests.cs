using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Features.Items.Add;
using Quizymode.Api.Features.Items.Export;
using Quizymode.Api.Features.Items.Get;
using Quizymode.Api.Features.Items.GetById;
using Quizymode.Api.Features.Items.ImageReview;
using Quizymode.Api.Features.Items.ReviewBoard;
using Quizymode.Api.Features.Items.SetVisibility;
using Quizymode.Api.Features.Items.Update;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.Features.Media;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

/// <summary>
/// #400 (AC 3.25): the item picture contract over real HTTP with the production JWT pipeline: write validation, the review state
/// machine, the admin decision, publish guards, duplicates and the item-bound delivery routes with their authorization matrix.
/// </summary>
public sealed class ItemImageReviewHttpTests : ItemTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];

    private readonly FakeMediaObjectStore _store = new();
    private JwtHttpTestHost _host = null!;
    private Guid _ownerId;
    private Guid _otherId;
    private Guid _adminId;
    private Category _category = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddScoped<IValidator<AddItem.Request>, AddItem.Validator>();
                services.AddScoped<IValidator<UpdateItem.Request>, UpdateItem.Validator>();
                services.AddScoped<IValidator<SetItemImageReview.Request>, SetItemImageReview.Validator>();
                services.AddScoped<IValidator<BulkSetItemImageReview.Request>, BulkSetItemImageReview.Validator>();
                services.AddSingleton<ISimHashService>(SimHashService);
                services.AddSingleton(TaxonomyRegistry);
                services.AddScoped<ITaxonomyItemCategoryResolver>(sp =>
                    new TaxonomyItemCategoryResolver(sp.GetRequiredService<ApplicationDbContext>(), TaxonomyRegistry));
                services.AddSingleton<IMediaObjectStore>(_store);
            },
            app =>
            {
                new AddItem.Endpoint().MapEndpoint(app);
                new UpdateItem.Endpoint().MapEndpoint(app);
                new GetItemById.Endpoint().MapEndpoint(app);
                new GetItems.Endpoint().MapEndpoint(app);
                new ExportItems.Endpoint().MapEndpoint(app);
                new GetCollectionById.Endpoint().MapEndpoint(app);
                new SetItemImageReview.Endpoint().MapEndpoint(app);
                new BulkSetItemImageReview.Endpoint().MapEndpoint(app);
                new ApproveItem.Endpoint().MapEndpoint(app);
                new SetItemVisibility.Endpoint().MapEndpoint(app);
                new GetItemImageContent.Endpoint().MapEndpoint(app);
                new GetImageContent.Endpoint().MapEndpoint(app);
                new MediaLifecycleEndpoints.Endpoint().MapEndpoint(app);
            });

        _ownerId = Guid.NewGuid();
        _otherId = Guid.NewGuid();
        _adminId = Guid.NewGuid();
        DbContext.Users.AddRange(
            new User { Id = _ownerId, Subject = "owner-sub", Email = "owner@example.com", Name = "owner" },
            new User { Id = _otherId, Subject = "other-sub", Email = "other@example.com", Name = "other" },
            new User { Id = _adminId, Subject = "admin-sub", Email = "admin@example.com", Name = "admin" });
        await DbContext.SaveChangesAsync();
        await EnsureGeographyPublicWithNavAsync(_ownerId.ToString());
        _category = await DbContext.Categories.FirstAsync(c => c.Name == "geography");
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private string Owner => _ownerId.ToString();

    private string OwnerToken => _host.CreateToken("owner-sub", "owner@example.com");

    private string OtherToken => _host.CreateToken("other-sub", "other@example.com");

    private string AdminToken => _host.CreateToken("admin-sub", "admin@example.com", AdminGroups);

    private string? TokenOf(string caller) => caller switch
    {
        "owner" => OwnerToken,
        "other" => OtherToken,
        "admin" => AdminToken,
        _ => null
    };

    // ---- helpers -----------------------------------------------------------------------------------------------------

    private async Task<HttpResponseMessage> SendRawAsync(HttpMethod method, string path, string? json = null, string? token = null)
    {
        using StringContent? content = json is null ? null : new StringContent(json, Encoding.UTF8, "application/json");
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, content);
        return await _host.Client.SendAsync(request);
    }

    private async Task<(HttpStatusCode Status, string Body)> SendAsync(HttpMethod method, string path, string? json = null, string? token = null)
    {
        using HttpResponseMessage response = await SendRawAsync(method, path, json, token);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private async Task<MediaAsset> AssetAsync(string? owner = null, string? sha = null, MediaAssetState state = MediaAssetState.Ready, bool deleted = false)
    {
        MediaAsset asset = PictureSeed.AddAsset(DbContext, owner ?? Owner, sha, state, deleted);
        await DbContext.SaveChangesAsync();
        if (asset.ObjectKey is not null)
        {
            _store.Objects[asset.ObjectKey] = Encoding.UTF8.GetBytes("webp:" + asset.Id);
        }

        return asset;
    }

    private static string Pic(MediaAsset asset, string alt = "A picture", string? attribution = null) =>
        $"{{\"assetId\":\"{asset.Id}\",\"altText\":\"{alt}\"" + (attribution is null ? "" : $",\"attribution\":\"{attribution}\"") + "}";

    private static string Body(
        string question = "Which flag?",
        string explanation = "",
        string? questionImage = null,
        string? explanationImage = null,
        bool isPrivate = false,
        string correct = "France",
        string incorrect = "Italy",
        string extra = "") =>
        "{\"category\":\"geography\",\"navigationKeyword1\":\"capitals\",\"navigationKeyword2\":\"europe\",\"isPrivate\":" + (isPrivate ? "true" : "false") + "," +
        $"\"question\":\"{question}\",\"correctAnswer\":\"{correct}\",\"incorrectAnswers\":[\"{incorrect}\"],\"explanation\":\"{explanation}\"" +
        (questionImage is null ? "" : ",\"questionImage\":" + questionImage) +
        (explanationImage is null ? "" : ",\"explanationImage\":" + explanationImage) +
        extra + "}";

    private async Task<Guid> CreateAsync(string body, string? token = null)
    {
        (HttpStatusCode status, string response) = await SendAsync(HttpMethod.Post, "/items", body, token ?? OwnerToken);
        status.Should().Be(HttpStatusCode.Created, response);
        return Guid.Parse(Json(response).GetProperty("id").GetString()!);
    }

    private async Task<Item> ItemAsync(Guid id)
    {
        await using ApplicationDbContext db = CreateDbContext();
        return await db.Items.AsNoTracking().SingleAsync(i => i.Id == id);
    }

    private async Task<List<ItemImageReview>> ReviewsAsync(Guid itemId)
    {
        await using ApplicationDbContext db = CreateDbContext();
        return await db.ItemImageReviews.AsNoTracking().Where(r => r.ItemId == itemId).OrderBy(r => r.Revision).ToListAsync();
    }

    private async Task<Item> SeedPictureItemAsync(
        ItemImageReviewState state,
        bool isPrivate = false,
        string? creator = null,
        MediaAsset? question = null,
        MediaAsset? explanation = null)
    {
        string by = creator ?? Owner;
        MediaAsset q = question ?? await AssetAsync(by);
        Item item = PictureSeed.AddPictureItem(DbContext, _category, by, isPrivate, state, q, explanation);
        await DbContext.SaveChangesAsync();
        return item;
    }

    private async Task DecideAsync(Guid itemId, string decision, int revision, string? reason = null, HttpStatusCode expected = HttpStatusCode.OK)
    {
        string body = $"{{\"decision\":\"{decision}\",\"expectedRevision\":{revision}" + (reason is null ? "" : $",\"reason\":\"{reason}\"") + "}";
        (HttpStatusCode status, string response) = await SendAsync(HttpMethod.Put, $"/admin/items/{itemId}/image-review", body, AdminToken);
        status.Should().Be(expected, response);
    }

    // ---- POST /items --------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Post_WithUploadedPicture_CreatesPendingRevisionOne_WithSubmissionRowAndMediaKey()
    {
        MediaAsset asset = await AssetAsync();

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Post, "/items", Body(questionImage: Pic(asset, "Three bands", "Photo by A")), OwnerToken);

        status.Should().Be(HttpStatusCode.Created, body);
        JsonElement json = Json(body);
        json.GetProperty("imageReview").GetProperty("state").GetString().Should().Be("PendingReview");
        json.GetProperty("imageReview").GetProperty("revision").GetInt32().Should().Be(1);
        json.GetProperty("questionImage").GetProperty("key").GetString().Should().Be($"media:{asset.Id:N}");
        json.GetProperty("questionImage").GetProperty("altText").GetString().Should().Be("Three bands");
        json.GetProperty("questionImage").GetProperty("attribution").GetString().Should().Be("Photo by A");
        json.GetProperty("explanationImage").ValueKind.Should().Be(JsonValueKind.Null);

        Item saved = await ItemAsync(Guid.Parse(json.GetProperty("id").GetString()!));
        saved.QuestionImageAssetId.Should().Be(asset.Id);
        saved.QuestionImageKey.Should().Be($"media:{asset.Id:N}");
        saved.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        saved.ImageRevision.Should().Be(1);
        saved.IsPrivate.Should().BeTrue("a non-admin creates private items");

        ItemImageReview row = (await ReviewsAsync(saved.Id)).Should().ContainSingle().Subject;
        row.Revision.Should().Be(1);
        row.SubmittedBy.Should().Be(Owner);
        row.QuestionSha256.Should().Be(asset.Sha256);
        row.ContentHash.Should().MatchRegex("^[0-9a-f]{64}$");
        row.Decision.Should().BeNull();
    }

    [Fact]
    public async Task Post_TextOnly_HasNoReviewState_AndNoSubmissionRow()
    {
        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Post, "/items", Body(), OwnerToken);

        status.Should().Be(HttpStatusCode.Created, body);
        JsonElement json = Json(body);
        json.GetProperty("imageReview").ValueKind.Should().Be(JsonValueKind.Null);
        json.GetProperty("questionImage").ValueKind.Should().Be(JsonValueKind.Null);
        Item saved = await ItemAsync(Guid.Parse(json.GetProperty("id").GetString()!));
        saved.ImageReviewState.Should().BeNull();
        saved.ImageRevision.Should().Be(0);
        (await ReviewsAsync(saved.Id)).Should().BeEmpty();
    }

    public static TheoryData<string> UnusableAssets => new() { "unknown", "someone-elses", "processing", "failed", "withdrawn" };

    [Theory]
    [MemberData(nameof(UnusableAssets))]
    public async Task Post_UnusableAsset_IsTheSame400_AndCreatesNothing(string kind)
    {
        Guid assetId = kind switch
        {
            "someone-elses" => (await AssetAsync(_otherId.ToString())).Id,
            "processing" => (await AssetAsync(state: MediaAssetState.Processing)).Id,
            "failed" => (await AssetAsync(state: MediaAssetState.Failed)).Id,
            "withdrawn" => (await AssetAsync(deleted: true)).Id,
            _ => Guid.NewGuid()
        };
        (HttpStatusCode baselineStatus, string baseline) = await SendAsync(
            HttpMethod.Post, "/items", Body(questionImage: $"{{\"assetId\":\"{Guid.NewGuid()}\",\"altText\":\"x\"}}"), OwnerToken);
        baselineStatus.Should().Be(HttpStatusCode.BadRequest, baseline);

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Post, "/items", Body(questionImage: $"{{\"assetId\":\"{assetId}\",\"altText\":\"x\"}}"), OwnerToken);

        status.Should().Be(HttpStatusCode.BadRequest, body);
        Json(body).GetProperty("title").GetString().Should().Be("Item.ImageAssetInvalid");
        Json(body).GetProperty("detail").GetString().Should().Be(Json(baseline).GetProperty("detail").GetString());
        (await DbContext.Items.CountAsync()).Should().Be(0);
        (await DbContext.ItemImageReviews.CountAsync()).Should().Be(0);
    }

    public static TheoryData<string, string> BadSlots => new()
    {
        { "{\"altText\":\"x\"}", "assetId is required" },
        { "{\"key\":\"curated:flags/fr\",\"altText\":\"x\"}", "assetId is required" },
        { "{\"url\":\"https://example.com/a.png\",\"altText\":\"x\"}", "assetId is required" },
        { "{\"assetId\":\"00000000-0000-0000-0000-000000000000\",\"altText\":\"x\"}", "assetId is required" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"x\",\"key\":\"curated:flags/fr\"}", "only assetId, altText" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"x\",\"url\":\"https://example.com/a.png\"}", "only assetId, altText" },
        { "{\"remove\":true}", "remove isn't supported" },
        { "{\"assetId\":\"@ASSET\"}", "altText is required" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"   \"}", "altText is required" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"two\\nlines\"}", "altText is required" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"@LONG\"}", "altText is required" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"x\",\"attribution\":\"@LONG\"}", "attribution must be" },
        { "{\"assetId\":\"@ASSET\",\"altText\":\"x\",\"attribution\":\"a\\u0007b\"}", "attribution must be" },
    };

    [Theory]
    [MemberData(nameof(BadSlots))]
    public async Task Post_BadPictureShape_Returns400NamingTheField(string slotJson, string expectedMessage)
    {
        MediaAsset asset = await AssetAsync();
        string slot = slotJson.Replace("@ASSET", asset.Id.ToString()).Replace("@LONG", new string('x', 301));

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Post, "/items", Body(questionImage: slot), OwnerToken);

        status.Should().Be(HttpStatusCode.BadRequest, body);
        body.Should().Contain("QuestionImage").And.Contain(expectedMessage);
        (await DbContext.Items.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Post_ExplanationPictureCanBeTheWholeExplanation()
    {
        MediaAsset asset = await AssetAsync();

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Post, "/items", Body(explanation: "", explanationImage: Pic(asset)), OwnerToken);
        status.Should().Be(HttpStatusCode.Created, body);
        Json(body).GetProperty("explanation").GetString().Should().BeEmpty();

        (HttpStatusCode ok, string okBody) = await SendAsync(
            HttpMethod.Post, "/items", Body(question: "Another explanation?", explanation: "Because", explanationImage: Pic(asset)), OwnerToken);
        ok.Should().Be(HttpStatusCode.Created, okBody);
        Json(okBody).GetProperty("imageReview").GetProperty("state").GetString().Should().Be("PendingReview");
    }

    [Fact]
    public async Task Post_OneAssetOnBothSlots_AndOnTwoItems_IsAllowed()
    {
        MediaAsset asset = await AssetAsync();

        Guid first = await CreateAsync(Body(question: "First?", explanation: "E", questionImage: Pic(asset), explanationImage: Pic(asset)));
        Guid second = await CreateAsync(Body(question: "Second?", questionImage: Pic(asset)));

        (await ItemAsync(first)).ExplanationImageAssetId.Should().Be(asset.Id);
        (await ItemAsync(second)).QuestionImageAssetId.Should().Be(asset.Id);
    }

    [Fact]
    public async Task Post_AdminPublicWithPicture_Returns409_AndCreatesNothing()
    {
        MediaAsset asset = await AssetAsync(_adminId.ToString());

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Post, "/items", Body(isPrivate: false, questionImage: Pic(asset)), AdminToken);

        status.Should().Be(HttpStatusCode.Conflict, body);
        Json(body).GetProperty("title").GetString().Should().Be("Item.ImageReviewRequired");
        (await DbContext.Items.CountAsync()).Should().Be(0);

        (HttpStatusCode privateOk, string privateBody) = await SendAsync(
            HttpMethod.Post, "/items", Body(isPrivate: true, questionImage: Pic(asset)), AdminToken);
        privateOk.Should().Be(HttpStatusCode.Created, privateBody);

        (HttpStatusCode textOnly, string textBody) = await SendAsync(HttpMethod.Post, "/items", Body(question: "Text only?", isPrivate: false), AdminToken);
        textOnly.Should().Be(HttpStatusCode.Created, textBody);
    }

    [Fact]
    public async Task Post_Anonymous_Returns401()
    {
        MediaAsset asset = await AssetAsync();

        (HttpStatusCode status, _) = await SendAsync(HttpMethod.Post, "/items", Body(questionImage: Pic(asset)));

        status.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ---- duplicates (AC 2.1.21, 3.25.9) -------------------------------------------------------------------------------

    [Fact]
    public async Task Duplicate_SameQuestionSameBytes_IsRejected_EvenForADifferentAssetId()
    {
        string sha = PictureSeed.Sha('d');
        MediaAsset first = await AssetAsync(sha: sha);
        MediaAsset second = await AssetAsync(sha: sha);
        await CreateAsync(Body(questionImage: Pic(first)));

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Post, "/items", Body(questionImage: Pic(second)), OwnerToken);

        status.Should().Be(HttpStatusCode.BadRequest, body);
        Json(body).GetProperty("title").GetString().Should().Be("Item.Duplicate");
    }

    [Fact]
    public async Task Duplicate_SameQuestionDifferentBytes_TextOnlyCopy_AndPictureCopyOfTextOnly_AreAllowed()
    {
        MediaAsset a = await AssetAsync();
        MediaAsset b = await AssetAsync();
        await CreateAsync(Body(questionImage: Pic(a)));

        (await SendAsync(HttpMethod.Post, "/items", Body(questionImage: Pic(b)), OwnerToken)).Status
            .Should().Be(HttpStatusCode.Created, "different bytes");
        (await SendAsync(HttpMethod.Post, "/items", Body(), OwnerToken)).Status
            .Should().Be(HttpStatusCode.Created, "a text-only copy of a picture question");
        (await SendAsync(HttpMethod.Post, "/items", Body(), OwnerToken)).Status
            .Should().Be(HttpStatusCode.BadRequest, "the same text as one of my text-only items");

        MediaAsset c = await AssetAsync();
        await CreateAsync(Body(question: "Plain?"));
        (await SendAsync(HttpMethod.Post, "/items", Body(question: "Plain?", questionImage: Pic(c)), OwnerToken)).Status
            .Should().Be(HttpStatusCode.Created, "a picture copy of a text-only question");
    }

    [Fact]
    public async Task Duplicate_AnotherUsersPrivateHash_DoesNotRevealExistence()
    {
        string sha = PictureSeed.Sha('e');
        MediaAsset owners = await AssetAsync(sha: sha);
        await CreateAsync(Body(isPrivate: true, questionImage: Pic(owners)));
        MediaAsset sameBytes = await AssetAsync(owner: _otherId.ToString(), sha: sha);
        MediaAsset differentBytes = await AssetAsync(owner: _otherId.ToString());

        (HttpStatusCode collides, string collidesBody) = await SendAsync(
            HttpMethod.Post, "/items", Body(isPrivate: true, questionImage: Pic(sameBytes)), OtherToken);
        (HttpStatusCode control, string controlBody) = await SendAsync(
            HttpMethod.Post, "/items", Body(question: "Which other flag?", isPrivate: true, questionImage: Pic(differentBytes)), OtherToken);

        collides.Should().Be(HttpStatusCode.Created, collidesBody);
        control.Should().Be(collides, "the same response as a picture nobody else has");
        collidesBody.Should().NotContain("Duplicate");
        controlBody.Should().NotContain("Duplicate");
    }

    [Fact]
    public async Task Duplicate_ExplanationPictureIsNotPartOfTheIdentity()
    {
        string sha = PictureSeed.Sha('e');
        MediaAsset q = await AssetAsync(sha: sha);
        MediaAsset e = await AssetAsync();
        await CreateAsync(Body(explanation: "E", questionImage: Pic(q), explanationImage: Pic(e)));

        MediaAsset sameBytes = await AssetAsync(sha: sha);
        (await SendAsync(HttpMethod.Post, "/items", Body(questionImage: Pic(sameBytes)), OwnerToken)).Status
            .Should().Be(HttpStatusCode.BadRequest, "the question bytes match; the explanation picture is ignored");
    }

    // ---- PUT /items/{id}: state machine ---------------------------------------------------------------------------------

    [Fact]
    public async Task Put_AddingAPictureToATextOnlyItem_SubmitsRevisionOne()
    {
        Guid id = await CreateAsync(Body());
        MediaAsset asset = await AssetAsync();

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset)), OwnerToken);

        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("imageReview").GetProperty("state").GetString().Should().Be("PendingReview");
        Item item = await ItemAsync(id);
        item.ImageRevision.Should().Be(1);
        (await ReviewsAsync(id)).Should().ContainSingle().Which.Revision.Should().Be(1);
    }

    [Fact]
    public async Task Put_OmittedPictures_KeepThem_AndLeaveStateAndRevisionUnchanged()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset, "Alt")));

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(), OwnerToken);

        status.Should().Be(HttpStatusCode.OK, body);
        Item item = await ItemAsync(id);
        item.QuestionImageAssetId.Should().Be(asset.Id);
        item.QuestionImageAlt.Should().Be("Alt");
        item.ImageRevision.Should().Be(1);
        item.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        (await ReviewsAsync(id)).Should().ContainSingle();
    }

    [Fact]
    public async Task Put_NullPictures_AlsoKeepThem()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));

        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: "null", explanationImage: "null"), OwnerToken)).Status
            .Should().Be(HttpStatusCode.OK);

        (await ItemAsync(id)).QuestionImageAssetId.Should().Be(asset.Id);
    }

    [Fact]
    public async Task Put_ReplacingTheAsset_ResubmitsAndSupersedesTheUndecidedRow()
    {
        MediaAsset first = await AssetAsync();
        MediaAsset second = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(first)));

        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(second)), OwnerToken)).Status.Should().Be(HttpStatusCode.OK);

        Item item = await ItemAsync(id);
        item.QuestionImageAssetId.Should().Be(second.Id);
        item.QuestionImageKey.Should().Be($"media:{second.Id:N}");
        item.ImageRevision.Should().Be(2);
        List<ItemImageReview> rows = await ReviewsAsync(id);
        rows.Select(r => r.Decision).Should().Equal("Superseded", null);
        rows[1].QuestionAssetId.Should().Be(second.Id);
    }

    [Fact]
    public async Task Put_RemovingTheLastPicture_ClearsState_IncrementsRevision_AndRevisionNeverResets()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));

        (HttpStatusCode removed, string body) = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: "{\"remove\":true}"), OwnerToken);

        removed.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("imageReview").ValueKind.Should().Be(JsonValueKind.Null);
        Item cleared = await ItemAsync(id);
        cleared.ImageReviewState.Should().BeNull();
        cleared.ImageRevision.Should().Be(2);
        cleared.QuestionImageAssetId.Should().BeNull();
        cleared.QuestionImageKey.Should().BeNull();
        cleared.QuestionImageAlt.Should().BeNull();
        (await ReviewsAsync(id)).Should().ContainSingle().Which.Decision.Should().Be("Superseded");

        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset)), OwnerToken)).Status.Should().Be(HttpStatusCode.OK);
        Item readded = await ItemAsync(id);
        readded.ImageRevision.Should().Be(3, "the revision only ever increases");
        readded.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Put_ReplacingTheAssetWithSameBytesUnderANewId_ClaimsANewRevision_SoTheNewRowCanBeApproved(bool approvedFirst)
    {
        string sha = PictureSeed.Sha('9');
        MediaAsset first = await AssetAsync(sha: sha);
        MediaAsset second = await AssetAsync(sha: sha);
        Guid id = await CreateAsync(Body(questionImage: Pic(first)));
        if (approvedFirst)
        {
            await DecideAsync(id, "approve", 1);
        }

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(second)), OwnerToken);

        status.Should().Be(HttpStatusCode.OK, body);
        Item item = await ItemAsync(id);
        item.QuestionImageAssetId.Should().Be(second.Id);
        item.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        item.ImageRevision.Should().Be(2);
        List<ItemImageReview> rows = await ReviewsAsync(id);
        rows.Select(r => r.Decision).Should().Equal(approvedFirst ? "Approved" : "Superseded", null);
        rows[1].QuestionAssetId.Should().Be(second.Id);
        await DecideAsync(id, "approve", 2);
        (await ItemAsync(id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved);
    }

    [Fact]
    public async Task Put_RemoveCombinedWithAssetId_Returns400()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Put, $"/items/{id}", Body(questionImage: $"{{\"remove\":true,\"assetId\":\"{asset.Id}\"}}"), OwnerToken);

        status.Should().Be(HttpStatusCode.BadRequest, body);
        body.Should().Contain("remove can't be combined");
    }

    [Fact]
    public async Task Put_RemovingBothPicturesAtOnce_AndClearingExplanation_IsAllowed()
    {
        MediaAsset q = await AssetAsync();
        MediaAsset e = await AssetAsync();
        Guid id = await CreateAsync(Body(explanation: "Because", questionImage: Pic(q), explanationImage: Pic(e)));

        (HttpStatusCode keepStatus, string keepBody) = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(explanation: ""), OwnerToken);
        keepStatus.Should().Be(HttpStatusCode.OK, keepBody);

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Put, $"/items/{id}", Body(explanation: "", questionImage: "{\"remove\":true}", explanationImage: "{\"remove\":true}"), OwnerToken);

        status.Should().Be(HttpStatusCode.OK, body);
        Item item = await ItemAsync(id);
        item.ImageReviewState.Should().BeNull();
        item.ExplanationImageAssetId.Should().BeNull();
    }

    [Fact]
    public async Task Put_RejectedItemSavedUnchanged_StaysRejected_ButAChangedTextResubmits()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));
        await DecideAsync(id, "reject", 1, "Not suitable");

        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset)), OwnerToken)).Status.Should().Be(HttpStatusCode.OK);
        Item unchanged = await ItemAsync(id);
        unchanged.ImageReviewState.Should().Be(ItemImageReviewState.Rejected);
        unchanged.ImageRevision.Should().Be(1);

        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(question: "Which flag is this?", questionImage: Pic(asset)), OwnerToken)).Status
            .Should().Be(HttpStatusCode.OK);
        Item resubmitted = await ItemAsync(id);
        resubmitted.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        resubmitted.ImageRevision.Should().Be(2);
        (await ReviewsAsync(id)).Select(r => r.Decision).Should().Equal("Rejected", null);
    }

    [Fact]
    public async Task Put_ApprovedItem_AnyReviewedContentChange_ResubmitsButOtherFieldsKeepApproval()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));
        await DecideAsync(id, "approve", 1);

        // Source and group label are not part of the content hash (nor are category and keywords).
        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset), extra: ",\"source\":\"Atlas\",\"groupLabel\":\"Europe\""), OwnerToken)).Status
            .Should().Be(HttpStatusCode.OK);
        Item kept = await ItemAsync(id);
        kept.ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        kept.ImageRevision.Should().Be(1);

        foreach ((string label, string body) in new[]
        {
            ("answer", Body(questionImage: Pic(asset), incorrect: "Spain")),
            ("explanation", Body(explanation: "New", questionImage: Pic(asset))),
            ("alt", Body(questionImage: Pic(asset, "Different alt"))),
            ("attribution", Body(questionImage: Pic(asset, attribution: "Credit")))
        })
        {
            (await SendAsync(HttpMethod.Put, $"/items/{id}", body, OwnerToken)).Status.Should().Be(HttpStatusCode.OK, label);
            Item changed = await ItemAsync(id);
            changed.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview, label);
            await DecideAsync(id, "approve", changed.ImageRevision);
        }

        (await ItemAsync(id)).ImageRevision.Should().Be(5);
    }

    [Fact]
    public async Task Put_ByAdmin_CannotAttachTheirOwnUpload_ButCanKeepRemoveAndRedescribeTheCreatorsPicture()
    {
        MediaAsset creators = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(creators, "Original")));
        MediaAsset adminsOwn = await AssetAsync(_adminId.ToString());

        (HttpStatusCode attach, string attachBody) = await SendAsync(
            HttpMethod.Put, $"/items/{id}", Body(isPrivate: true, questionImage: Pic(adminsOwn)), AdminToken);
        attach.Should().Be(HttpStatusCode.BadRequest, attachBody);
        Json(attachBody).GetProperty("title").GetString().Should().Be("Item.ImageAssetInvalid");

        await DecideAsync(id, "approve", 1);
        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(isPrivate: true), AdminToken)).Status.Should().Be(HttpStatusCode.OK);
        (await ItemAsync(id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved, "omitting a picture keeps it");

        (HttpStatusCode redescribe, string redescribeBody) = await SendAsync(
            HttpMethod.Put, $"/items/{id}", Body(isPrivate: true, questionImage: Pic(creators, "Corrected alt")), AdminToken);
        redescribe.Should().Be(HttpStatusCode.OK, redescribeBody);
        Item redescribed = await ItemAsync(id);
        redescribed.QuestionImageAlt.Should().Be("Corrected alt");
        redescribed.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        (await ReviewsAsync(id)).Last().SubmittedBy.Should().Be(_adminId.ToString());

        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(isPrivate: true, questionImage: "{\"remove\":true}"), AdminToken)).Status
            .Should().Be(HttpStatusCode.OK);
        (await ItemAsync(id)).ImageReviewState.Should().BeNull();
    }

    [Fact]
    public async Task Put_RepoManagedItem_OrCuratedSlot_RejectsAnyPictureInput()
    {
        MediaAsset asset = await AssetAsync();
        Item managed = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        managed.IsRepoManaged = true;
        managed.Question = "Managed?";
        Item curated = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        curated.Question = "Curated?";
        curated.QuestionImageKey = "curated:flags/fr";
        curated.QuestionImageAlt = "Three bands";
        await DbContext.SaveChangesAsync();

        foreach (Item item in new[] { managed, curated })
        {
            (HttpStatusCode status, string body) = await SendAsync(
                HttpMethod.Put, $"/items/{item.Id}", Body(question: item.Question, questionImage: Pic(asset)), OwnerToken);
            status.Should().Be(HttpStatusCode.BadRequest, body);
            Json(body).GetProperty("title").GetString().Should().Be("Item.ImagesManagedBySeed");
        }

        (await ItemAsync(curated.Id)).QuestionImageKey.Should().Be("curated:flags/fr");
        (await SendAsync(HttpMethod.Put, $"/items/{curated.Id}", Body(question: "Curated?"), OwnerToken)).Status
            .Should().Be(HttpStatusCode.OK, "a curated item without picture input is unaffected");
        (await ItemAsync(curated.Id)).ImageReviewState.Should().BeNull();
        (await ItemAsync(curated.Id)).QuestionImageKey.Should().Be("curated:flags/fr");
    }

    [Fact]
    public async Task Put_PublishGuard_IsOnlyForPrivateToPublicTransitions_EvaluatedAgainstThePostEditState()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));
        await DecideAsync(id, "approve", 1);

        // A private Approved item edited and published in one request re-enters PendingReview, so it is refused.
        (HttpStatusCode refused, string refusedBody) = await SendAsync(
            HttpMethod.Put, $"/items/{id}", Body(question: "Changed?", isPrivate: false, questionImage: Pic(asset)), AdminToken);
        refused.Should().Be(HttpStatusCode.Conflict, refusedBody);
        Json(refusedBody).GetProperty("title").GetString().Should().Be("Item.ImageReviewRequired");
        Item untouched = await ItemAsync(id);
        untouched.IsPrivate.Should().BeTrue();
        untouched.Question.Should().Be("Which flag?");
        untouched.ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        untouched.ImageRevision.Should().Be(1);

        // Publishing without changing reviewed content keeps Approved and is allowed.
        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(isPrivate: false), AdminToken)).Status.Should().Be(HttpStatusCode.OK);
        (await ItemAsync(id)).IsPrivate.Should().BeFalse();

        // An admin edit of an already public item is allowed; it re-enters PendingReview and is then hidden.
        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(question: "Edited again?", isPrivate: false), AdminToken)).Status
            .Should().Be(HttpStatusCode.OK);
        Item pending = await ItemAsync(id);
        pending.IsPrivate.Should().BeFalse();
        pending.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        (await SendAsync(HttpMethod.Get, $"/items/{id}")).Status.Should().Be(HttpStatusCode.NotFound, "public-flagged but gated");
        (await SendAsync(HttpMethod.Get, $"/items/{id}", token: OtherToken)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Get, $"/items/{id}", token: OwnerToken)).Status.Should().Be(HttpStatusCode.OK);
        (await SendAsync(HttpMethod.Get, $"/items/{id}", token: AdminToken)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Put_NonOwnerOnAPublicItemWithPendingPictures_Gets404NotTheUsual403()
    {
        Item pending = await SeedPictureItemAsync(ItemImageReviewState.PendingReview, isPrivate: false);
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved, isPrivate: false);

        (await SendAsync(HttpMethod.Put, $"/items/{pending.Id}", Body(), OtherToken)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Put, $"/items/{approved.Id}", Body(), OtherToken)).Status.Should().Be(HttpStatusCode.Forbidden);
    }

    // ---- PUT /admin/items/{id}/image-review ----------------------------------------------------------------------------

    [Fact]
    public async Task Decision_Approve_RecordsTheDecision_AndNeverTouchesVisibilityOrReviewFlags()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset), extra: ",\"readyForReview\":true"));
        await using (ApplicationDbContext db = CreateDbContext())
        {
            Collection collection = VisibilitySeed.AddCollection(db, Owner, false);
            VisibilitySeed.Link(db, collection, await db.Items.FirstAsync(i => i.Id == id));
            await db.SaveChangesAsync();
        }

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{id}/image-review", "{\"decision\":\"approve\",\"expectedRevision\":1,\"reason\":\"Looks fine\"}", AdminToken);

        status.Should().Be(HttpStatusCode.OK, body);
        JsonElement review = Json(body).GetProperty("imageReview");
        review.GetProperty("state").GetString().Should().Be("Approved");
        review.GetProperty("revision").GetInt32().Should().Be(1);
        review.GetProperty("submittedBy").GetString().Should().Be(Owner);
        review.GetProperty("decidedBy").GetString().Should().Be(_adminId.ToString());
        review.GetProperty("reason").GetString().Should().Be("Looks fine");

        Item item = await ItemAsync(id);
        item.ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        item.IsPrivate.Should().BeTrue();
        item.ReadyForReview.Should().BeTrue();
        await using ApplicationDbContext verify = CreateDbContext();
        (await verify.CollectionItems.CountAsync(ci => ci.ItemId == id)).Should().Be(1);
        ItemImageReview row = (await ReviewsAsync(id)).Single();
        row.Decision.Should().Be("Approved");
        row.DecidedBy.Should().Be(_adminId.ToString());
        row.DecidedAt.Should().NotBeNull();
        row.PolicyVersion.Should().Be("pictures-v1");
    }

    [Fact]
    public async Task Decision_Reject_RequiresAReason_AndStoresIt()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));

        (HttpStatusCode noReason, string noReasonBody) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{id}/image-review", "{\"decision\":\"reject\",\"expectedRevision\":1}", AdminToken);
        noReason.Should().Be(HttpStatusCode.BadRequest, noReasonBody);
        noReasonBody.Should().Contain("Reason is required when rejecting");

        (HttpStatusCode tooLong, string tooLongBody) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{id}/image-review",
            $"{{\"decision\":\"reject\",\"expectedRevision\":1,\"reason\":\"{new string('r', 501)}\"}}", AdminToken);
        tooLong.Should().Be(HttpStatusCode.BadRequest, tooLongBody);

        await DecideAsync(id, "reject", 1, "Blurry");
        (await ItemAsync(id)).ImageReviewState.Should().Be(ItemImageReviewState.Rejected);
        (await ReviewsAsync(id)).Single().Reason.Should().Be("Blurry");
    }

    [Fact]
    public async Task Decision_AnAdminMayDecideTheirOwnSubmission_AndItIsRecordedAsSuch()
    {
        MediaAsset asset = await AssetAsync(_adminId.ToString());
        Guid id = await CreateAsync(Body(isPrivate: true, questionImage: Pic(asset)), AdminToken);

        await DecideAsync(id, "approve", 1);

        ItemImageReview row = (await ReviewsAsync(id)).Single();
        row.SubmittedBy.Should().Be(_adminId.ToString());
        row.DecidedBy.Should().Be(row.SubmittedBy);
        row.Decision.Should().Be("Approved");
    }

    [Fact]
    public async Task Decision_RepeatingTheSameDecision_IsA200NoOp_AndAConflictingOneIs409WithCurrentState()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));
        await DecideAsync(id, "approve", 1, "First");

        await DecideAsync(id, "approve", 1, "Second reviewer");

        ItemImageReview row = (await ReviewsAsync(id)).Single();
        row.Reason.Should().Be("First", "a repeat changes nothing");

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{id}/image-review", "{\"decision\":\"reject\",\"expectedRevision\":1,\"reason\":\"Changed my mind\"}", AdminToken);
        status.Should().Be(HttpStatusCode.Conflict, body);
        JsonElement problem = Json(body);
        problem.GetProperty("title").GetString().Should().Be("Item.ImageReviewStale");
        problem.GetProperty("currentRevision").GetInt32().Should().Be(1);
        problem.GetProperty("currentState").GetString().Should().Be("Approved");
        (await ItemAsync(id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved);
    }

    [Fact]
    public async Task Decision_ForAnOlderRevision_AfterAnEdit_Is409_AndTheNewContentStaysPending()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));
        (await SendAsync(HttpMethod.Put, $"/items/{id}", Body(question: "Edited?", questionImage: Pic(asset)), OwnerToken)).Status
            .Should().Be(HttpStatusCode.OK);

        (HttpStatusCode status, string body) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{id}/image-review", "{\"decision\":\"approve\",\"expectedRevision\":1}", AdminToken);

        status.Should().Be(HttpStatusCode.Conflict, body);
        Json(body).GetProperty("currentRevision").GetInt32().Should().Be(2);
        Json(body).GetProperty("currentState").GetString().Should().Be("PendingReview");
        (await ItemAsync(id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        await DecideAsync(id, "approve", 2);
    }

    [Fact]
    public async Task Decision_ForTheWrongOrFutureRevision_AndForANonPendingState_Is409()
    {
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        Item pending = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);

        await DecideAsync(pending.Id, "approve", 2, expected: HttpStatusCode.Conflict);
        await DecideAsync(approved.Id, "reject", 1, "Too late", HttpStatusCode.Conflict);
        (await ItemAsync(approved.Id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        (await ItemAsync(pending.Id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
    }

    [Fact]
    public async Task Decision_Approve_RequiresTheSubmittedAssetsToBeStillReadyAndUnchanged()
    {
        Item deleted = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        MediaAsset changed = await AssetAsync();
        Item swapped = await SeedPictureItemAsync(ItemImageReviewState.PendingReview, question: changed);
        await DbContext.MediaAssets.Where(a => a.Id == deleted.QuestionImageAssetId).ExecuteUpdateAsync(s => s.SetProperty(a => a.DeletedAt, DateTime.UtcNow));
        await DbContext.MediaAssets.Where(a => a.Id == changed.Id).ExecuteUpdateAsync(s => s.SetProperty(a => a.Sha256, PictureSeed.Sha('f')));

        foreach (Item item in new[] { deleted, swapped })
        {
            (HttpStatusCode status, string body) = await SendAsync(
                HttpMethod.Put, $"/admin/items/{item.Id}/image-review", "{\"decision\":\"approve\",\"expectedRevision\":1}", AdminToken);
            status.Should().Be(HttpStatusCode.Conflict, body);
            Json(body).GetProperty("title").GetString().Should().Be("Item.ImageAssetUnavailable");
            (await ItemAsync(item.Id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        }

        await DecideAsync(deleted.Id, "reject", 1, "Gone");
    }

    [Fact]
    public async Task Decision_MissingItem_TextOnlyItem_BadBody_AndCallers()
    {
        Guid textOnly = await CreateAsync(Body());
        string valid = "{\"decision\":\"approve\",\"expectedRevision\":1}";

        (await SendAsync(HttpMethod.Put, $"/admin/items/{Guid.NewGuid()}/image-review", valid, AdminToken)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Put, $"/admin/items/{textOnly}/image-review", valid, AdminToken)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Put, $"/admin/items/{textOnly}/image-review", "{\"decision\":\"maybe\",\"expectedRevision\":1}", AdminToken)).Status
            .Should().Be(HttpStatusCode.BadRequest);
        (await SendAsync(HttpMethod.Put, $"/admin/items/{textOnly}/image-review", "{\"decision\":\"approve\",\"expectedRevision\":0}", AdminToken)).Status
            .Should().Be(HttpStatusCode.BadRequest);
        (await SendAsync(HttpMethod.Put, $"/admin/items/{textOnly}/image-review", valid)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await SendAsync(HttpMethod.Put, $"/admin/items/{textOnly}/image-review", valid, OwnerToken)).Status.Should().Be(HttpStatusCode.Forbidden);
    }

    // ---- publish guards on the admin endpoints (AC 2.7.5, 2.8.6) ------------------------------------------------------

    [Theory]
    [InlineData(ItemImageReviewState.PendingReview, false)]
    [InlineData(ItemImageReviewState.Rejected, false)]
    [InlineData(ItemImageReviewState.Withdrawn, false)]
    [InlineData(ItemImageReviewState.Approved, true)]
    public async Task PublishGuards_BlockPrivateToPublic_UntilApproved(ItemImageReviewState state, bool allowed)
    {
        Item viaApproval = await SeedPictureItemAsync(state, isPrivate: true);
        Item viaVisibility = await SeedPictureItemAsync(state, isPrivate: true);
        HttpStatusCode expected = allowed ? HttpStatusCode.OK : HttpStatusCode.Conflict;

        (HttpStatusCode approval, string approvalBody) = await SendAsync(HttpMethod.Put, $"/admin/items/{viaApproval.Id}/approval", null, AdminToken);
        (HttpStatusCode visibility, string visibilityBody) = await SendAsync(
            HttpMethod.Put, $"/items/{viaVisibility.Id}/visibility", "{\"isPrivate\":false}", AdminToken);

        approval.Should().Be(expected, approvalBody);
        visibility.Should().Be(expected, visibilityBody);
        (await ItemAsync(viaApproval.Id)).IsPrivate.Should().Be(!allowed);
        (await ItemAsync(viaVisibility.Id)).IsPrivate.Should().Be(!allowed);
        if (!allowed)
        {
            Json(approvalBody).GetProperty("title").GetString().Should().Be("Item.ImageReviewRequired");
            Json(visibilityBody).GetProperty("title").GetString().Should().Be("Item.ImageReviewRequired");
        }
    }

    [Fact]
    public async Task PublishGuards_DoNotApplyToTextOnlyItems_AlreadyPublicItems_OrMakingPrivate()
    {
        Guid textOnly = await CreateAsync(Body());
        Item alreadyPublic = await SeedPictureItemAsync(ItemImageReviewState.PendingReview, isPrivate: false);

        (await SendAsync(HttpMethod.Put, $"/admin/items/{textOnly}/approval", null, AdminToken)).Status.Should().Be(HttpStatusCode.OK);
        (await SendAsync(HttpMethod.Put, $"/admin/items/{alreadyPublic.Id}/approval", null, AdminToken)).Status
            .Should().Be(HttpStatusCode.OK, "no private-to-public transition");
        (await SendAsync(HttpMethod.Put, $"/items/{alreadyPublic.Id}/visibility", "{\"isPrivate\":true}", AdminToken)).Status
            .Should().Be(HttpStatusCode.OK);
        (await ItemAsync(alreadyPublic.Id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview, "approving text never approves pictures");
    }

    [Fact]
    public async Task ApproveItemRace_ProducingAPublicPendingItem_StaysHiddenFromEveryoneButOwnerAndAdmin()
    {
        // The guard is policy; this is the state a race between check and save could leave behind.
        Item item = await SeedPictureItemAsync(ItemImageReviewState.PendingReview, isPrivate: false);

        (await SendAsync(HttpMethod.Get, $"/items/{item.Id}")).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Get, $"/items/{item.Id}", token: OtherToken)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Get, $"/items/{item.Id}/images/question")).Status.Should().Be(HttpStatusCode.NotFound);
        (HttpStatusCode listStatus, string list) = await SendAsync(HttpMethod.Get, "/items?category=geography");
        listStatus.Should().Be(HttpStatusCode.OK, list);
        Json(list).GetProperty("items").GetArrayLength().Should().Be(0);
        (await SendAsync(HttpMethod.Get, $"/items/{item.Id}", token: OwnerToken)).Status.Should().Be(HttpStatusCode.OK);
        (await SendAsync(HttpMethod.Get, $"/items/{item.Id}", token: AdminToken)).Status.Should().Be(HttpStatusCode.OK);
    }

    // ---- delivery routes: authorization matrix (AC 3.25.5) -----------------------------------------------------------

    public static TheoryData<string, string> ItemRouteMatrix()
    {
        TheoryData<string, string> data = [];
        foreach (string caller in new[] { "anonymous", "owner", "other", "admin" })
        {
            foreach (string state in new[] { "PendingReview", "Approved", "Rejected", "Withdrawn" })
            {
                data.Add(caller, state);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(ItemRouteMatrix))]
    public async Task ItemRoute_PublicItem_ByCallerAndState(string caller, string stateName)
    {
        ItemImageReviewState state = Enum.Parse<ItemImageReviewState>(stateName);
        Item item = await SeedPictureItemAsync(state, isPrivate: false);
        bool privileged = caller is "owner" or "admin";
        bool allowed = privileged || state == ItemImageReviewState.Approved;

        using HttpResponseMessage response = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/question", token: TokenOf(caller));

        response.StatusCode.Should().Be(allowed ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        byte[] body = await response.Content.ReadAsByteArrayAsync();
        if (allowed)
        {
            MediaAsset asset = await DbContext.MediaAssets.AsNoTracking().SingleAsync(a => a.Id == item.QuestionImageAssetId);
            body.Should().Equal(_store.Objects[asset.ObjectKey!]);
            response.Content.Headers.ContentType!.MediaType.Should().Be("image/webp");
            response.Headers.CacheControl!.ToString().Should().Contain("no-store").And.Contain("private");
            response.Headers.GetValues("X-Content-Type-Options").Should().Contain("nosniff");
        }
        else
        {
            body.Should().BeEmpty();
            response.Content.Headers.ContentType.Should().BeNull();
        }
        using HttpResponseMessage snapshot = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/question?expectedRevision={item.ImageRevision}", token: TokenOf(caller));
        snapshot.StatusCode.Should().Be(allowed ? HttpStatusCode.OK : HttpStatusCode.NotFound, "positive snapshot binding must preserve the exact route authorization");

    }

    [Theory]
    [InlineData("anonymous", true)]
    [InlineData("other", true)]
    [InlineData("owner", true)]
    [InlineData("admin", true)]
    [InlineData("anonymous", false)]
    [InlineData("other", false)]
    [InlineData("owner", false)]
    [InlineData("admin", false)]
    public async Task ItemRoute_ByCaller_ForApprovedPublicVersusApprovedPrivateItems(string caller, bool isPublic)
    {
        Item item = await SeedPictureItemAsync(ItemImageReviewState.Approved, isPrivate: !isPublic);
        bool privileged = caller is "owner" or "admin";
        bool allowed = privileged || isPublic;

        using HttpResponseMessage response = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/question", token: TokenOf(caller));

        response.StatusCode.Should().Be(allowed ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        using HttpResponseMessage snapshot = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/question?expectedRevision={item.ImageRevision}", token: TokenOf(caller));
        snapshot.StatusCode.Should().Be(allowed ? HttpStatusCode.OK : HttpStatusCode.NotFound, "positive snapshot binding must preserve the exact route authorization");

    }

    [Theory]
    [InlineData("anonymous")]
    [InlineData("owner")]
    [InlineData("other")]
    [InlineData("admin")]
    public async Task ItemRoute_TextOnly_Curated_EmptySlot_UnknownSlot_AndMissingItem_AreTheSameEmpty404(string caller)
    {
        Guid textOnly = await CreateAsync(Body());
        Item curated = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        curated.QuestionImageKey = "curated:flags/fr";
        curated.QuestionImageAlt = "Three bands";
        Item picture = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        await DbContext.SaveChangesAsync();
        string? token = TokenOf(caller);

        foreach (string path in new[]
        {
            $"/items/{textOnly}/images/question",
            $"/items/{curated.Id}/images/question",
            $"/items/{picture.Id}/images/explanation",
            $"/items/{picture.Id}/images/thumbnail",
            $"/items/{Guid.NewGuid()}/images/question"
        })
        {
            using HttpResponseMessage response = await SendRawAsync(HttpMethod.Get, path, token: token);
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, path);
            (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty(path);
            response.Content.Headers.ContentType.Should().BeNull(path);
        }
    }

    [Fact]
    public async Task ItemRoute_ServesTheExplanationSlot_AndRefusesAWithdrawnOrNotReadyAsset()
    {
        MediaAsset explanation = await AssetAsync();
        Item item = await SeedPictureItemAsync(ItemImageReviewState.Approved, explanation: explanation);

        using HttpResponseMessage ok = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/explanation");
        ok.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ok.Content.ReadAsByteArrayAsync()).Should().Equal(_store.Objects[explanation.ObjectKey!]);

        await DbContext.MediaAssets.Where(a => a.Id == explanation.Id).ExecuteUpdateAsync(s => s.SetProperty(a => a.DeletedAt, DateTime.UtcNow));
        using HttpResponseMessage withdrawn = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/explanation");
        withdrawn.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using HttpResponseMessage questionStillOk = await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/question");
        questionStillOk.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task ItemRoute_StorageOff_Is503OnlyAfterAuthorization_AndStillAnEmpty404ForTheUnauthorized()
    {
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        Item pending = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        _store.Available = false;

        (await SendRawAsync(HttpMethod.Get, $"/items/{approved.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await SendRawAsync(HttpMethod.Get, $"/items/{pending.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await SendRawAsync(HttpMethod.Get, $"/items/{pending.Id}/images/question", token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
    }

    [Fact]
    public async Task ItemRoute_ObjectMissingFromStorage_Is404()
    {
        Item item = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        _store.ReadReturnsNull = true;

        (await SendRawAsync(HttpMethod.Get, $"/items/{item.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    public static TheoryData<string, string, string, bool> CollectionRouteMatrix()
    {
        // caller, state, collection kind, allowed
        TheoryData<string, string, string, bool> data = [];
        foreach (string caller in new[] { "anonymous", "other", "owner", "admin" })
        {
            foreach (string state in new[] { "PendingReview", "Approved", "Rejected", "Withdrawn" })
            {
                foreach (string collection in new[] { "public", "private-own" })
                {
                    bool collectionOpen = collection == "public" || caller == "owner";
                    bool isCreator = caller == "owner";
                    data.Add(caller, state, collection, collectionOpen && (isCreator || state == "Approved"));
                }
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(CollectionRouteMatrix))]
    public async Task CollectionRoute_ByCallerStateAndCollection(string caller, string stateName, string collectionKind, bool allowed)
    {
        Item item = await SeedPictureItemAsync(Enum.Parse<ItemImageReviewState>(stateName), isPrivate: true);
        Collection collection = VisibilitySeed.AddCollection(DbContext, Owner, collectionKind == "public");
        VisibilitySeed.Link(DbContext, collection, item);
        await DbContext.SaveChangesAsync();

        using HttpResponseMessage response = await SendRawAsync(
            HttpMethod.Get, $"/collections/{collection.Id}/items/{item.Id}/images/question", token: TokenOf(caller));

        response.StatusCode.Should().Be(allowed ? HttpStatusCode.OK : HttpStatusCode.NotFound);
        if (!allowed)
        {
            (await response.Content.ReadAsByteArrayAsync()).Should().BeEmpty();
        }
        using HttpResponseMessage snapshot = await SendRawAsync(HttpMethod.Get, $"/collections/{collection.Id}/items/{item.Id}/images/question?expectedRevision={item.ImageRevision}", token: TokenOf(caller));
        snapshot.StatusCode.Should().Be(allowed ? HttpStatusCode.OK : HttpStatusCode.NotFound, "positive snapshot binding must preserve the exact route authorization");

    }

    [Fact]
    public async Task CollectionRoute_ItemNotInCollection_OrCollectionMissing_OrTextOnly_Is404()
    {
        Item inCollection = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        Item outside = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        Item textOnly = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        Collection collection = VisibilitySeed.AddCollection(DbContext, Owner, true);
        VisibilitySeed.Link(DbContext, collection, inCollection);
        VisibilitySeed.Link(DbContext, collection, textOnly);
        await DbContext.SaveChangesAsync();

        (await SendRawAsync(HttpMethod.Get, $"/collections/{collection.Id}/items/{inCollection.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await SendRawAsync(HttpMethod.Get, $"/collections/{collection.Id}/items/{outside.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await SendRawAsync(HttpMethod.Get, $"/collections/{Guid.NewGuid()}/items/{inCollection.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await SendRawAsync(HttpMethod.Get, $"/collections/{collection.Id}/items/{textOnly.Id}/images/question")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await SendRawAsync(HttpMethod.Get, $"/collections/{collection.Id}/items/{inCollection.Id}/images/explanation")).StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task MediaContentRoute_IsUnchanged_OwnerOrAdminOnly_EvenForAnApprovedPublicPicture()
    {
        Item item = await SeedPictureItemAsync(ItemImageReviewState.Approved, isPrivate: false);
        string path = $"/media/images/{item.QuestionImageAssetId}/content";

        (await SendRawAsync(HttpMethod.Get, path)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await SendRawAsync(HttpMethod.Get, path, token: OtherToken)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await SendRawAsync(HttpMethod.Get, path, token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.OK);
        (await SendRawAsync(HttpMethod.Get, path, token: AdminToken)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ---- read-path gate over HTTP -----------------------------------------------------------------------------------------

    [Theory]
    [InlineData("anonymous", "PendingReview", false)]
    [InlineData("other", "PendingReview", false)]
    [InlineData("anonymous", "Rejected", false)]
    [InlineData("other", "Withdrawn", false)]
    [InlineData("anonymous", "Approved", true)]
    [InlineData("other", "Approved", true)]
    [InlineData("owner", "PendingReview", true)]
    [InlineData("owner", "Rejected", true)]
    [InlineData("admin", "PendingReview", true)]
    public async Task GetItemById_AppliesTheGate_AndShowsImageReviewToCreatorAndAdminOnly(string caller, string stateName, bool visible)
    {
        Item item = await SeedPictureItemAsync(Enum.Parse<ItemImageReviewState>(stateName), isPrivate: false);

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, $"/items/{item.Id}", token: TokenOf(caller));

        status.Should().Be(visible ? HttpStatusCode.OK : HttpStatusCode.NotFound, body);
        if (visible)
        {
            JsonElement json = Json(body);
            json.GetProperty("questionImage").GetProperty("key").GetString().Should().Be($"media:{item.QuestionImageAssetId:N}");
            JsonElement review = json.GetProperty("imageReview");
            if (caller is "owner" or "admin")
            {
                review.GetProperty("state").GetString().Should().Be(stateName);
                review.GetProperty("revision").GetInt32().Should().Be(1);
            }
            else
            {
                review.ValueKind.Should().Be(JsonValueKind.Null);
            }
        }
        else
        {
            body.Should().NotContain(item.QuestionImageAssetId!.Value.ToString("N"));
        }
    }

    [Fact]
    public async Task GetItemById_TextOnlyAndCuratedItems_AreUnaffected_AndCarryNoImageReview()
    {
        Guid textOnly = await CreateAsync(Body(), OwnerToken);
        await SendAsync(HttpMethod.Put, $"/items/{textOnly}/visibility", "{\"isPrivate\":false}", AdminToken);
        Item curated = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        curated.QuestionImageKey = "curated:flags/fr";
        curated.QuestionImageAlt = "Three bands";
        await DbContext.SaveChangesAsync();

        foreach (Guid id in new[] { textOnly, curated.Id })
        {
            (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, $"/items/{id}");
            status.Should().Be(HttpStatusCode.OK, body);
            Json(body).GetProperty("imageReview").ValueKind.Should().Be(JsonValueKind.Null);
        }
    }

    [Fact]
    public async Task GetItems_ListRandomAndCollection_HideUnapprovedItemsFromEveryoneButTheCreator()
    {
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved, isPrivate: false);
        Item pending = await SeedPictureItemAsync(ItemImageReviewState.PendingReview, isPrivate: false);
        Item rejected = await SeedPictureItemAsync(ItemImageReviewState.Rejected, isPrivate: false);
        Item textOnly = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        Collection collection = VisibilitySeed.AddCollection(DbContext, Owner, true);
        foreach (Item item in new[] { approved, pending, rejected, textOnly })
        {
            VisibilitySeed.Link(DbContext, collection, item);
        }

        await DbContext.SaveChangesAsync();

        async Task<HashSet<Guid>> IdsAsync(string path, string? token)
        {
            (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, path, token: token);
            status.Should().Be(HttpStatusCode.OK, body);
            return Json(body).GetProperty("items").EnumerateArray().Select(i => Guid.Parse(i.GetProperty("id").GetString()!)).ToHashSet();
        }

        foreach (string? token in new[] { null, OtherToken, AdminToken })
        {
            (await IdsAsync("/items?category=geography&pageSize=50", token)).Should().BeEquivalentTo([approved.Id, textOnly.Id]);
            (await IdsAsync($"/items?collectionId={collection.Id}&pageSize=50", token)).Should().BeEquivalentTo([approved.Id, textOnly.Id]);
            (await IdsAsync("/items?category=geography&isRandom=true&pageSize=50", token)).Should().BeEquivalentTo([approved.Id, textOnly.Id]);
            (await IdsAsync("/items?isPrivate=false&pageSize=50", token)).Should().BeEquivalentTo([approved.Id, textOnly.Id]);
        }

        // The creator still sees their own pending and rejected items everywhere they already saw them.
        HashSet<Guid> all = [approved.Id, pending.Id, rejected.Id, textOnly.Id];
        (await IdsAsync("/items?category=geography&pageSize=50", OwnerToken)).Should().BeEquivalentTo(all);
        (await IdsAsync($"/items?collectionId={collection.Id}&pageSize=50", OwnerToken)).Should().BeEquivalentTo(all);
    }

    [Fact]
    public async Task GetCollectionById_ItemCount_ExcludesUnapprovedItemsForOthers_NotForTheCreator()
    {
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        Item pending = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        Collection collection = VisibilitySeed.AddCollection(DbContext, Owner, true);
        VisibilitySeed.Link(DbContext, collection, approved);
        VisibilitySeed.Link(DbContext, collection, pending);
        DbContext.CollectionItems.Add(new CollectionItem { Id = Guid.NewGuid(), CollectionId = collection.Id, ItemId = Guid.NewGuid() });
        await DbContext.SaveChangesAsync();

        async Task<int> CountAsync(string? token)
        {
            (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, $"/collections/{collection.Id}", token: token);
            status.Should().Be(HttpStatusCode.OK, body);
            return Json(body).GetProperty("itemCount").GetInt32();
        }

        (await CountAsync(null)).Should().Be(2, "the approved item and the dangling row; the pending item is hidden");
        (await CountAsync(OtherToken)).Should().Be(2);
        (await CountAsync(OwnerToken)).Should().Be(3);
    }

    [Fact]
    public async Task Export_OmitsUploadedPictures_KeepsCuratedOnes_AndSkipsUnapprovedItems()
    {
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved, isPrivate: false);
        Item pending = await SeedPictureItemAsync(ItemImageReviewState.PendingReview, isPrivate: false);
        Item curated = VisibilitySeed.AddItem(DbContext, _category, Owner, false);
        curated.Question = "Curated?";
        curated.QuestionImageKey = "curated:flags/fr";
        curated.QuestionImageAlt = "Three bands";
        await DbContext.SaveChangesAsync();

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/items/export?category=geography&acknowledgePictureLoss=true", token: OtherToken);

        status.Should().Be(HttpStatusCode.OK, body);
        JsonElement[] exported = Json(body).EnumerateArray().ToArray();
        exported.Select(e => e.GetProperty("question").GetString()).Should().NotContain(pending.Question);
        JsonElement picture = exported.Single(e => e.GetProperty("question").GetString() == approved.Question);
        picture.GetProperty("questionImage").ValueKind.Should().Be(JsonValueKind.Null);
        picture.GetProperty("omittedPictures").EnumerateArray().Should().NotBeEmpty("AC 3.27.4 lists foreign picture loss in the omittedPictures manifest");
        exported.Single(e => e.GetProperty("question").GetString() == "Curated?").GetProperty("questionImage").GetProperty("key").GetString()
            .Should().Be("curated:flags/fr");
        body.Should().NotContain("media:");
    }

    // ---- #401: rejection reason on owner/admin item reads --------------------------------------------------------------

    private const string RejectionReason = "Unclear source";

    private async Task SetRejectionReasonAsync(Guid itemId, string reason)
    {
        await using ApplicationDbContext db = CreateDbContext();
        await db.ItemImageReviews.Where(r => r.ItemId == itemId).ExecuteUpdateAsync(s => s.SetProperty(r => r.Reason, reason));
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("admin")]
    public async Task GetItems_RejectedItem_ShowsStateAndReasonToItsCreator_OwnerOrAdmin(string caller)
    {
        // The existing read gate hides unapproved items from everyone but their creator, so an admin sees the state in the list for their own items.
        string creator = caller == "owner" ? Owner : _adminId.ToString();
        Item rejected = await SeedPictureItemAsync(ItemImageReviewState.Rejected, isPrivate: false, creator: creator);
        await SetRejectionReasonAsync(rejected.Id, RejectionReason);

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/items?category=geography&pageSize=50", token: TokenOf(caller));

        status.Should().Be(HttpStatusCode.OK, body);
        JsonElement review = Json(body).GetProperty("items").EnumerateArray().Single().GetProperty("imageReview");
        review.GetProperty("state").GetString().Should().Be("Rejected");
        review.GetProperty("revision").GetInt32().Should().Be(1);
        review.GetProperty("reason").GetString().Should().Be(RejectionReason);
    }

    [Fact]
    public async Task GetItems_ReasonIsBatched_AndOnlyTheCurrentRevisionsReasonIsShown()
    {
        Item first = await SeedPictureItemAsync(ItemImageReviewState.Rejected);
        Item second = await SeedPictureItemAsync(ItemImageReviewState.Rejected);
        await SetRejectionReasonAsync(first.Id, "reason one");
        await SetRejectionReasonAsync(second.Id, "reason two");
        // A stale rejection of an earlier revision must never surface on the current revision.
        await using (ApplicationDbContext db = CreateDbContext())
        {
            db.ItemImageReviews.Add(new ItemImageReview
            {
                Id = Guid.NewGuid(), ItemId = first.Id, Revision = 0, ContentHash = new string('d', 64), SubmittedBy = Owner,
                SubmittedAt = DateTime.UtcNow, Decision = "Rejected", DecidedBy = "x", DecidedAt = DateTime.UtcNow, Reason = "old revision"
            });
            await db.SaveChangesAsync();
        }

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/items?category=geography&pageSize=50", token: OwnerToken);

        status.Should().Be(HttpStatusCode.OK, body);
        Dictionary<string, string?> reasons = Json(body).GetProperty("items").EnumerateArray().ToDictionary(
            i => i.GetProperty("id").GetString()!,
            i => i.GetProperty("imageReview").GetProperty("reason").GetString());
        reasons[first.Id.ToString()].Should().Be("reason one");
        reasons[second.Id.ToString()].Should().Be("reason two");
        body.Should().NotContain("old revision");
    }

    [Fact]
    public async Task GetItems_ReasonAndStateAreNotShownToOthers_IncludingTheCollectionIdPath()
    {
        Item approved = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        Item rejected = await SeedPictureItemAsync(ItemImageReviewState.Rejected);
        await SetRejectionReasonAsync(rejected.Id, RejectionReason);
        await SetRejectionReasonAsync(approved.Id, RejectionReason);
        Collection collection = VisibilitySeed.AddCollection(DbContext, Owner, true);
        VisibilitySeed.Link(DbContext, collection, approved);
        VisibilitySeed.Link(DbContext, collection, rejected);
        await DbContext.SaveChangesAsync();

        foreach (string? token in new[] { null, OtherToken })
        {
            foreach (string path in new[] { "/items?category=geography&pageSize=50", $"/items?collectionId={collection.Id}&pageSize=50" })
            {
                (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, path, token: token);
                status.Should().Be(HttpStatusCode.OK, body);
                body.Should().NotContain(RejectionReason);
                foreach (JsonElement item in Json(body).GetProperty("items").EnumerateArray())
                {
                    item.GetProperty("imageReview").ValueKind.Should().Be(JsonValueKind.Null);
                }
            }
        }

        (HttpStatusCode byId, string byIdBody) = await SendAsync(HttpMethod.Get, $"/items/{approved.Id}", token: OtherToken);
        byId.Should().Be(HttpStatusCode.OK, byIdBody);
        byIdBody.Should().NotContain(RejectionReason);
    }

    [Fact]
    public async Task GetItemById_RejectedItem_ShowsReasonToOwnerAndAdminOnly()
    {
        Item rejected = await SeedPictureItemAsync(ItemImageReviewState.Rejected);
        await SetRejectionReasonAsync(rejected.Id, RejectionReason);

        foreach (string caller in new[] { "owner", "admin" })
        {
            (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, $"/items/{rejected.Id}", token: TokenOf(caller));
            status.Should().Be(HttpStatusCode.OK, body);
            Json(body).GetProperty("imageReview").GetProperty("reason").GetString().Should().Be(RejectionReason);
        }

        (HttpStatusCode other, string otherBody) = await SendAsync(HttpMethod.Get, $"/items/{rejected.Id}", token: OtherToken);
        other.Should().Be(HttpStatusCode.NotFound);
        otherBody.Should().NotContain(RejectionReason);
    }

    [Fact]
    public async Task Put_ItemWhoseRejectedPicturesAreUnchanged_ReturnsTheReason()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset)));
        await DecideAsync(id, "reject", 1, "Wrong subject");

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset)), OwnerToken);

        status.Should().Be(HttpStatusCode.OK, body);
        JsonElement review = Json(body).GetProperty("imageReview");
        review.GetProperty("state").GetString().Should().Be("Rejected");
        review.GetProperty("reason").GetString().Should().Be("Wrong subject");
    }

    [Fact]
    public async Task WithdrawalRevokesEveryReferenceAndOldDeliveryAndCannotReattach()
    {
        MediaAsset asset = await AssetAsync();
        Item first = await SeedPictureItemAsync(ItemImageReviewState.Approved, question: asset);
        Item second = await SeedPictureItemAsync(ItemImageReviewState.Approved, question: asset);
        (await SendAsync(HttpMethod.Get, $"/items/{first.Id}/images/question")).Status.Should().Be(HttpStatusCode.OK);
        string request = $"{{\"itemId\":\"{first.Id}\",\"expectedRevision\":1,\"category\":\"privacy\"}}";
        (await SendAsync(HttpMethod.Post, $"/admin/media/{asset.Id}/withdraw", request, OtherToken)).Status.Should().Be(HttpStatusCode.Forbidden);
        var withdrawn = await SendAsync(HttpMethod.Post, $"/admin/media/{asset.Id}/withdraw", request, AdminToken);
        withdrawn.Status.Should().Be(HttpStatusCode.OK, withdrawn.Body);
        (await ItemAsync(first.Id)).ImageReviewState.Should().Be(ItemImageReviewState.Withdrawn);
        (await ItemAsync(second.Id)).ImageRevision.Should().Be(2);
        (await SendAsync(HttpMethod.Get, $"/items/{first.Id}/images/question")).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Get, $"/items/{second.Id}/images/question", token: OwnerToken)).Status.Should().Be(HttpStatusCode.NotFound);
        (await SendAsync(HttpMethod.Post, "/items", Body(question: "Cannot reuse?", questionImage: Pic(asset)), OwnerToken)).Status.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ReportsRequireVisibleExactRevisionAndDoNotWithdrawAutomatically()
    {
        Item item = await SeedPictureItemAsync(ItemImageReviewState.Approved);
        string report = "{\"slot\":\"question\",\"category\":\"privacy\",\"expectedRevision\":1}";
        (await SendAsync(HttpMethod.Post, $"/items/{item.Id}/image-reports", report)).Status.Should().Be(HttpStatusCode.Accepted);
        (await SendAsync(HttpMethod.Post, $"/items/{item.Id}/image-reports", report)).Status.Should().Be(HttpStatusCode.Accepted);
        await using ApplicationDbContext db = CreateDbContext();
        (await db.MediaReports.CountAsync()).Should().Be(1);
        (await ItemAsync(item.Id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        (await SendAsync(HttpMethod.Post, $"/items/{item.Id}/image-reports", report.Replace(":1", ":99"))).Status.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task LostSuccessCreateRetryUsesOneItemAndOneSubmission()
    {
        MediaAsset asset = await AssetAsync(); Guid key = Guid.NewGuid();
        string body = Body(questionImage: Pic(asset), extra: $",\"createRequestId\":\"{key}\"");
        var first = await SendAsync(HttpMethod.Post, "/items", body, OwnerToken);
        var second = await SendAsync(HttpMethod.Post, "/items", body, OwnerToken);
        first.Status.Should().Be(HttpStatusCode.Created, first.Body); second.Status.Should().Be(HttpStatusCode.Created, second.Body);
        Json(first.Body).GetProperty("id").GetString().Should().Be(Json(second.Body).GetProperty("id").GetString());
        (await DbContext.Items.CountAsync()).Should().Be(1); (await DbContext.ItemImageReviews.CountAsync()).Should().Be(1);
        (await SendAsync(HttpMethod.Post, "/items", body.Replace("Which flag?", "Different content?"), OwnerToken)).Status.Should().Be(HttpStatusCode.Conflict);
    }


    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SnapshotDeliveryNeverSubstitutesLaterApprovedRevision(bool replacement)
    {
        MediaAsset first = await AssetAsync(), second = replacement ? await AssetAsync() : first;
        Guid id = await CreateAsync(Body(questionImage: Pic(first)));
        await DecideAsync(id, "approve", 1);
        Collection collection = VisibilitySeed.AddCollection(DbContext, Owner, true);
        Item existing = await DbContext.Items.SingleAsync(x => x.Id == id);
        VisibilitySeed.Link(DbContext, collection, existing); await DbContext.SaveChangesAsync();
        string direct = $"/items/{id}/images/question", contextual = $"/collections/{collection.Id}/items/{id}/images/question";
        foreach (string route in new[] { direct, contextual })
            (await SendRawAsync(HttpMethod.Get, route + "?expectedRevision=1", token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.OK);
        var edited = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(question: "New context?", questionImage: Pic(second)), OwnerToken);
        edited.Status.Should().Be(HttpStatusCode.OK, edited.Body);
        await DecideAsync(id, "approve", 2);
        foreach (string route in new[] { direct, contextual })
        {
            (await SendRawAsync(HttpMethod.Get, route + "?expectedRevision=1", token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await SendRawAsync(HttpMethod.Get, route + "?expectedRevision=1", token: AdminToken)).StatusCode.Should().Be(HttpStatusCode.NotFound);
            (await SendRawAsync(HttpMethod.Get, route + "?expectedRevision=2", token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.OK);
            (await SendRawAsync(HttpMethod.Get, route, token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.OK, "legacy omitted revision remains explicit current GET");
            foreach (string invalid in new[] { "0", "-1", "bad", "" })
                (await SendRawAsync(HttpMethod.Get, route + "?expectedRevision=" + invalid, token: OwnerToken)).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }
    }

    [Fact]
    public async Task RationaleEditResubmitsPictureButUnchangedRationaleMetadataEditDoesNot()
    {
        MediaAsset asset = await AssetAsync();
        Guid id = await CreateAsync(Body(questionImage: Pic(asset), extra: ",\"incorrectAnswerRationale\":{\"0\":\"A different country\"}"));
        await DecideAsync(id, "approve", 1);
        var same = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset), extra: ",\"incorrectAnswerRationale\":{\"0\":\"A different country\"},\"source\":\"metadata only\""), OwnerToken);
        same.Status.Should().Be(HttpStatusCode.OK, same.Body);
        (await ItemAsync(id)).ImageRevision.Should().Be(1);
        var changed = await SendAsync(HttpMethod.Put, $"/items/{id}", Body(questionImage: Pic(asset), extra: ",\"incorrectAnswerRationale\":{\"0\":\"Revised reasoning\"}"), OwnerToken);
        changed.Status.Should().Be(HttpStatusCode.OK, changed.Body);
        Item saved = await ItemAsync(id); saved.ImageRevision.Should().Be(2); saved.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
    }

    [Fact]
    public async Task Bulk_ApprovesThePendingItems_AndReportsAStaleOneWithoutBlockingTheRest()
    {
        Item a = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        Item b = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        Item c = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        string body = $"{{\"decision\":\"approve\",\"items\":[{{\"id\":\"{a.Id}\",\"expectedRevision\":1}},{{\"id\":\"{b.Id}\",\"expectedRevision\":1}},{{\"id\":\"{c.Id}\",\"expectedRevision\":7}}]}}";

        (HttpStatusCode status, string response) = await SendAsync(HttpMethod.Post, "/admin/items/image-review/bulk", body, AdminToken);

        status.Should().Be(HttpStatusCode.OK, response);
        JsonElement result = Json(response);
        result.GetProperty("applied").GetInt32().Should().Be(2);
        result.GetProperty("failed").GetInt32().Should().Be(1);
        JsonElement results = result.GetProperty("results");
        results[0].GetProperty("applied").GetBoolean().Should().BeTrue();
        results[1].GetProperty("applied").GetBoolean().Should().BeTrue();
        results[2].GetProperty("applied").GetBoolean().Should().BeFalse();
        results[2].GetProperty("errorCode").GetString().Should().Be("Item.ImageReviewStale");
        (await ItemAsync(a.Id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        (await ItemAsync(b.Id)).ImageReviewState.Should().Be(ItemImageReviewState.Approved);
        (await ItemAsync(c.Id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
    }

    [Fact]
    public async Task Bulk_RejectWithoutAReason_Is400_AndChangesNothing()
    {
        Item a = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        string body = $"{{\"decision\":\"reject\",\"items\":[{{\"id\":\"{a.Id}\",\"expectedRevision\":1}}]}}";

        (HttpStatusCode status, string response) = await SendAsync(HttpMethod.Post, "/admin/items/image-review/bulk", body, AdminToken);

        status.Should().Be(HttpStatusCode.BadRequest, response);
        (await ItemAsync(a.Id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
    }

    [Fact]
    public async Task Bulk_MoreThan25Items_Is400()
    {
        string items = string.Join(",", Enumerable.Range(0, 26).Select(_ => $"{{\"id\":\"{Guid.NewGuid()}\",\"expectedRevision\":1}}"));

        (HttpStatusCode status, string response) = await SendAsync(
            HttpMethod.Post, "/admin/items/image-review/bulk", $"{{\"decision\":\"approve\",\"items\":[{items}]}}", AdminToken);

        status.Should().Be(HttpStatusCode.BadRequest, response);
    }

    [Fact]
    public async Task Bulk_IsAdminOnly()
    {
        Item a = await SeedPictureItemAsync(ItemImageReviewState.PendingReview);
        string body = $"{{\"decision\":\"approve\",\"items\":[{{\"id\":\"{a.Id}\",\"expectedRevision\":1}}]}}";

        (HttpStatusCode status, _) = await SendAsync(HttpMethod.Post, "/admin/items/image-review/bulk", body, OwnerToken);

        status.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
        (await ItemAsync(a.Id)).ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
    }
}
