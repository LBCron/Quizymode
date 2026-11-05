using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>
/// #363 over real HTTP with the production JWT policy and rate limiter: POST /study-guides/documents/quick requires
/// authentication, shares the create bucket, fails closed (503) before creating anything when generation is disabled, and
/// keeps every user's saved questions private to that user, including admins.
/// </summary>
public sealed class StudyGuideQuickHttpTests : ItemTestFixture, IAsyncLifetime
{
    private const string Notes = "Paris is the capital and most populous city of France.";
    private static readonly string[] AdminGroups = ["Admins"];

    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        await EnsureGeographyPublicWithNavAsync("seeder");
        IConfiguration configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Gemini:ApiKey"] = "gemini-test-key",
                ["OpenAI:ApiKey"] = "",
                ["OpenRouter:ApiKey"] = ""
            })
            .Build();

        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                new CreateStudyGuideDocument.FeatureRegistration().AddToServiceCollection(services, configuration);
                services.AddSingleton(StudyGuideTestData.Moderation());
                services.AddSingleton(TaxonomyRegistry);
                services.AddScoped<ITaxonomyItemCategoryResolver>(provider =>
                    new TaxonomyItemCategoryResolver(provider.GetRequiredService<ApplicationDbContext>(), TaxonomyRegistry));
                services.AddSingleton(SimHashService);
                services.AddHttpClient<IOpenAiCompatibleChatClient, OpenAiCompatibleChatClient>()
                    .ConfigurePrimaryHttpMessageHandler(() => new FakeVendorHandler((_, _) => throw new InvalidOperationException("No vendor calls in tests.")));
                services.Remove(services.Single(d => d.ImplementationType == typeof(StudyGuideGenerationWorker)));
            },
            app =>
            {
                new CreateStudyGuideDocument.Endpoint().MapEndpoint(app);
                new QuickStudyGuideDocument.Endpoint().MapEndpoint(app);
                new GetStudyGuideDocument.Endpoint().MapEndpoint(app);
                new GenerateStudyGuideSections.Endpoint().MapEndpoint(app);
                new AcceptStudyGuideCandidates.Endpoint().MapEndpoint(app);
            },
            useRateLimiting: true);
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private string Token(string subject) => _host.CreateToken(subject, $"{subject}@example.com");

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? token, HttpContent? content = null)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, content);
        return await _host.Client.SendAsync(request);
    }

    private static MultipartFormDataContent Form(string? text = Notes)
    {
        MultipartFormDataContent form = new()
        {
            { new StringContent("geography"), "category" },
            { new StringContent("capitals"), "navigationKeyword1" },
            { new StringContent("europe"), "navigationKeyword2" }
        };
        if (text is not null)
        {
            form.Add(new StringContent(text), "text");
        }

        return form;
    }

    private async Task<string> UserIdAsync(string subject)
    {
        await using ApplicationDbContext db = CreateDbContext();
        return (await db.Users.AsNoTracking().SingleAsync(u => u.Subject == subject)).Id.ToString();
    }

    private async Task CompleteAllGenerationsAsync()
    {
        await using ApplicationDbContext db = CreateDbContext();
        foreach (SectionGeneration generation in await db.SectionGenerations.Where(g => g.Status != SectionGenerationStatus.Completed).ToListAsync())
        {
            generation.Status = SectionGenerationStatus.Completed;
            generation.SourceText = null;
            generation.CompletedUtc = DateTime.UtcNow;
            db.GenerationCandidates.AddRange(StudyGuideTestData.Facts.Take(2).Select((fact, index) => new GenerationCandidate
            {
                Id = Guid.NewGuid(),
                GenerationId = generation.Id,
                Index = index,
                Question = fact.Question,
                CorrectAnswer = fact.Answer,
                IncorrectAnswersJson = "[\"Lyon\",\"Vienna\",\"Lisbon\"]",
                Explanation = "Because the guide says so.",
                SourceQuote = fact.Quote
            }));
        }

        await db.SaveChangesAsync();
    }

    /// <summary>Owner "owner-a" uploads <see cref="Notes"/> and generates it through the normal flow; the generation then completes.</summary>
    private async Task<StudyGuideDocumentContracts.Document> OwnerManuallyGeneratesAsync()
    {
        using HttpResponseMessage created = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner-a"), Form());
        StudyGuideDocumentContracts.Document document = (await created.Content.ReadFromJsonAsync<StudyGuideDocumentContracts.Document>())!;
        using HttpResponseMessage generate = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/generate", Token("owner-a"),
            JsonContent.Create(new { sectionIds = document.Sections.Select(section => section.Id) }));
        generate.StatusCode.Should().Be(HttpStatusCode.Accepted);
        await CompleteAllGenerationsAsync();
        return document;
    }

    [Fact]
    public async Task Quick_RequiresAuthentication()
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", null, Form());

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        await using ApplicationDbContext db = CreateDbContext();
        (await db.StudyGuideDocuments.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Quick_SharesTheCreateRateLimitBucket()
    {
        string token = Token("busy");
        for (int i = 0; i < 10; i++)
        {
            using HttpResponseMessage create = await SendAsync(HttpMethod.Post, "/study-guides/documents", token, Form(text: null));
            using HttpResponseMessage quick = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", token, Form(text: null));
            create.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            quick.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using HttpResponseMessage limited = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", token, Form(text: null));

        limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Quick_NewThenDuplicate_Returns201ThenAnIdempotent200()
    {
        using HttpResponseMessage first = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", Token("owner-a"), Form());
        string body = await first.Content.ReadAsStringAsync();
        using HttpResponseMessage second = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", Token("owner-a"), Form());

        first.StatusCode.Should().Be(HttpStatusCode.Created, body);
        using (JsonDocument json = JsonDocument.Parse(body))
        {
            json.RootElement.GetProperty("outcome").GetString().Should().Be("Generating");
            json.RootElement.GetProperty("chargedSections").GetInt32().Should().Be(1);
            json.RootElement.GetProperty("document").GetProperty("sections")[0].GetProperty("autoSave").GetString().Should().Be("Pending");
        }

        second.StatusCode.Should().Be(HttpStatusCode.OK);
        QuickStudyGuideDocument.Response again = (await second.Content.ReadFromJsonAsync<QuickStudyGuideDocument.Response>())!;
        again.Document.IsDuplicate.Should().BeTrue();
        again.ChargedSections.Should().Be(0);
    }

    [Fact]
    public async Task Quick_WhenGenerationIsDisabled_Returns503AndCreatesNothing()
    {
        await using (ApplicationDbContext db = CreateDbContext())
        {
            LlmProviderSettings settings = await LlmProviderSettingsStore.GetOrCreateAsync(db, CancellationToken.None);
            settings.RouteFree = LlmProviderSettingsStore.FormatRoute([LlmVendors.OpenRouter]);
            await db.SaveChangesAsync();
        }

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", Token("owner-a"), Form());

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        using JsonDocument problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        problem.RootElement.GetProperty("title").GetString().Should().Be("StudyGuideDocument.Disabled");
        await using ApplicationDbContext verify = CreateDbContext();
        (await verify.StudyGuideDocuments.CountAsync()).Should().Be(0);
        (await verify.StudyGuideQuotaCharges.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Quick_OnTextAnotherUserAlreadyGenerated_IsPrivateToTheCallerAndTouchesNothingOfTheOwners()
    {
        StudyGuideDocumentContracts.Document ownerDocument = await OwnerManuallyGeneratesAsync();

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", Token("user-b"), Form());
        string body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.Created, body);
        QuickStudyGuideDocument.Response quick = JsonSerializer.Deserialize<QuickStudyGuideDocument.Response>(body, JsonSerializerOptions.Web)!;
        quick.Outcome.Should().Be("Ready");
        quick.ChargedSections.Should().Be(0);
        string userB = await UserIdAsync("user-b");
        string owner = await UserIdAsync("owner-a");

        await using ApplicationDbContext db = CreateDbContext();
        List<Item> items = await db.Items.AsNoTracking().ToListAsync();
        items.Should().NotBeEmpty().And.OnlyContain(i => i.CreatedBy == userB && i.IsPrivate);
        Collection collection = await db.Collections.AsNoTracking().SingleAsync();
        collection.CreatedBy.Should().Be(userB);
        collection.IsPublic.Should().BeFalse();
        collection.IsDiscoverable.Should().BeFalse();
        (await db.CollectionItems.AsNoTracking().CountAsync(ci => ci.CollectionId == collection.Id)).Should().Be(items.Count);
        (await db.StudyGuideAcceptedCandidates.AsNoTracking().CountAsync(a => a.DocumentId == Guid.Parse(ownerDocument.Id))).Should().Be(0);
        (await db.StudyGuideSections.AsNoTracking().Where(s => s.DocumentId == Guid.Parse(ownerDocument.Id)).ToListAsync())
            .Should().OnlyContain(s => s.AutoSave == null);
        owner.Should().NotBe(userB);

        using HttpResponseMessage read = await SendAsync(HttpMethod.Get, $"/study-guides/documents/{ownerDocument.Id}", Token("user-b"));
        using HttpResponseMessage accept = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{ownerDocument.Id}/accept", Token("user-b"),
            JsonContent.Create(new { candidates = new[] { new { id = Guid.NewGuid() } } }));
        read.StatusCode.Should().Be(HttpStatusCode.NotFound);
        accept.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Quick_AsAnAdmin_StillSavesPrivateItems()
    {
        await OwnerManuallyGeneratesAsync();
        string adminToken = _host.CreateToken("admin-subject", "admin@example.com", AdminGroups);

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, "/study-guides/documents/quick", adminToken, Form());

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        string admin = await UserIdAsync("admin-subject");
        await using ApplicationDbContext db = CreateDbContext();
        (await db.Items.AsNoTracking().Where(i => i.CreatedBy == admin).ToListAsync()).Should().NotBeEmpty().And.OnlyContain(i => i.IsPrivate);
    }
}
