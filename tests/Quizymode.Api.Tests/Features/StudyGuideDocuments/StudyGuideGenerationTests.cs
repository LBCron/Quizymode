using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>Queue claiming, leases, vendor routing and fallback, the quote check, and refunds.</summary>
public sealed class StudyGuideGenerationTests : DatabaseTestFixture
{
    private const string UserId = "user-a";

    private readonly TestClock _clock = new(new DateTime(2026, 10, 17, 12, 0, 0, DateTimeKind.Utc));

    private async Task<SectionGeneration> QueueAsync(
        StudyGuideTier tier = StudyGuideTier.Free,
        DateTime? notBefore = null,
        string text = StudyGuideTestData.SectionText,
        int charges = 1)
    {
        SectionGeneration generation = new()
        {
            Id = Guid.NewGuid(),
            TextSha256 = Guid.NewGuid().ToString("N"),
            Status = SectionGenerationStatus.Pending,
            Tier = tier,
            NotBeforeUtc = notBefore ?? _clock.UtcNow,
            SourceText = text,
            CreatedUtc = _clock.UtcNow,
            QueuedUtc = _clock.UtcNow
        };
        DbContext.SectionGenerations.Add(generation);
        for (int i = 0; i < charges; i++)
        {
            DbContext.StudyGuideQuotaCharges.Add(new StudyGuideQuotaCharge
            {
                Id = Guid.NewGuid(),
                UserId = UserId,
                SectionId = Guid.NewGuid(),
                GenerationId = generation.Id,
                ChargedUtc = _clock.UtcNow,
                Cost = 1
            });
        }

        await DbContext.SaveChangesAsync();
        return generation;
    }

    private StudyGuideGenerationQueue Queue(ApplicationDbContext? db = null) =>
        new(db ?? DbContext, MsOptions.Create(new StudyGuideGenerationOptions()), _clock);

    private async Task<SectionGeneration> ClaimAndProcessAsync(SectionGeneration generation, FakeVendorHandler handler, Microsoft.Extensions.Configuration.IConfiguration? keys = null)
    {
        List<Guid> claimed = await Queue().ClaimDueAsync(2, CancellationToken.None);
        claimed.Should().Contain(generation.Id);
        DbContext.ChangeTracker.Clear();
        await StudyGuideTestData.Processor(DbContext, handler, _clock, keys).ProcessAsync(generation.Id, CancellationToken.None);
        DbContext.ChangeTracker.Clear();
        return await DbContext.SectionGenerations.Include(g => g.Candidates).SingleAsync(g => g.Id == generation.Id);
    }

    private List<LlmAttempt> Attempts() => DbContext.LlmAttempts.AsNoTracking().OrderBy(a => a.CreatedUtc).ToList();

    [Fact]
    public async Task Queue_FreeJobIsNotDueUntilTheDelayPasses()
    {
        SectionGeneration generation = await QueueAsync(notBefore: _clock.UtcNow.AddMinutes(10));

        (await Queue().ClaimDueAsync(2, CancellationToken.None)).Should().BeEmpty();

        _clock.UtcNow = _clock.UtcNow.AddMinutes(10);
        (await Queue().ClaimDueAsync(2, CancellationToken.None)).Should().Equal(generation.Id);

        DbContext.ChangeTracker.Clear();
        SectionGeneration claimed = await DbContext.SectionGenerations.SingleAsync();
        claimed.Status.Should().Be(SectionGenerationStatus.Processing);
        claimed.Attempts.Should().Be(1);
        claimed.LeaseUntilUtc.Should().Be(_clock.UtcNow.AddMinutes(5));
    }

    [Fact]
    public async Task Queue_ClaimsPremiumFirstAndAtMostTheBatchSize()
    {
        SectionGeneration free1 = await QueueAsync(notBefore: _clock.UtcNow.AddMinutes(-30));
        SectionGeneration free2 = await QueueAsync(notBefore: _clock.UtcNow.AddMinutes(-20));
        SectionGeneration premium = await QueueAsync(StudyGuideTier.Premium);

        List<Guid> claimed = await Queue().ClaimDueAsync(2, CancellationToken.None);

        claimed.Should().Equal(premium.Id, free1.Id);
        (await Queue().ClaimDueAsync(2, CancellationToken.None)).Should().Equal(free2.Id);
        (await Queue().ClaimDueAsync(2, CancellationToken.None)).Should().BeEmpty("claimed jobs hold an active lease");
    }

    [Fact]
    public async Task Queue_ReclaimsJobsWhoseLeaseExpired()
    {
        SectionGeneration generation = await QueueAsync();
        await Queue().ClaimDueAsync(2, CancellationToken.None);

        _clock.UtcNow = _clock.UtcNow.AddMinutes(4);
        (await Queue().ClaimDueAsync(2, CancellationToken.None)).Should().BeEmpty();

        _clock.UtcNow = _clock.UtcNow.AddMinutes(2);
        (await Queue().ClaimDueAsync(2, CancellationToken.None)).Should().Equal(generation.Id);
        DbContext.ChangeTracker.Clear();
        (await DbContext.SectionGenerations.SingleAsync()).Attempts.Should().Be(2);
    }

    [Fact]
    public async Task Processor_AfterMaxAttempts_FailsAndRefunds()
    {
        SectionGeneration generation = await QueueAsync(charges: 2);
        for (int attempt = 0; attempt < 4; attempt++)
        {
            await Queue().ClaimDueAsync(2, CancellationToken.None);
            _clock.UtcNow = _clock.UtcNow.AddMinutes(6);
        }

        DbContext.ChangeTracker.Clear();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));
        await StudyGuideTestData.Processor(DbContext, handler, _clock).ProcessAsync(generation.Id, CancellationToken.None);

        DbContext.ChangeTracker.Clear();
        SectionGeneration failed = await DbContext.SectionGenerations.SingleAsync();
        failed.Attempts.Should().Be(4);
        failed.Status.Should().Be(SectionGenerationStatus.Failed);
        handler.Requests.Should().BeEmpty();
        (await DbContext.StudyGuideQuotaCharges.AnyAsync()).Should().BeFalse("failed generations are refunded");
    }

    [Fact]
    public async Task Processor_FreeRouteTriesGeminiFirstAndSavesVerifiedCandidates()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson(supported: 4, unsupported: 1)));

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        handler.Vendors.Should().Equal(LlmVendors.Gemini);
        (HttpRequestMessage request, string body) = (handler.Requests[0].Request, handler.Requests[0].Body);
        request.RequestUri!.ToString().Should().Be("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
        request.Headers.Authorization!.Parameter.Should().Be("gemini-test-key");
        using (JsonDocument json = JsonDocument.Parse(body))
        {
            json.RootElement.GetProperty("model").GetString().Should().Be("gemini-3.5-flash-lite");
            json.RootElement.GetProperty("response_format").GetProperty("type").GetString().Should().Be("json_object");
            json.RootElement.GetProperty("temperature").GetDouble().Should().Be(0.2);
            json.RootElement.GetProperty("max_tokens").GetInt32().Should().Be(8000);
        }

        completed.Status.Should().Be(SectionGenerationStatus.Completed);
        completed.Vendor.Should().Be(LlmVendors.Gemini);
        completed.Model.Should().Be("gemini-3.5-flash-lite");
        completed.InputTokens.Should().Be(1200);
        completed.OutputTokens.Should().Be(800);
        completed.DroppedCount.Should().Be(1);
        completed.SourceText.Should().BeNull();
        completed.LeaseUntilUtc.Should().BeNull();
        completed.Candidates.OrderBy(c => c.Index).Select(c => c.CorrectAnswer).Should().Equal("Paris", "Berlin", "Madrid", "Rome");
        Attempts().Should().ContainSingle().Which.Outcome.Should().Be(LlmAttemptOutcome.Success);
        (await DbContext.StudyGuideQuotaCharges.CountAsync()).Should().Be(1, "successful generations keep their charges");
    }

    [Fact]
    public async Task Processor_PremiumRouteTriesOpenAiFirst()
    {
        SectionGeneration generation = await QueueAsync(StudyGuideTier.Premium);
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        handler.Vendors.Should().Equal(LlmVendors.OpenAI);
        handler.Requests[0].Request.RequestUri!.ToString().Should().Be("https://api.openai.com/v1/chat/completions");
        completed.Model.Should().Be("gpt-5-nano");
    }

    [Fact]
    public async Task Processor_SkipsVendorsWithoutKeys()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler, StudyGuideTestData.Keys(openRouter: true, openAi: false, gemini: false));

        handler.Vendors.Should().Equal(LlmVendors.OpenRouter);
        completed.Vendor.Should().Be(LlmVendors.OpenRouter);
    }

    [Fact]
    public async Task Processor_LogsOneAttemptLinePerVendorWithOutcomeAndHttpStatus()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => vendor == LlmVendors.Gemini
            ? FakeVendorHandler.Status(HttpStatusCode.NotFound)
            : FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));
        CapturingLoggerProvider logs = new();
        using ILoggerFactory loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(logs));
        await Queue().ClaimDueAsync(2, CancellationToken.None);
        DbContext.ChangeTracker.Clear();

        await StudyGuideTestData.Processor(DbContext, handler, _clock, logger: loggerFactory.CreateLogger<SectionGenerationProcessor>())
            .ProcessAsync(generation.Id, CancellationToken.None);

        List<CapturingLoggerProvider.CapturedLog> attemptLines = logs.Entries.Where(e => e.Message.Contains(" attempt with ")).ToList();
        attemptLines.Should().HaveCount(2);
        attemptLines[0].Level.Should().Be(LogLevel.Warning);
        attemptLines[0].Message.Should().Contain($"attempt with {LlmVendors.Gemini} (")
            .And.Contain("ended ProviderError")
            .And.Contain("HTTP 404");
        attemptLines[1].Level.Should().Be(LogLevel.Information);
        attemptLines[1].Message.Should().Contain("ended Success").And.Contain("HTTP 200").And.Contain(" ms, tokens in ");
    }

    [Fact]
    public async Task Processor_WarnsOncePerGenerationWhenRouteVendorsHaveNoKey()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));
        CapturingLoggerProvider logs = new();
        // Debug is captured here: the skipped-vendor line is Debug in production (#490).
        using ILoggerFactory loggerFactory = LoggerFactory.Create(builder => builder.SetMinimumLevel(LogLevel.Debug).AddProvider(logs));
        await Queue().ClaimDueAsync(2, CancellationToken.None);
        DbContext.ChangeTracker.Clear();

        await StudyGuideTestData.Processor(
                DbContext,
                handler,
                _clock,
                StudyGuideTestData.Keys(openRouter: true, openAi: false, gemini: false),
                logger: loggerFactory.CreateLogger<SectionGenerationProcessor>())
            .ProcessAsync(generation.Id, CancellationToken.None);

        CapturingLoggerProvider.CapturedLog skipped = logs.Entries.Should().ContainSingle(e => e.Message.Contains("skipped vendor(s) without a key")).Subject;
        skipped.Level.Should().Be(LogLevel.Debug);
        skipped.Message.Should().Contain($"{LlmVendors.Gemini}, {LlmVendors.Groq}, {LlmVendors.Cerebras}, {LlmVendors.OpenAI}");
    }

    [Fact]
    public async Task Processor_FallsBackOnProviderErrorAndTimeout()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => vendor switch
        {
            LlmVendors.Gemini => FakeVendorHandler.Status(HttpStatusCode.InternalServerError),
            LlmVendors.OpenRouter => throw new TaskCanceledException("timeout"),
            _ => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson())
        });

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        handler.Vendors.Should().Equal(LlmVendors.Gemini, LlmVendors.OpenRouter, LlmVendors.OpenAI);
        completed.Vendor.Should().Be(LlmVendors.OpenAI);
        Attempts().Select(a => (a.Vendor, a.Outcome, a.HttpStatus)).Should().Equal(
            (LlmVendors.Gemini, LlmAttemptOutcome.ProviderError, (int?)500),
            (LlmVendors.OpenRouter, LlmAttemptOutcome.Timeout, (int?)null),
            (LlmVendors.OpenAI, LlmAttemptOutcome.Success, (int?)200));
        Attempts().Should().OnlyContain(a => a.GenerationId == generation.Id);
    }

    [Fact]
    public async Task Processor_AuthErrorFallsThroughToNextVendor()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => vendor switch
        {
            LlmVendors.Gemini => FakeVendorHandler.Status(HttpStatusCode.Unauthorized),
            LlmVendors.OpenRouter => FakeVendorHandler.Json(HttpStatusCode.Forbidden, "{\"error\":{\"message\":\"Request blocked: restricted API key\"}}"),
            _ => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson())
        });

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        handler.Vendors.Should().Equal(LlmVendors.Gemini, LlmVendors.OpenRouter, LlmVendors.OpenAI);
        completed.Status.Should().Be(SectionGenerationStatus.Completed);
        completed.Vendor.Should().Be(LlmVendors.OpenAI);
        Attempts().Select(a => (a.Outcome, a.HttpStatus)).Should().Equal(
            (LlmAttemptOutcome.AuthError, (int?)401),
            (LlmAttemptOutcome.AuthError, (int?)403),
            (LlmAttemptOutcome.Success, (int?)200));
    }

    [Fact]
    public async Task Processor_RegionBlock403IsProviderErrorAndFallsThrough()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => vendor == LlmVendors.Gemini
            ? FakeVendorHandler.Json(HttpStatusCode.Forbidden, "{\"error\":{\"code\":403,\"message\":\"User location is not supported for the API use.\",\"status\":\"PERMISSION_DENIED\"}}")
            : FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        handler.Vendors.Should().Equal(LlmVendors.Gemini, LlmVendors.OpenRouter);
        completed.Status.Should().Be(SectionGenerationStatus.Completed);
        Attempts().Select(a => (a.Outcome, a.HttpStatus)).Should().Equal(
            (LlmAttemptOutcome.ProviderError, (int?)403),
            (LlmAttemptOutcome.Success, (int?)200));
    }

    [Fact]
    public async Task Processor_FallsBackOnContentFilterAndInvalidJson()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => vendor switch
        {
            LlmVendors.Gemini => FakeVendorHandler.Completion("", "content_filter"),
            LlmVendors.OpenRouter => FakeVendorHandler.Completion("Sure! Here are your questions."),
            _ => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson())
        });

        await ClaimAndProcessAsync(generation, handler);

        Attempts().Select(a => a.Outcome).Should().Equal(
            LlmAttemptOutcome.ContentFilter,
            LlmAttemptOutcome.InvalidJson,
            LlmAttemptOutcome.Success);
    }

    [Fact]
    public async Task Processor_LowQuoteYieldFallsBackToTheNextVendor()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => vendor == LlmVendors.Gemini
            ? FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson(supported: 1, unsupported: 3))
            : FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson(supported: 3, unsupported: 1)));

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        Attempts().Select(a => a.Outcome).Should().Equal(LlmAttemptOutcome.LowQuoteYield, LlmAttemptOutcome.Success);
        completed.Vendor.Should().Be(LlmVendors.OpenRouter);
        completed.Candidates.Should().HaveCount(3);
        completed.DroppedCount.Should().Be(1);
    }

    [Fact]
    public async Task Processor_WhenEveryVendorIsLowYield_KeepsTheBestVerifiedResult()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((vendor, _) => FakeVendorHandler.Completion(vendor == LlmVendors.OpenAI
            ? StudyGuideTestData.QuestionsJson(supported: 2, unsupported: 3)
            : StudyGuideTestData.QuestionsJson(supported: 1, unsupported: 3)));

        SectionGeneration completed = await ClaimAndProcessAsync(generation, handler);

        Attempts().Should().HaveCount(3).And.OnlyContain(a => a.Outcome == LlmAttemptOutcome.LowQuoteYield);
        completed.Status.Should().Be(SectionGenerationStatus.Completed);
        completed.Vendor.Should().Be(LlmVendors.OpenAI);
        completed.Candidates.Should().HaveCount(2);
    }

    [Fact]
    public async Task Processor_AllVendorsFail_MarksFailedWithSafeErrorAndRefunds()
    {
        SectionGeneration generation = await QueueAsync(charges: 3);
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Status(HttpStatusCode.ServiceUnavailable));

        SectionGeneration failed = await ClaimAndProcessAsync(generation, handler);

        handler.Requests.Should().HaveCount(3);
        failed.Status.Should().Be(SectionGenerationStatus.Failed);
        failed.Error.Should().Be(SectionGenerationProcessor.FailureMessage);
        failed.Error.Should().NotContain("boom");
        failed.SourceText.Should().BeNull();
        failed.Candidates.Should().BeEmpty();
        (await DbContext.StudyGuideQuotaCharges.AnyAsync()).Should().BeFalse();
        Attempts().Should().HaveCount(3).And.OnlyContain(a => a.Outcome == LlmAttemptOutcome.ProviderError);
    }

    [Fact]
    public async Task Processor_UsesAdminRoutesAndModels()
    {
        DbContext.LlmProviderSettings.Add(new LlmProviderSettings
        {
            Id = LlmProviderSettings.SingletonId,
            Models = new Dictionary<string, string> { [LlmVendors.OpenAI] = "gpt-4.1-mini", [LlmVendors.Gemini] = "gemini-x" },
            RouteFree = "OpenAI",
            RoutePremium = "OpenAI",
            UpdatedUtc = _clock.UtcNow
        });
        await DbContext.SaveChangesAsync();
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Status(HttpStatusCode.BadGateway));

        await ClaimAndProcessAsync(generation, handler);

        handler.Vendors.Should().Equal(LlmVendors.OpenAI);
        using JsonDocument json = JsonDocument.Parse(handler.Requests[0].Body);
        json.RootElement.GetProperty("model").GetString().Should().Be("gpt-4.1-mini");
        json.RootElement.TryGetProperty("max_tokens", out _).Should().BeTrue("non-reasoning OpenAI models keep max_tokens");
    }

    [Fact]
    public async Task Processor_SkipsJobsThatAreNotProcessing()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));

        await StudyGuideTestData.Processor(DbContext, handler, _clock).ProcessAsync(generation.Id, CancellationToken.None);

        handler.Requests.Should().BeEmpty("only claimed (Processing) jobs are processed");
    }

    [Fact]
    public void ChatClient_OpenAiReasoningModelsUseMaxCompletionTokensWithoutTemperature()
    {
        ChatCompletionRequest request = new("system", "user", 8000, 0.2);

        System.Text.Json.Nodes.JsonObject reasoning = OpenAiCompatibleChatClient.BuildRequestBody(Endpoint(LlmVendors.OpenAI), "gpt-5-nano", request);
        System.Text.Json.Nodes.JsonObject openRouter = OpenAiCompatibleChatClient.BuildRequestBody(Endpoint(LlmVendors.OpenRouter), "google/gemma-4-31b-it:free", request);

        reasoning.ContainsKey("max_completion_tokens").Should().BeTrue();
        reasoning.ContainsKey("temperature").Should().BeFalse();
        reasoning.ContainsKey("max_tokens").Should().BeFalse();
        openRouter["max_tokens"]!.GetValue<int>().Should().Be(8000);
        openRouter["temperature"]!.GetValue<double>().Should().Be(0.2);
    }

    [Theory]
    [InlineData("gpt-5-nano", "minimal")]
    [InlineData("gpt-5-mini", "minimal")]
    [InlineData("o4-mini", "low")]
    public void BuildRequestBody_SetsTheLowestReasoningEffortForOpenAiReasoningModels(string model, string expected)
    {
        ChatCompletionRequest request = new("system", "user", 8000, 0.2);

        System.Text.Json.Nodes.JsonObject body = OpenAiCompatibleChatClient.BuildRequestBody(Endpoint(LlmVendors.OpenAI), model, request);

        body["reasoning_effort"]!.GetValue<string>().Should().Be(expected);
    }

    [Theory]
    [InlineData("OpenRouter", "google/gemma-4-31b-it:free")]
    [InlineData("Gemini", "gemini-3.5-flash-lite")]
    [InlineData("OpenAI", "gpt-4o-mini")]
    public void BuildRequestBody_OmitsReasoningEffortForNonReasoningModels(string vendor, string model)
    {
        ChatCompletionRequest request = new("system", "user", 8000, 0.2);

        System.Text.Json.Nodes.JsonObject body = OpenAiCompatibleChatClient.BuildRequestBody(Endpoint(vendor), model, request);

        body.ContainsKey("reasoning_effort").Should().BeFalse();
    }

    [Fact]
    public void ErrorExcerpt_CollapsesWhitespaceAndTruncatesLongBodies()
    {
        string multiLine = "[{\n  \"error\": {\n    \"code\": 400,\n    \"message\": \"API key not valid.\"\n  }\n}]";
        string longBody = new('x', 1000);

        OpenAiCompatibleChatClient.ErrorExcerpt(multiLine)
            .Should().Be("[{ \"error\": { \"code\": 400, \"message\": \"API key not valid.\" } }]");
        string excerpt = OpenAiCompatibleChatClient.ErrorExcerpt(longBody);
        excerpt.Should().HaveLength(301);
        excerpt.Should().EndWith("…");
    }

    [Fact]
    public void VendorRegistry_ReadsKeysFromConfigurationAndEnvironmentNames()
    {
        LlmVendorRegistry registry = new(new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["OPENAI_API_KEY"] = "from-env",
                ["Gemini:ApiKey"] = " ",
                ["OpenRouter:BaseUrl"] = "https://openrouter.test/v1"
            })
            .Build());

        registry.IsConfigured(LlmVendors.OpenAI).Should().BeTrue();
        registry.IsConfigured(LlmVendors.Gemini).Should().BeFalse();
        registry.IsConfigured(LlmVendors.OpenRouter).Should().BeFalse();
        registry.Get(LlmVendors.OpenRouter).BaseUrl.Should().Be("https://openrouter.test/v1");
        registry.Get(LlmVendors.Groq).BaseUrl.Should().Be("https://api.groq.com/openai/v1");
        registry.Get(LlmVendors.Groq).MaxTokens.Should().Be(LlmVendorRegistry.DefaultGroqMaxTokens);
        registry.Get(LlmVendors.Cerebras).BaseUrl.Should().Be("https://api.cerebras.ai/v1");
        LlmVendors.Normalize("DeepSeek").Should().BeNull("DeepSeek is retired (#464)");
        registry.Get(LlmVendors.OpenAI).ToString().Should().NotContain("from-env", "keys never appear in ToString/logs");
    }

    [Fact]
    public async Task Worker_ClaimsAndProcessesDueJobsInScopes()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));
        ServiceCollection services = new();
        services.AddScoped(_ => CreateDbContext());
        services.AddScoped(provider => Queue(provider.GetRequiredService<ApplicationDbContext>()));
        services.AddScoped(provider => StudyGuideTestData.Processor(provider.GetRequiredService<ApplicationDbContext>(), handler, _clock));
        await using ServiceProvider provider = services.BuildServiceProvider();
        StudyGuideGenerationWorker worker = new(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new LlmVendorRegistry(StudyGuideTestData.Keys()),
            MsOptions.Create(new StudyGuideGenerationOptions()),
            NullLogger<StudyGuideGenerationWorker>.Instance);

        (await worker.RunOnceAsync(CancellationToken.None)).Should().Be(1);
        (await worker.RunOnceAsync(CancellationToken.None)).Should().Be(0);

        await using ApplicationDbContext verify = CreateDbContext();
        (await verify.SectionGenerations.SingleAsync(g => g.Id == generation.Id)).Status.Should().Be(SectionGenerationStatus.Completed);
    }

    [Fact]
    public async Task Worker_WithoutAnyVendorKey_DoesNothing()
    {
        await QueueAsync();
        ServiceCollection services = new();
        await using ServiceProvider provider = services.BuildServiceProvider();
        StudyGuideGenerationWorker worker = new(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new LlmVendorRegistry(StudyGuideTestData.Keys(false, false, false, false, false)),
            MsOptions.Create(new StudyGuideGenerationOptions()),
            NullLogger<StudyGuideGenerationWorker>.Instance);

        await worker.StartAsync(CancellationToken.None);
        await worker.StopAsync(CancellationToken.None);

        (await DbContext.SectionGenerations.SingleAsync()).Status.Should().Be(SectionGenerationStatus.Pending);
    }

    [Fact]
    public async Task Processor_RateLimitedVendorIsRecordedAndCooledDownForLaterSections()
    {
        LlmVendorCooldowns cooldowns = new(_clock);
        FakeVendorHandler handler = new((vendor, _) => vendor == LlmVendors.Gemini
            ? FakeVendorHandler.Json((HttpStatusCode)429, "{\"error\":{\"code\":429,\"message\":\"Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier\",\"status\":\"RESOURCE_EXHAUSTED\"}}")
            : FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));

        SectionGeneration first = await QueueAsync();
        await Queue().ClaimDueAsync(2, CancellationToken.None);
        DbContext.ChangeTracker.Clear();
        await StudyGuideTestData.Processor(DbContext, handler, _clock, cooldowns: cooldowns).ProcessAsync(first.Id, CancellationToken.None);

        handler.Vendors.Should().Equal(LlmVendors.Gemini, LlmVendors.OpenRouter);
        Attempts().Select(a => (a.Vendor, a.Outcome, a.HttpStatus)).Should().Equal(
            (LlmVendors.Gemini, LlmAttemptOutcome.RateLimited, (int?)429),
            (LlmVendors.OpenRouter, LlmAttemptOutcome.Success, (int?)200));
        cooldowns.IsCoolingDown(LlmVendors.Gemini).Should().BeTrue();
        cooldowns.CoolingDownUntil(LlmVendors.Gemini).Should().BeOnOrBefore(_clock.GetUtcNow() + LlmVendorCooldowns.MaxCooldown);

        handler.Requests.Clear();
        _clock.UtcNow = _clock.UtcNow.Add(TimeSpan.FromMinutes(5));
        SectionGeneration second = await QueueAsync();
        await Queue().ClaimDueAsync(2, CancellationToken.None);
        DbContext.ChangeTracker.Clear();
        await StudyGuideTestData.Processor(DbContext, handler, _clock, cooldowns: cooldowns).ProcessAsync(second.Id, CancellationToken.None);
        handler.Vendors.Should().Equal([LlmVendors.OpenRouter], "Gemini is cooling down");

        handler.Requests.Clear();
        _clock.UtcNow = _clock.UtcNow.Add(LlmVendorCooldowns.MaxCooldown);
        cooldowns.IsCoolingDown(LlmVendors.Gemini).Should().BeFalse("cooldowns are capped at an hour");
    }

    [Fact]
    public async Task Processor_WhenEveryKeyedVendorIsCoolingDown_StillTriesTheRoute()
    {
        LlmVendorCooldowns cooldowns = new(_clock);
        cooldowns.Start(LlmVendors.Gemini, TimeSpan.FromMinutes(10), false);
        cooldowns.Start(LlmVendors.OpenRouter, TimeSpan.FromMinutes(10), false);
        cooldowns.Start(LlmVendors.OpenAI, TimeSpan.FromMinutes(10), false);
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));
        SectionGeneration generation = await QueueAsync();
        await Queue().ClaimDueAsync(2, CancellationToken.None);
        DbContext.ChangeTracker.Clear();

        await StudyGuideTestData.Processor(DbContext, handler, _clock, cooldowns: cooldowns).ProcessAsync(generation.Id, CancellationToken.None);

        handler.Vendors.Should().Equal(LlmVendors.Gemini);
        (await DbContext.SectionGenerations.SingleAsync(g => g.Id == generation.Id)).Status.Should().Be(SectionGenerationStatus.Completed);
    }

    [Fact]
    public void Cooldowns_UseRetryAfterThenDailyResetThenDefault_CappedAtAnHour()
    {
        LlmVendorCooldowns cooldowns = new(_clock);
        DateTimeOffset now = _clock.GetUtcNow();

        cooldowns.Start("A", TimeSpan.FromSeconds(30), dailyQuotaExhausted: true).Should().Be(now.AddSeconds(30));
        cooldowns.Start("B", null, dailyQuotaExhausted: false).Should().Be(now + LlmVendorCooldowns.DefaultCooldown);
        cooldowns.Start("C", TimeSpan.FromHours(5), dailyQuotaExhausted: false).Should().Be(now + LlmVendorCooldowns.MaxCooldown);
        cooldowns.Start("D", null, dailyQuotaExhausted: true).Should().BeOnOrBefore(now + LlmVendorCooldowns.MaxCooldown);
        LlmVendorCooldowns.UntilNextPacificMidnight(new DateTimeOffset(2026, 11, 5, 7, 30, 0, TimeSpan.Zero))
            .Should().Be(TimeSpan.FromMinutes(30), "07:30 UTC is 23:30 PST");
    }

    [Fact]
    public void BuildRequestBody_CapsMaxTokensAtTheVendorLimit_AndSetsLowEffortForGptOss()
    {
        ChatCompletionRequest request = new("system", "user", 8000, 0.2);
        LlmVendorRegistry registry = new(StudyGuideTestData.Keys(groq: true));

        System.Text.Json.Nodes.JsonObject groq = OpenAiCompatibleChatClient.BuildRequestBody(registry.Get(LlmVendors.Groq), "openai/gpt-oss-120b", request);
        System.Text.Json.Nodes.JsonObject cerebras = OpenAiCompatibleChatClient.BuildRequestBody(registry.Get(LlmVendors.Cerebras), "gpt-oss-120b", request);
        System.Text.Json.Nodes.JsonObject small = OpenAiCompatibleChatClient.BuildRequestBody(registry.Get(LlmVendors.Groq), "openai/gpt-oss-120b", request with { MaxTokens = 1000 });

        groq["max_tokens"]!.GetValue<int>().Should().Be(4000);
        groq["reasoning_effort"]!.GetValue<string>().Should().Be("low");
        cerebras["max_tokens"]!.GetValue<int>().Should().Be(8000);
        cerebras["reasoning_effort"]!.GetValue<string>().Should().Be("low");
        small["max_tokens"]!.GetValue<int>().Should().Be(1000);
    }

    [Fact]
    public async Task Processor_OpenRouterCallsCarryAttributionHeaders()
    {
        SectionGeneration generation = await QueueAsync();
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));

        await ClaimAndProcessAsync(generation, handler, StudyGuideTestData.Keys(openRouter: true, openAi: false, gemini: false));

        HttpRequestMessage request = handler.Requests.Single().Request;
        request.RequestUri!.ToString().Should().Be("https://openrouter.ai/api/v1/chat/completions");
        request.Headers.GetValues("HTTP-Referer").Should().Equal("https://www.quizymode.com");
        request.Headers.GetValues("X-Title").Should().Equal("Quizymode");
    }

    private static LlmVendorEndpoint Endpoint(string vendor, int? maxTokens = null) => new(vendor, "https://vendor.test/v1", "key", maxTokens);
}
