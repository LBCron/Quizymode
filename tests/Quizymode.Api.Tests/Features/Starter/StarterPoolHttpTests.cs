using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Features.Starter;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.Features.LearningLoop;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using Xunit.Abstractions;

namespace Quizymode.Api.Tests.Features.Starter;

/// <summary>#462 (AC 3.0.26): GET /starter-pool is anonymous, caller-independent, filtered and cacheable.</summary>
public sealed class StarterPoolHttpTests(ITestOutputHelper output) : DatabaseTestFixture, IAsyncLifetime
{
    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services => services.AddMemoryCache(),
            app => new StarterPool.Endpoint().MapEndpoint(app));
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private async Task<Item> AddStarterAsync(
        Category category,
        string world = "space",
        bool isPrivate = false,
        bool repoManaged = true,
        string wowLine = "A wow line.")
    {
        Item item = await LearningLoopTestData.AddItemAsync(DbContext, category, isPrivate);
        item.IsRepoManaged = repoManaged;
        item.StarterWorld = world;
        item.WowLine = wowLine;
        await DbContext.SaveChangesAsync();
        return item;
    }

    private async Task<(HttpResponseMessage Response, string Body)> GetPoolAsync(string? token = null)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Get, "/starter-pool", token);
        HttpResponseMessage response = await _host.Client.SendAsync(request);
        return (response, await response.Content.ReadAsStringAsync());
    }

    private static List<string> ItemIds(string body)
    {
        using JsonDocument document = JsonDocument.Parse(body);
        return document.RootElement.GetProperty("items").EnumerateArray()
            .Select(entry => entry.GetProperty("item").GetProperty("id").GetString()!)
            .ToList();
    }

    [Fact]
    public async Task Get_Anonymous_ReturnsEligibleStarterItemsWithWorldAndWowLine_AndPublicCacheControl()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Item eligible = await AddStarterAsync(category, "animals", wowLine: "Octopuses have three hearts.");

        (HttpResponseMessage response, string body) = await GetPoolAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        response.Headers.CacheControl!.Public.Should().BeTrue();
        response.Headers.CacheControl.MaxAge.Should().Be(TimeSpan.FromSeconds(300));
        response.Headers.GetValues("Cache-Control").Single().Should().Be("public, max-age=300");
        using JsonDocument document = JsonDocument.Parse(body);
        document.RootElement.GetProperty("version").GetString().Should().NotBeNullOrWhiteSpace();
        JsonElement entry = document.RootElement.GetProperty("items").EnumerateArray().Single();
        entry.GetProperty("item").GetProperty("id").GetString().Should().Be(eligible.Id.ToString());
        entry.GetProperty("item").GetProperty("category").GetString().Should().Be("trivia");
        entry.GetProperty("world").GetString().Should().Be("animals");
        entry.GetProperty("wowLine").GetString().Should().Be("Octopuses have three hearts.");
    }

    [Fact]
    public async Task Get_ExcludesPrivateNonRepoManagedPendingPictureFlaggedUnplayableAndNonStarterItems()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Item included = await AddStarterAsync(category);
        await AddStarterAsync(category, isPrivate: true);
        await AddStarterAsync(category, repoManaged: false);
        Item pendingPicture = await AddStarterAsync(category);
        pendingPicture.ImageReviewState = ItemImageReviewState.PendingReview;
        Item flagged = await AddStarterAsync(category);
        Item unplayable = await AddStarterAsync(category);
        unplayable.IncorrectAnswers = [];
        Item nonStarter = await LearningLoopTestData.AddItemAsync(DbContext, category);
        nonStarter.IsRepoManaged = true;
        for (int i = 0; i < 10; i++)
        {
            DbContext.AnalyticsEvents.Add(new AnalyticsEvent
            {
                Id = Guid.NewGuid(),
                EventName = AnalyticsEventCatalog.QuestionAnswered,
                SessionId = "s" + i,
                Path = "/",
                RunId = "r" + i,
                ItemId = flagged.Id,
                Position = 1,
                IsCorrect = false,
                OccurredUtc = DateTime.UtcNow.AddMinutes(-30)
            });
        }

        await DbContext.SaveChangesAsync();

        (HttpResponseMessage response, string body) = await GetPoolAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        ItemIds(body).Should().Equal(included.Id.ToString());
    }

    [Fact]
    public async Task Get_SignedInOwnerOfPrivateKeywordAndAnonymous_GetTheSameBodyWithoutThePrivateKeyword()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        User owner = new() { Id = Guid.NewGuid(), Subject = "owner-sub", Email = "owner@example.com", Name = "owner" };
        DbContext.Users.Add(owner);
        Item starter = await AddStarterAsync(category);
        Keyword publicKeyword = new() { Id = Guid.NewGuid(), Name = "publickw", IsPrivate = false, CreatedBy = "seed" };
        Keyword privateKeyword = new() { Id = Guid.NewGuid(), Name = "ownerprivatekw", IsPrivate = true, CreatedBy = owner.Id.ToString() };
        DbContext.Keywords.AddRange(publicKeyword, privateKeyword);
        DbContext.ItemKeywords.AddRange(
            new ItemKeyword { Id = Guid.NewGuid(), ItemId = starter.Id, KeywordId = publicKeyword.Id },
            new ItemKeyword { Id = Guid.NewGuid(), ItemId = starter.Id, KeywordId = privateKeyword.Id });
        await DbContext.SaveChangesAsync();
        string ownerToken = _host.CreateToken("owner-sub", "owner@example.com");

        // The owner goes first so a caller-dependent mapping would poison the shared cache for everyone after.
        (HttpResponseMessage ownerResponse, string ownerBody) = await GetPoolAsync(ownerToken);
        (HttpResponseMessage anonymousResponse, string anonymousBody) = await GetPoolAsync();

        ownerResponse.StatusCode.Should().Be(HttpStatusCode.OK, ownerBody);
        anonymousResponse.StatusCode.Should().Be(HttpStatusCode.OK, anonymousBody);
        ownerBody.Should().NotContain("ownerprivatekw");
        anonymousBody.Should().NotContain("ownerprivatekw");
        ownerBody.Should().Contain("publickw");
        anonymousBody.Should().Be(ownerBody);
    }

    [Fact]
    public async Task Get_RepeatedWithinCacheWindow_ServesTheCachedPool()
    {
        Category category = await LearningLoopTestData.AddCategoryAsync(DbContext, "trivia");
        Item first = await AddStarterAsync(category);
        (_, string firstBody) = await GetPoolAsync();
        await AddStarterAsync(category);

        (_, string secondBody) = await GetPoolAsync();

        ItemIds(firstBody).Should().Equal(first.Id.ToString());
        secondBody.Should().Be(firstBody, "the pool is cached for five minutes");
    }

    [Fact]
    public async Task Get_WithTheRealStarterContentSeeded_ServesEveryItemWithinThePayloadBudget()
    {
        string itemsRoot = FindItemsRoot();
        Dictionary<string, Category> categories = [];
        int expected = 0;
        foreach (string file in Directory.GetFiles(itemsRoot, "*.json", SearchOption.AllDirectories))
        {
            using JsonDocument document = JsonDocument.Parse(File.ReadAllText(file));
            foreach (JsonElement json in document.RootElement.EnumerateArray())
            {
                if (!json.TryGetProperty("starterWorld", out JsonElement world))
                {
                    continue;
                }

                string categoryName = json.GetProperty("category").GetString()!;
                if (!categories.TryGetValue(categoryName, out Category? category))
                {
                    category = await LearningLoopTestData.AddCategoryAsync(DbContext, categoryName);
                    categories[categoryName] = category;
                }

                Item item = new()
                {
                    Id = Guid.Parse(json.GetProperty("itemId").GetString()!),
                    IsRepoManaged = true,
                    Question = json.GetProperty("question").GetString()!,
                    CorrectAnswer = json.GetProperty("correctAnswer").GetString()!,
                    IncorrectAnswers = json.GetProperty("incorrectAnswers").EnumerateArray().Select(a => a.GetString()!).ToList(),
                    Explanation = json.GetProperty("explanation").GetString()!,
                    Source = json.GetProperty("source").GetString(),
                    FuzzySignature = "0",
                    CategoryId = category.Id,
                    CreatedBy = "seed",
                    StarterWorld = world.GetString(),
                    WowLine = json.GetProperty("wowLine").GetString()
                };
                if (json.TryGetProperty("questionImage", out JsonElement image))
                {
                    item.QuestionImageKey = image.GetProperty("key").GetString();
                    item.QuestionImageAlt = image.GetProperty("altText").GetString();
                }

                DbContext.Items.Add(item);
                expected++;
            }
        }

        await DbContext.SaveChangesAsync();

        (HttpResponseMessage response, string body) = await GetPoolAsync();

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        ItemIds(body).Should().HaveCount(expected);
        int bytes = System.Text.Encoding.UTF8.GetByteCount(body);
        output.WriteLine($"/starter-pool: {expected} items, {bytes} bytes uncompressed JSON");
        bytes.Should().BeLessThan(150_000);
    }

    private static string FindItemsRoot()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "data", "seed-source", "items")))
        {
            directory = directory.Parent;
        }

        return Path.Combine(directory?.FullName ?? throw new DirectoryNotFoundException("data/seed-source/items"), "data", "seed-source", "items");
    }
}
