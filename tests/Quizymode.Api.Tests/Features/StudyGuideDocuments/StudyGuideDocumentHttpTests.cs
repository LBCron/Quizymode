using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>
/// Over real HTTP with the production JWT/Admin policy: document endpoints require auth and are owner-only (404 for
/// others), multipart uploads work end to end, and the admin AI-provider endpoints are admin-only and validated. Vendor
/// keys are fake and no vendor is ever called (the generation worker is not hosted here).
/// </summary>
public sealed class StudyGuideDocumentHttpTests : ItemTestFixture, IAsyncLifetime
{
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
                new AdminLlmProviders.FeatureRegistration().AddToServiceCollection(services, configuration);
                services.AddSingleton(StudyGuideTestData.Moderation());
                services.AddSingleton(TaxonomyRegistry);
                services.AddScoped<ITaxonomyItemCategoryResolver>(provider =>
                    new TaxonomyItemCategoryResolver(provider.GetRequiredService<Quizymode.Api.Data.ApplicationDbContext>(), TaxonomyRegistry));
                services.AddSingleton(SimHashService);
                // Never reach a real vendor: the polling worker is removed and the vendor HttpClient is faked.
                services.AddHttpClient<Quizymode.Api.Features.StudyGuideDocuments.Generation.IOpenAiCompatibleChatClient, Quizymode.Api.Features.StudyGuideDocuments.Generation.OpenAiCompatibleChatClient>()
                    .ConfigurePrimaryHttpMessageHandler(() => new FakeVendorHandler((_, _) => throw new InvalidOperationException("No vendor calls in tests.")));
                ServiceDescriptor worker = services.Single(d => d.ImplementationType == typeof(Quizymode.Api.Features.StudyGuideDocuments.Generation.StudyGuideGenerationWorker));
                services.Remove(worker);
            },
            app =>
            {
                new GetStudyGuideDocumentConfig.Endpoint().MapEndpoint(app);
                new CreateStudyGuideDocument.Endpoint().MapEndpoint(app);
                new ListStudyGuideDocuments.Endpoint().MapEndpoint(app);
                new GetStudyGuideDocument.Endpoint().MapEndpoint(app);
                new GenerateStudyGuideSections.Endpoint().MapEndpoint(app);
                new AcceptStudyGuideCandidates.Endpoint().MapEndpoint(app);
                new AdminLlmProviders.Endpoint().MapEndpoint(app);
            });
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private string Token(string subject) => _host.CreateToken(subject, $"{subject}@example.com");

    private string AdminToken() => _host.CreateToken("admin-subject", "admin@example.com", AdminGroups);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? token, HttpContent? content = null)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, content);
        return await _host.Client.SendAsync(request);
    }

    private static MultipartFormDataContent Upload(byte[]? file = null, string? text = null, params string[] keywords)
    {
        MultipartFormDataContent form = new()
        {
            { new StringContent("geography"), "category" },
            { new StringContent("capitals"), "navigationKeyword1" },
            { new StringContent("europe"), "navigationKeyword2" }
        };
        if (file is not null)
        {
            ByteArrayContent fileContent = new(file);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            form.Add(fileContent, "file", "Capitals of Europe.pdf");
        }

        if (text is not null)
        {
            form.Add(new StringContent(text), "text");
        }

        foreach (string keyword in keywords)
        {
            form.Add(new StringContent(keyword), "keywords");
        }

        return form;
    }

    [Fact]
    public async Task Endpoints_RequireAuthentication()
    {
        using HttpResponseMessage config = await SendAsync(HttpMethod.Get, "/study-guides/documents/config", null);
        using HttpResponseMessage list = await SendAsync(HttpMethod.Get, "/study-guides/documents", null);
        using HttpResponseMessage create = await SendAsync(HttpMethod.Post, "/study-guides/documents", null, Upload(text: "Notes"));

        config.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        list.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        create.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task UploadPdf_ThenOwnerCanReadAndOthersGet404()
    {
        byte[] pdf = StudyGuideFixtures.Pdf(["Paris is the capital and most populous city of France."]);

        using HttpResponseMessage created = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"), Upload(pdf, null, "chapter-1", "extra,more"));
        string body = await created.Content.ReadAsStringAsync();
        created.StatusCode.Should().Be(HttpStatusCode.Created, body);
        StudyGuideDocumentContracts.Document document = JsonSerializer.Deserialize<StudyGuideDocumentContracts.Document>(body, JsonSerializerOptions.Web)!;
        document.Title.Should().Be("Capitals of Europe");
        document.FileType.Should().Be("pdf");
        document.Keywords.Should().Equal("chapter-1", "extra", "more");
        using (JsonDocument json = JsonDocument.Parse(body))
        {
            json.RootElement.TryGetProperty("isDuplicate", out _).Should().BeTrue("the wire format is camelCase");
            json.RootElement.GetProperty("sections")[0].GetProperty("status").GetString().Should().Be("New");
        }

        using HttpResponseMessage duplicate = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"), Upload(pdf));
        using HttpResponseMessage mine = await SendAsync(HttpMethod.Get, $"/study-guides/documents/{document.Id}", Token("owner"));
        using HttpResponseMessage theirs = await SendAsync(HttpMethod.Get, $"/study-guides/documents/{document.Id}", Token("stranger"));
        using HttpResponseMessage theirGenerate = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/generate", Token("stranger"),
            JsonContent.Create(new { sectionIds = new[] { document.Sections[0].Id } }));
        using HttpResponseMessage theirAccept = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/accept", Token("stranger"),
            JsonContent.Create(new { candidates = new[] { new { id = Guid.NewGuid() } } }));

        duplicate.StatusCode.Should().Be(HttpStatusCode.OK);
        (await duplicate.Content.ReadFromJsonAsync<StudyGuideDocumentContracts.Document>())!.IsDuplicate.Should().BeTrue();
        mine.StatusCode.Should().Be(HttpStatusCode.OK);
        theirs.StatusCode.Should().Be(HttpStatusCode.NotFound);
        theirGenerate.StatusCode.Should().Be(HttpStatusCode.NotFound);
        theirAccept.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Accept_PublishByNonAdmin_Returns403AndWritesNothing()
    {
        using HttpResponseMessage created = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"),
            Upload(text: "Paris is the capital and most populous city of France."));
        StudyGuideDocumentContracts.Document document = (await created.Content.ReadFromJsonAsync<StudyGuideDocumentContracts.Document>())!;
        using HttpResponseMessage generated = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/generate", Token("owner"),
            JsonContent.Create(new { sectionIds = new[] { document.Sections[0].Id } }));
        generated.StatusCode.Should().Be(HttpStatusCode.Accepted);

        // Complete the queued generation with a real candidate so the accept would succeed without the 403 gate.
        Guid candidateId = Guid.NewGuid();
        await using (Quizymode.Api.Data.ApplicationDbContext db = CreateDbContext())
        {
            Quizymode.Api.Shared.Models.SectionGeneration generation = db.SectionGenerations.Single();
            generation.Status = Quizymode.Api.Shared.Models.SectionGenerationStatus.Completed;
            generation.SourceText = null;
            generation.CompletedUtc = DateTime.UtcNow;
            db.GenerationCandidates.Add(new Quizymode.Api.Shared.Models.GenerationCandidate
            {
                Id = candidateId,
                GenerationId = generation.Id,
                Index = 0,
                Question = "What is the capital of France?",
                CorrectAnswer = "Paris",
                IncorrectAnswersJson = "[\"Lyon\",\"Vienna\",\"Lisbon\"]",
                Explanation = "Because the guide says so.",
                SourceQuote = "Paris is the capital and most populous city of France",
                Page = 1
            });
            await db.SaveChangesAsync();
        }

        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/accept", Token("owner"),
            JsonContent.Create(new { candidates = new[] { new { id = candidateId } }, publish = true }));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        DbContext.Items.Count().Should().Be(0);
        DbContext.Collections.Count().Should().Be(0);
        DbContext.StudyGuideAcceptedCandidates.Count().Should().Be(0);

        // Control: the same candidate without publish is accepted, proving the zero rows above came from the gate.
        using HttpResponseMessage control = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/accept", Token("owner"),
            JsonContent.Create(new { candidates = new[] { new { id = candidateId } } }));
        control.StatusCode.Should().Be(HttpStatusCode.OK, await control.Content.ReadAsStringAsync());
        DbContext.Items.Count().Should().Be(1);
    }

    [Fact]
    public async Task Accept_PublishByAdmin_IsNotForbidden()
    {
        using HttpResponseMessage created = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"),
            Upload(text: "Paris is the capital and most populous city of France."));
        StudyGuideDocumentContracts.Document document = (await created.Content.ReadFromJsonAsync<StudyGuideDocumentContracts.Document>())!;

        // The admin does not own the document, so the request passes the publish gate and then hits 404.
        using HttpResponseMessage response = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/accept", AdminToken(),
            JsonContent.Create(new { candidates = new[] { new { id = Guid.NewGuid() } }, publish = true }));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Generate_QueuesAndOverQuotaReturns429()
    {
        using HttpResponseMessage created = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"),
            Upload(text: "Paris is the capital and most populous city of France."));
        StudyGuideDocumentContracts.Document document = (await created.Content.ReadFromJsonAsync<StudyGuideDocumentContracts.Document>())!;

        using HttpResponseMessage accepted = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/generate", Token("owner"),
            JsonContent.Create(new { sectionIds = document.Sections.Select(section => section.Id) }));
        using HttpResponseMessage empty = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/generate", Token("owner"),
            JsonContent.Create(new { sectionIds = Array.Empty<string>() }));

        accepted.StatusCode.Should().Be(HttpStatusCode.Accepted);
        GenerateStudyGuideSections.Response response = (await accepted.Content.ReadFromJsonAsync<GenerateStudyGuideSections.Response>())!;
        response.ChargedSections.Should().Be(1);
        empty.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        await using (Quizymode.Api.Data.ApplicationDbContext db = CreateDbContext())
        {
            System.Guid owner = db.Users.Single(u => u.Subject == "owner").Id;
            db.UserSettings.Add(new Quizymode.Api.Shared.Models.UserSetting { Id = Guid.NewGuid(), UserId = owner, Key = "StudyGuideDailySections", Value = "0" });
            db.SectionGenerations.RemoveRange(db.SectionGenerations);
            foreach (Quizymode.Api.Shared.Models.StudyGuideSection section in db.StudyGuideSections)
            {
                section.GenerationId = null;
            }

            await db.SaveChangesAsync();
        }

        using HttpResponseMessage overQuota = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{document.Id}/generate", Token("owner"),
            JsonContent.Create(new { sectionIds = document.Sections.Select(section => section.Id) }));
        overQuota.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        using JsonDocument problem = JsonDocument.Parse(await overQuota.Content.ReadAsStringAsync());
        problem.RootElement.GetProperty("title").GetString().Should().Be("StudyGuideDocument.QuotaExceeded");
    }

    [Fact]
    public async Task Create_InvalidInput_Returns400()
    {
        using HttpResponseMessage unsupported = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"), Upload([0x00, 0x01, 0x02, 0x03, 0x04]));
        using HttpResponseMessage missingTopic = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token("owner"),
            new MultipartFormDataContent { { new StringContent("Some notes"), "text" } });

        unsupported.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using JsonDocument problem = JsonDocument.Parse(await unsupported.Content.ReadAsStringAsync());
        problem.RootElement.GetProperty("title").GetString().Should().Be("StudyGuideDocument.UnsupportedType");
        missingTopic.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Config_ReportsEnabledWhenAnyVendorKeyIsConfigured()
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/study-guides/documents/config", Token("owner"));

        GetStudyGuideDocumentConfig.Response config = (await response.Content.ReadFromJsonAsync<GetStudyGuideDocumentConfig.Response>())!;
        config.Enabled.Should().BeTrue();
        config.Quota.Tier.Should().Be("Free");
    }

    [Fact]
    public async Task AdminProviders_AreAdminOnly()
    {
        foreach (string path in new[] { "/admin/llm-providers", "/admin/llm-providers/attempts?days=7", "/admin/llm-providers/usage" })
        {
            using HttpResponseMessage anonymous = await SendAsync(HttpMethod.Get, path, null);
            using HttpResponseMessage member = await SendAsync(HttpMethod.Get, path, Token("member"));
            using HttpResponseMessage admin = await SendAsync(HttpMethod.Get, path, AdminToken());

            anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
            member.StatusCode.Should().Be(HttpStatusCode.Forbidden);
            admin.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using HttpResponseMessage memberPut = await SendAsync(HttpMethod.Put, "/admin/llm-providers", Token("member"),
            JsonContent.Create(new { vendors = Array.Empty<object>(), routes = new { free = new[] { "Gemini" }, premium = new[] { "OpenRouter" } } }));
        memberPut.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AdminProviders_GetReturnsDefaultsWithKeyStatusAndNeverKeys()
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/llm-providers", AdminToken());
        string body = await response.Content.ReadAsStringAsync();

        body.Should().NotContain("gemini-test-key");
        AdminLlmProviders.Response providers = JsonSerializer.Deserialize<AdminLlmProviders.Response>(body, JsonSerializerOptions.Web)!;
        providers.Vendors.Should().Equal(
            new AdminLlmProviders.VendorResponse("Gemini", true, "gemini-3.5-flash-lite", null),
            new AdminLlmProviders.VendorResponse("Groq", false, "openai/gpt-oss-120b", null),
            new AdminLlmProviders.VendorResponse("Cerebras", false, "gpt-oss-120b", null),
            new AdminLlmProviders.VendorResponse("OpenRouter", false, "google/gemma-4-31b-it:free", null),
            new AdminLlmProviders.VendorResponse("OpenAI", false, "gpt-5-nano", null));
        providers.Routes.Free.Should().Equal("Gemini", "Groq", "Cerebras", "OpenRouter", "OpenAI");
        providers.Routes.Premium.Should().Equal("OpenAI", "Gemini", "Cerebras", "Groq", "OpenRouter");
        body.Should().NotContain("DeepSeek");
        providers.MonthlySectionBudget.Should().Be(1000);
        providers.MonthlySectionsUsed.Should().Be(0);
    }

    [Fact]
    public async Task AdminProviders_PutUpdatesModelsAndRoutes()
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Put, "/admin/llm-providers", AdminToken(), JsonContent.Create(new
        {
            vendors = new[] { new { vendor = "openai", model = "gpt-5-mini" }, new { vendor = "Gemini", model = "models/gemini-2.5-flash" } },
            routes = new { free = new[] { "OpenAI" }, premium = new[] { "Gemini", "Groq", "Cerebras", "OpenRouter", "OpenAI" } }
        }));

        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        AdminLlmProviders.Response providers = (await response.Content.ReadFromJsonAsync<AdminLlmProviders.Response>())!;
        providers.Vendors.Single(v => v.Vendor == "OpenAI").Model.Should().Be("gpt-5-mini");
        providers.Vendors.Single(v => v.Vendor == "Gemini").Model.Should().Be("models/gemini-2.5-flash");
        providers.Vendors.Single(v => v.Vendor == "OpenRouter").Model.Should().Be("google/gemma-4-31b-it:free");
        providers.Routes.Free.Should().Equal("OpenAI");
        providers.Routes.Premium.Should().Equal("Gemini", "Groq", "Cerebras", "OpenRouter", "OpenAI");

        using HttpResponseMessage reread = await SendAsync(HttpMethod.Get, "/admin/llm-providers", AdminToken());
        (await reread.Content.ReadFromJsonAsync<AdminLlmProviders.Response>())!.Routes.Free.Should().Equal("OpenAI");
    }

    [Theory]
    [InlineData("Mistral", "model-1", "Gemini", "OpenAI")]
    [InlineData("DeepSeek", "deepseek-flash", "Gemini", "OpenAI")]
    [InlineData("OpenAI", "bad model!", "Gemini", "OpenAI")]
    [InlineData("OpenAI", "", "Gemini", "OpenAI")]
    [InlineData("OpenAI", "gpt-5-nano", "Gemini,Gemini", "OpenAI")]
    [InlineData("OpenAI", "gpt-5-nano", "", "OpenAI")]
    [InlineData("OpenAI", "gpt-5-nano", "Gemini,OpenAI,Groq,Gemini", "OpenAI")]
    [InlineData("OpenAI", "gpt-5-nano", "Gemini", "OpenAI,DeepSeek")]
    [InlineData("OpenAI", "gpt-5-nano", "Gemini", "Claude")]
    public async Task AdminProviders_PutValidatesVendorsModelsAndRoutes(string vendor, string model, string free, string premium)
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Put, "/admin/llm-providers", AdminToken(), JsonContent.Create(new
        {
            vendors = new[] { new { vendor, model } },
            routes = new
            {
                free = free.Split(',', StringSplitOptions.RemoveEmptyEntries),
                premium = premium.Split(',', StringSplitOptions.RemoveEmptyEntries)
            }
        }));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AdminProviders_PutRejectsModelOver100Characters()
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Put, "/admin/llm-providers", AdminToken(), JsonContent.Create(new
        {
            vendors = new[] { new { vendor = "OpenAI", model = new string('m', 101) } },
            routes = new { free = new[] { "OpenAI" }, premium = new[] { "OpenAI" } }
        }));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AdminAttempts_ListsNewestFirstWithinDays()
    {
        await using (Quizymode.Api.Data.ApplicationDbContext db = CreateDbContext())
        {
            DateTime now = DateTime.UtcNow;
            db.LlmAttempts.AddRange(
                new Quizymode.Api.Shared.Models.LlmAttempt { Id = Guid.NewGuid(), Vendor = "Gemini", Model = "g", Outcome = Quizymode.Api.Shared.Models.LlmAttemptOutcome.LowQuoteYield, DurationMs = 10, CreatedUtc = now.AddHours(-2) },
                new Quizymode.Api.Shared.Models.LlmAttempt { Id = Guid.NewGuid(), Vendor = "OpenAI", Model = "o", Outcome = Quizymode.Api.Shared.Models.LlmAttemptOutcome.Success, InputTokens = 5, OutputTokens = 6, DurationMs = 20, CreatedUtc = now.AddHours(-1) },
                new Quizymode.Api.Shared.Models.LlmAttempt { Id = Guid.NewGuid(), Vendor = "DeepSeek", Model = "d", Outcome = Quizymode.Api.Shared.Models.LlmAttemptOutcome.Timeout, DurationMs = 30, CreatedUtc = now.AddDays(-10) },
                new Quizymode.Api.Shared.Models.LlmAttempt { Id = Guid.NewGuid(), Vendor = "DeepSeek", Model = "d", Outcome = Quizymode.Api.Shared.Models.LlmAttemptOutcome.AuthError, DurationMs = 40, HttpStatus = 401, CreatedUtc = now.AddHours(-3) });
            await db.SaveChangesAsync();
        }

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/llm-providers/attempts?days=7", AdminToken());

        AdminLlmProviders.AttemptsResponse attempts = (await response.Content.ReadFromJsonAsync<AdminLlmProviders.AttemptsResponse>())!;
        attempts.Attempts.Select(a => (a.Vendor, a.Outcome)).Should().Equal(("OpenAI", "Success"), ("Gemini", "LowQuoteYield"), ("DeepSeek", "AuthError"));
        attempts.Attempts.Select(a => a.HttpStatus).Should().Equal(new int?[] { null, null, 401 });
        attempts.Attempts[0].InputTokens.Should().Be(5);
    }

    [Fact]
    public async Task Generate_PremiumUserWithoutKeyedPremiumRoute_Gets503AndNothingIsWritten_FreeUserGets202()
    {
        StudyGuideDocumentContracts.Document premiumDoc = await UploadTextAsync("premium-user", "Paris is the capital and most populous city of France.");
        StudyGuideDocumentContracts.Document freeDoc = await UploadTextAsync("free-user", "Berlin is the capital of Germany and its largest city by population.");
        await using (Quizymode.Api.Data.ApplicationDbContext db = CreateDbContext())
        {
            // The premium user resolves to a Guid user id with a StudyGuidePremium row; only Gemini has a key.
            System.Guid premiumUserId = db.Users.Single(u => u.Subject == "premium-user").Id;
            db.UserSettings.Add(new Quizymode.Api.Shared.Models.UserSetting { Id = Guid.NewGuid(), UserId = premiumUserId, Key = "StudyGuidePremium", Value = "true" });
            Quizymode.Api.Shared.Models.LlmProviderSettings settings = await Quizymode.Api.Features.StudyGuideDocuments.Generation.LlmProviderSettingsStore.GetOrCreateAsync(db, CancellationToken.None);
            settings.RoutePremium = "DeepSeek,OpenAI"; // a legacy route that still names DeepSeek loads fine
            settings.RouteFree = "Gemini";
            await db.SaveChangesAsync();
        }

        using HttpResponseMessage premiumConfig = await SendAsync(HttpMethod.Get, "/study-guides/documents/config", Token("premium-user"));
        using HttpResponseMessage freeConfig = await SendAsync(HttpMethod.Get, "/study-guides/documents/config", Token("free-user"));
        using HttpResponseMessage premiumGenerate = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{premiumDoc.Id}/generate", Token("premium-user"),
            JsonContent.Create(new { sectionIds = premiumDoc.Sections.Select(section => section.Id) }));

        (await premiumConfig.Content.ReadFromJsonAsync<GetStudyGuideDocumentConfig.Response>())!.Enabled.Should().BeFalse();
        (await freeConfig.Content.ReadFromJsonAsync<GetStudyGuideDocumentConfig.Response>())!.Enabled.Should().BeTrue();
        premiumGenerate.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        using JsonDocument problem = JsonDocument.Parse(await premiumGenerate.Content.ReadAsStringAsync());
        problem.RootElement.GetProperty("title").GetString().Should().Be("StudyGuideDocument.Disabled");
        await using (Quizymode.Api.Data.ApplicationDbContext db = CreateDbContext())
        {
            db.StudyGuideQuotaCharges.Count().Should().Be(0);
            db.SectionGenerations.Count().Should().Be(0);
        }

        using HttpResponseMessage freeGenerate = await SendAsync(HttpMethod.Post, $"/study-guides/documents/{freeDoc.Id}/generate", Token("free-user"),
            JsonContent.Create(new { sectionIds = freeDoc.Sections.Select(section => section.Id) }));
        freeGenerate.StatusCode.Should().Be(HttpStatusCode.Accepted);
    }

    private async Task<StudyGuideDocumentContracts.Document> UploadTextAsync(string subject, string text)
    {
        using HttpResponseMessage created = await SendAsync(HttpMethod.Post, "/study-guides/documents", Token(subject), Upload(text: text));
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        return (await created.Content.ReadFromJsonAsync<StudyGuideDocumentContracts.Document>())!;
    }

    [Theory]
    [InlineData("0")]
    [InlineData("91")]
    [InlineData("-1")]
    [InlineData("abc")]
    public async Task AdminUsage_RejectsInvalidDays(string days)
    {
        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, $"/admin/llm-providers/usage?days={days}", AdminToken());

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AdminUsage_DefaultsTo30Days_AndAcceptsTheBounds()
    {
        await using (Quizymode.Api.Data.ApplicationDbContext db = CreateDbContext())
        {
            DateTime now = DateTime.UtcNow;
            db.LlmAttempts.AddRange(
                new Quizymode.Api.Shared.Models.LlmAttempt { Id = Guid.NewGuid(), Vendor = "Gemini", Model = "g", Outcome = Quizymode.Api.Shared.Models.LlmAttemptOutcome.Success, InputTokens = 10, OutputTokens = 20, DurationMs = 100, CreatedUtc = now.AddDays(-20) },
                new Quizymode.Api.Shared.Models.LlmAttempt { Id = Guid.NewGuid(), Vendor = "Gemini", Model = "g", Outcome = Quizymode.Api.Shared.Models.LlmAttemptOutcome.Success, InputTokens = 1, OutputTokens = 2, DurationMs = 50, CreatedUtc = now.AddDays(-40) });
            await db.SaveChangesAsync();
        }

        using HttpResponseMessage response = await SendAsync(HttpMethod.Get, "/admin/llm-providers/usage", AdminToken());
        using HttpResponseMessage min = await SendAsync(HttpMethod.Get, "/admin/llm-providers/usage?days=1", AdminToken());
        using HttpResponseMessage max = await SendAsync(HttpMethod.Get, "/admin/llm-providers/usage?days=90", AdminToken());

        AdminLlmProviders.UsageResponse usage = (await response.Content.ReadFromJsonAsync<AdminLlmProviders.UsageResponse>())!;
        usage.Days.Should().Be(30);
        usage.Rows.Should().ContainSingle().Which.Attempts.Should().Be(1, "the 40-day-old attempt is outside the default window");
        (await min.Content.ReadFromJsonAsync<AdminLlmProviders.UsageResponse>())!.Rows.Should().BeEmpty();
        (await max.Content.ReadFromJsonAsync<AdminLlmProviders.UsageResponse>())!.Rows.Single().Attempts.Should().Be(2);
    }
}
