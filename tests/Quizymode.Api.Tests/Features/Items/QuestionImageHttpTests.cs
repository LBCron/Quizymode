using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.Add;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Features.Items.Export;
using Quizymode.Api.Features.Items.GetById;
using Quizymode.Api.Features.Items.Update;
using Quizymode.Api.Features.Items.UploadToCollection;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

/// <summary>#407/#403/#400: bulk and upload paths reject non-null picture fields (AC 2.1.20); POST and PUT take only asset ids (AC 3.25.2); PUT keeps omitted pictures; export includes curated ones (AC 2.2.7.10).</summary>
public sealed class QuestionImageHttpTests : ItemTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];
    private JwtHttpTestHost _host = null!;
    private Guid _ownerId;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddScoped<IValidator<AddItem.Request>, AddItem.Validator>();
                services.AddScoped<IValidator<AddItemsBulk.Request>, AddItemsBulk.Validator>();
                services.AddScoped<IValidator<UploadItemsToCollection.Request>, UploadItemsToCollection.Validator>();
                services.AddScoped<IValidator<UpdateItem.Request>, UpdateItem.Validator>();
                services.AddSingleton<ISimHashService>(SimHashService);
                services.AddSingleton(TaxonomyRegistry);
                services.AddScoped<ITaxonomyItemCategoryResolver>(sp =>
                    new TaxonomyItemCategoryResolver(sp.GetRequiredService<ApplicationDbContext>(), TaxonomyRegistry));
                Mock<ITextModerationService> moderation = new();
                moderation.Setup(m => m.Evaluate(It.IsAny<string?[]>()))
                    .Returns(new TextModerationResult(TextModerationOutcome.Clean));
                services.AddSingleton(moderation.Object);
            },
            app =>
            {
                new AddItem.Endpoint().MapEndpoint(app);
                new AddItemsBulk.Endpoint().MapEndpoint(app);
                new UploadItemsToCollection.Endpoint().MapEndpoint(app);
                new ExportItems.Endpoint().MapEndpoint(app);
                new UpdateItem.Endpoint().MapEndpoint(app);
                new GetItemById.Endpoint().MapEndpoint(app);
            });

        _ownerId = Guid.NewGuid();
        DbContext.Users.Add(new User { Id = _ownerId, Subject = "owner-sub", Email = "owner@example.com", Name = "owner" });
        await DbContext.SaveChangesAsync();
        await EnsureGeographyPublicWithNavAsync(_ownerId.ToString());
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private string UserToken => _host.CreateToken("owner-sub", "owner@example.com");

    private string AdminToken => _host.CreateToken("owner-sub", "owner@example.com", AdminGroups);

    private const string QuestionImageJson = "\"questionImage\":{\"key\":\"curated:flags/fr\",\"altText\":\"Three bands\"}";
    private const string ExplanationImageJson = "\"explanationImage\":{\"key\":\"curated:diagrams/x\",\"altText\":\"A diagram\"}";
    private const string BaseItemJson = "\"question\":\"Q?\",\"correctAnswer\":\"A\",\"incorrectAnswers\":[\"B\"],\"explanation\":\"\"";

    private async Task<(HttpStatusCode Status, string Body)> SendAsync(HttpMethod method, string path, string? json, string token)
    {
        using StringContent? content = json is null ? null : new StringContent(json, Encoding.UTF8, "application/json");
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, content);
        using HttpResponseMessage response = await _host.Client.SendAsync(request);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private Task<(HttpStatusCode Status, string Body)> CreateAsync(string path, string itemFields) => path switch
    {
        "add" => SendAsync(HttpMethod.Post, "/items",
            "{\"category\":\"geography\",\"navigationKeyword1\":\"capitals\",\"navigationKeyword2\":\"europe\",\"isPrivate\":false," + itemFields + "}",
            UserToken),
        "bulk" => SendAsync(HttpMethod.Post, "/items/bulk",
            "{\"isPrivate\":true,\"category\":\"geography\",\"keyword1\":\"capitals\",\"keyword2\":\"europe\",\"keywords\":[],\"items\":[{" + itemFields + "}]}",
            AdminToken),
        _ => SendAsync(HttpMethod.Post, "/items/upload-to-collection",
            "{\"category\":\"geography\",\"keyword1\":\"capitals\",\"keyword2\":\"europe\",\"keywords\":[],\"inputText\":\"qi-" + Guid.NewGuid() + "\",\"items\":[{" + itemFields + "}]}",
            UserToken)
    };

    public static TheoryData<string, string, string> RejectedPictureCases()
    {
        TheoryData<string, string, string> data = [];
        foreach (string path in new[] { "add", "bulk", "upload" })
        {
            data.Add(path, QuestionImageJson, "QuestionImage");
            data.Add(path, ExplanationImageJson, "ExplanationImage");
        }

        return data;
    }

    public static TheoryData<string> WritePaths => new() { "add", "bulk", "upload" };

    [Theory]
    [MemberData(nameof(RejectedPictureCases))]
    public async Task Create_WithPictureObject_Returns400NamingTheField_AndCreatesNothing(string path, string pictureJson, string field)
    {
        (HttpStatusCode status, string body) = await CreateAsync(path, BaseItemJson + "," + pictureJson);

        status.Should().Be(HttpStatusCode.BadRequest, body);
        // POST /items takes uploaded asset ids only (AC 3.25.2); the import paths take no pictures at all (AC 2.1.20).
        body.Should().Contain(field).And.Contain(path == "add" ? "assetId is required" : "Pictures can't be imported");
        using ApplicationDbContext db = CreateDbContext();
        (await db.Items.CountAsync()).Should().Be(0);
    }

    [Theory]
    [MemberData(nameof(WritePaths))]
    public async Task Create_WithNullPictureFields_IsAccepted(string path)
    {
        (HttpStatusCode status, string body) = await CreateAsync(
            path, BaseItemJson + ",\"questionImage\":null,\"explanationImage\":null");

        status.Should().BeOneOf([HttpStatusCode.OK, HttpStatusCode.Created], body);
        using ApplicationDbContext db = CreateDbContext();
        List<Item> saved = await db.Items.AsNoTracking().ToListAsync();
        saved.Should().ContainSingle();
        saved[0].QuestionImageKey.Should().BeNull();
        saved[0].ExplanationImageKey.Should().BeNull();
    }

    [Fact]
    public async Task Update_PreservesBothPictures_AndRejectsClearingExplanation()
    {
        Item picture = await CreateItemWithCategoryAsync(
            Guid.NewGuid(), "geography", "Which flag?", "France", ["Italy"], "Because", false, _ownerId.ToString());
        picture.QuestionImageKey = "curated:flags/fr";
        picture.QuestionImageAlt = "Three bands";
        picture.ExplanationImageKey = "curated:diagrams/x";
        picture.ExplanationImageAlt = "A diagram";
        await DbContext.SaveChangesAsync();

        string Put(string explanation) =>
            "{\"category\":\"geography\",\"navigationKeyword1\":\"capitals\",\"navigationKeyword2\":\"europe\",\"isPrivate\":false," +
            "\"question\":\"Which flag?\",\"correctAnswer\":\"France\",\"incorrectAnswers\":[\"Italy\"],\"explanation\":\"" + explanation + "\"}";

        (HttpStatusCode edited, string editedBody) = await SendAsync(HttpMethod.Put, $"/items/{picture.Id}", Put("Edited"), UserToken);
        edited.Should().Be(HttpStatusCode.OK, editedBody);

        // A curated key object is not an uploaded picture: PUT refuses it instead of silently ignoring it (AC 3.25.2).
        (HttpStatusCode keyed, string keyedBody) = await SendAsync(HttpMethod.Put, $"/items/{picture.Id}",
            Put("Edited").TrimEnd('}') + "," + QuestionImageJson.Replace("fr", "xx") + "}", UserToken);
        keyed.Should().Be(HttpStatusCode.BadRequest, keyedBody);
        keyedBody.Should().Contain("QuestionImage").And.Contain("assetId is required");

        (HttpStatusCode cleared, string clearedBody) = await SendAsync(HttpMethod.Put, $"/items/{picture.Id}", Put("   "), UserToken);
        cleared.Should().Be(HttpStatusCode.BadRequest, clearedBody);
        clearedBody.Should().Contain("Explanation can't be empty while the item has an explanation picture.");

        (HttpStatusCode fetched, string fetchedBody) = await SendAsync(HttpMethod.Get, $"/items/{picture.Id}", null, UserToken);
        fetched.Should().Be(HttpStatusCode.OK, fetchedBody);
        using JsonDocument doc = JsonDocument.Parse(fetchedBody);
        doc.RootElement.GetProperty("explanation").GetString().Should().Be("Edited");
        doc.RootElement.GetProperty("questionImage").GetProperty("key").GetString().Should().Be("curated:flags/fr");
        doc.RootElement.GetProperty("explanationImage").GetProperty("key").GetString().Should().Be("curated:diagrams/x");
    }

    [Fact]
    public async Task Export_IncludesQuestionImage_AndNullWhenAbsent()
    {
        Item picture = await CreateItemWithCategoryAsync(
            Guid.NewGuid(), "geography", "Which flag?", "France", ["Italy"], "x", false, _ownerId.ToString());
        picture.QuestionImageKey = "curated:flags/fr";
        picture.QuestionImageAlt = "Three bands";
        picture.ExplanationImageKey = "curated:diagrams/x";
        picture.ExplanationImageAlt = "A diagram";
        await CreateItemWithCategoryAsync(
            Guid.NewGuid(), "geography", "Capital of France?", "Paris", ["Lyon"], "x", false, _ownerId.ToString());
        await DbContext.SaveChangesAsync();

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/items/export?category=geography", null, UserToken);

        status.Should().Be(HttpStatusCode.OK, body);
        using JsonDocument doc = JsonDocument.Parse(body);
        JsonElement[] items = doc.RootElement.EnumerateArray().ToArray();
        items.Should().HaveCount(2);
        JsonElement withImage = items.Single(i => i.GetProperty("question").GetString() == "Which flag?");
        withImage.GetProperty("questionImage").GetProperty("key").GetString().Should().Be("curated:flags/fr");
        withImage.GetProperty("questionImage").GetProperty("altText").GetString().Should().Be("Three bands");
        JsonElement without = items.Single(i => i.GetProperty("question").GetString() == "Capital of France?");
        without.GetProperty("questionImage").ValueKind.Should().Be(JsonValueKind.Null);
        withImage.GetProperty("explanationImage").GetProperty("key").GetString().Should().Be("curated:diagrams/x");
        withImage.GetProperty("explanationImage").GetProperty("altText").GetString().Should().Be("A diagram");
        without.GetProperty("explanationImage").ValueKind.Should().Be(JsonValueKind.Null);
        body.Should().NotContain("http:").And.NotContain("data:").And.NotContain("storage");
    }
}
