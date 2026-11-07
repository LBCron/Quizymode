using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

/// <summary>Actual JWT HTTP pipeline and durable jobs, with an in-process HTTP handler that can never reach a provider.</summary>
public sealed class MediaAdvisoryHttpTests : DatabaseTestFixture
{
    private readonly FakeMediaObjectStore store = new();
    private static MediaAdvisoryOptions Enabled() => new() { Enabled = true, ProcessingTermsAccepted = true, PrivateContentAllowed = true };

    private async Task<Item> SeedPendingAsync(bool switchEnabled = true)
    {
        NormalizeResult normalized = await new ImageNormalizer(new MediaOptions(), NullLogger<ImageNormalizer>.Instance, null)
            .NormalizeAsync(MediaTestImages.FlagPng(64, 48), CancellationToken.None);
        NormalizedImage image = normalized.Image!;
        MediaAsset asset = PictureSeed.AddAsset(DbContext, "fixture-owner", image.Sha256);
        asset.Bytes = image.Bytes.Length; asset.Width = image.Width; asset.Height = image.Height;
        store.Objects[asset.ObjectKey!] = image.Bytes;
        Category category = VisibilitySeed.AddCategory(DbContext);
        Item item = PictureSeed.AddPictureItem(DbContext, category, "fixture-owner", true, ItemImageReviewState.PendingReview, asset);
        item.IncorrectAnswerRationale = new() { [0] = "Synthetic incorrect-answer reasoning" };
        item.Question = "Synthetic flag question"; item.QuestionImageLongDescription = "Synthetic normalized stripes";
        if (!await DbContext.MediaControls.AnyAsync()) DbContext.MediaControls.Add(new MediaControl { AdvisoryEnabled = switchEnabled });
        await DbContext.SaveChangesAsync(); return item;
    }

    private async Task<Scenario> StartAsync(MediaAdvisoryOptions options, ProviderHandler handler, Func<Task>? beforeRead = null)
    {
        HttpClient providerHttp = new(handler) { Timeout = TimeSpan.FromSeconds(2) };
        IConfiguration config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Gemini:ApiKey"] = "synthetic-not-a-real-key" }).Build();
        JwtHttpTestHost host = await JwtHttpTestHost.StartAsync(CreateDbContext, services =>
        {
            services.AddSingleton(Options.Create(options));
            services.AddSingleton<IMediaObjectStore>(new ReadHookStore(store, beforeRead));
            services.AddSingleton(new GeminiMediaAdvisory(providerHttp, config));
        }, app => new MediaAdvisoryEndpoints.Endpoint().MapEndpoint(app));
        return new Scenario(host, providerHttp);
    }

    private static async Task<HttpResponseMessage> PostAsync(Scenario scenario, Guid itemId, string? token = null) =>
        await scenario.Host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Post, $"/admin/items/{itemId}/image-advisory", token, JsonContent.Create(new { expectedRevision = 1 })));
    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    private async Task AssertStillPendingAsync(Guid id)
    {
        await using ApplicationDbContext verify = CreateDbContext();
        Item item = await verify.Items.AsNoTracking().SingleAsync(x => x.Id == id);
        item.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview); item.IsPrivate.Should().BeTrue(); item.ReadyForReview.Should().BeFalse();
        (await verify.ItemImageReviews.AsNoTracking().Where(x => x.ItemId == id).ToListAsync()).Should().OnlyContain(x => x.Decision == null && x.DecidedBy == null);
    }

    [Fact]
    public async Task BothAdvisoryRoutesRequireAuthenticationAndAdminWithoutDispatch()
    {
        Item item = await SeedPendingAsync(); ProviderHandler provider = new(); await using Scenario s = await StartAsync(Enabled(), provider);
        using HttpResponseMessage anonymousPost = await PostAsync(s, item.Id); anonymousPost.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using HttpResponseMessage anonymousGet = await s.Host.Client.GetAsync($"/admin/items/{item.Id}/image-advisory"); anonymousGet.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        string member = s.Host.CreateToken("fixture-member", "member@example.test");
        using HttpResponseMessage memberPost = await PostAsync(s, item.Id, member); memberPost.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using HttpResponseMessage memberGet = await s.Host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Get, $"/admin/items/{item.Id}/image-advisory", member)); memberGet.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        provider.Calls.Should().Be(0); (await DbContext.MediaAdvisoryJobs.CountAsync()).Should().Be(0);
    }

    [Theory]
    [InlineData("enable")]
    [InlineData("terms")]
    [InlineData("privacy")]
    [InlineData("switch")]
    public async Task EveryConfigurationAndDurableSwitchGateRefusesBeforeReservationOrDispatch(string disabled)
    {
        Item item = await SeedPendingAsync(disabled != "switch"); MediaAdvisoryOptions options = Enabled();
        if (disabled == "enable") options.Enabled = false;
        if (disabled == "terms") options.ProcessingTermsAccepted = false;
        if (disabled == "privacy") options.PrivateContentAllowed = false;
        ProviderHandler provider = new(); await using Scenario s = await StartAsync(options, provider);
        using HttpResponseMessage response = await PostAsync(s, item.Id, s.AdminToken); response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        provider.Calls.Should().Be(0); (await DbContext.MediaAdvisoryJobs.CountAsync()).Should().Be(0); await AssertStillPendingAsync(item.Id);
    }

    [Fact]
    public async Task RepeatAndRefreshReuseOnePersistedResultWithoutApplyingAHumanDecision()
    {
        Item item = await SeedPendingAsync(); ProviderHandler provider = new(); await using Scenario s = await StartAsync(Enabled(), provider);
        using HttpResponseMessage first = await PostAsync(s, item.Id, s.AdminToken); first.StatusCode.Should().Be(HttpStatusCode.OK);
        (await JsonAsync(first)).GetProperty("state").GetString().Should().Be("Complete");
        using HttpResponseMessage repeated = await PostAsync(s, item.Id, s.AdminToken); repeated.StatusCode.Should().Be(HttpStatusCode.OK);
        using HttpResponseMessage refresh = await s.Host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Get, $"/admin/items/{item.Id}/image-advisory", s.AdminToken)); refresh.StatusCode.Should().Be(HttpStatusCode.OK);
        provider.Calls.Should().Be(1); provider.LastBody.Should().Contain("Synthetic flag question").And.Contain("Synthetic normalized stripes").And.Contain("image/webp").And.Contain("Synthetic incorrect-answer reasoning");
        MediaAdvisoryJob job = await DbContext.MediaAdvisoryJobs.AsNoTracking().SingleAsync(); job.ReservedCostUsd.Should().Be(.05m); job.InputTokens.Should().Be(120); job.OutputTokens.Should().Be(12); job.EstimatedCostUsd.Should().Be(.000066m, "120 input tokens at $0.30/M plus 12 output/thinking tokens at $2.50/M must be recorded as an estimate");
        await AssertStillPendingAsync(item.Id);
    }

    [Fact]
    public async Task OutageRetainsReservationAndPreventsAnotherCallAtOwnerCostCeiling()
    {
        Item firstItem = await SeedPendingAsync(); Item secondItem = await SeedPendingAsync();
        MediaAdvisoryOptions options = Enabled(); options.OwnerDailyReservationBudgetUsd = .05m;
        ProviderHandler provider = new() { Status = HttpStatusCode.ServiceUnavailable }; await using Scenario s = await StartAsync(options, provider);
        using HttpResponseMessage failed = await PostAsync(s, firstItem.Id, s.AdminToken); failed.StatusCode.Should().Be(HttpStatusCode.OK);
        (await JsonAsync(failed)).GetProperty("state").GetString().Should().Be("Unavailable");
        using HttpResponseMessage repeated = await PostAsync(s, firstItem.Id, s.AdminToken); repeated.StatusCode.Should().Be(HttpStatusCode.OK);
        using HttpResponseMessage budget = await PostAsync(s, secondItem.Id, s.AdminToken); budget.StatusCode.Should().Be((HttpStatusCode)429);
        (await JsonAsync(budget)).GetProperty("title").GetString().Should().Be("Media.AdvisoryCostBudget");
        provider.Calls.Should().Be(1); (await DbContext.MediaAdvisoryJobs.AsNoTracking().SingleAsync()).ReservedCostUsd.Should().Be(.05m);
        await AssertStillPendingAsync(firstItem.Id); await AssertStillPendingAsync(secondItem.Id);
    }

    [Fact]
    public async Task CallBudgetExhaustion_Returns429WithoutDispatch_AndLeavesTheItemPending()
    {
        Item firstItem = await SeedPendingAsync(); Item secondItem = await SeedPendingAsync();
        MediaAdvisoryOptions options = Enabled(); options.DailyCallBudget = 1; options.OwnerDailyCallBudget = 1;
        ProviderHandler provider = new(); await using Scenario s = await StartAsync(options, provider);
        using HttpResponseMessage first = await PostAsync(s, firstItem.Id, s.AdminToken); first.StatusCode.Should().Be(HttpStatusCode.OK);
        using HttpResponseMessage exhausted = await PostAsync(s, secondItem.Id, s.AdminToken);
        exhausted.StatusCode.Should().Be((HttpStatusCode)429);
        (await JsonAsync(exhausted)).GetProperty("title").GetString().Should().Be("Media.AdvisoryBudget");
        provider.Calls.Should().Be(1); (await DbContext.MediaAdvisoryJobs.CountAsync()).Should().Be(1);
        await AssertStillPendingAsync(firstItem.Id); await AssertStillPendingAsync(secondItem.Id);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.BadGateway)]
    public async Task ProviderOutage_MarksTheJobUnavailable_AndTheItemStaysPendingForManualReview(HttpStatusCode status)
    {
        Item item = await SeedPendingAsync(); ProviderHandler provider = new() { Status = status };
        await using Scenario s = await StartAsync(Enabled(), provider);
        using HttpResponseMessage response = await PostAsync(s, item.Id, s.AdminToken); response.StatusCode.Should().Be(HttpStatusCode.OK);
        JsonElement job = await JsonAsync(response); job.GetProperty("state").GetString().Should().Be("Unavailable"); job.GetProperty("resultJson").ValueKind.Should().Be(JsonValueKind.Null);
        provider.Calls.Should().Be(1); await AssertStillPendingAsync(item.Id);
    }

    [Fact]
    public async Task RevisionChangedDuringProviderCallMakesResultStaleAndRefreshCannotExposeIt()
    {
        Item item = await SeedPendingAsync();
        ProviderHandler provider = new() { BeforeResponse = async () => { await using ApplicationDbContext changed = CreateDbContext(); await changed.Items.Where(x => x.Id == item.Id).ExecuteUpdateAsync(set => set.SetProperty(x => x.ImageRevision, 2)); } };
        await using Scenario s = await StartAsync(Enabled(), provider);
        using HttpResponseMessage response = await PostAsync(s, item.Id, s.AdminToken); response.StatusCode.Should().Be(HttpStatusCode.OK);
        JsonElement result = await JsonAsync(response); result.GetProperty("state").GetString().Should().Be("Stale"); result.GetProperty("resultJson").ValueKind.Should().Be(JsonValueKind.Null);
        using HttpResponseMessage refresh = await s.Host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Get, $"/admin/items/{item.Id}/image-advisory", s.AdminToken)); refresh.StatusCode.Should().Be(HttpStatusCode.OK); (await refresh.Content.ReadAsStringAsync()).Should().BeEmpty("a stale revision has no current advisory representation");
        provider.Calls.Should().Be(1); (await DbContext.MediaAdvisoryJobs.AsNoTracking().SingleAsync()).ReservedCostUsd.Should().Be(.05m); await AssertStillPendingAsync(item.Id);
    }

    [Fact]
    public async Task KillSwitchFlippedWhileReadingMediaPreventsDispatchAndKeepsReservedAttempt()
    {
        Item item = await SeedPendingAsync(); ProviderHandler provider = new();
        await using Scenario s = await StartAsync(Enabled(), provider, async () => { await using ApplicationDbContext changed = CreateDbContext(); await changed.MediaControls.ExecuteUpdateAsync(set => set.SetProperty(x => x.AdvisoryEnabled, false)); });
        using HttpResponseMessage response = await PostAsync(s, item.Id, s.AdminToken); response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await JsonAsync(response)).GetProperty("state").GetString().Should().Be("Unavailable"); provider.Calls.Should().Be(0);
        (await DbContext.MediaAdvisoryJobs.AsNoTracking().SingleAsync()).ReservedCostUsd.Should().Be(.05m); await AssertStillPendingAsync(item.Id);
    }

    private sealed class Scenario(JwtHttpTestHost host, HttpClient providerHttp) : IAsyncDisposable
    {
        public JwtHttpTestHost Host { get; } = host;
        public string AdminToken => Host.CreateToken("fixture-admin", "admin@example.test", ["Admins"]);
        public async ValueTask DisposeAsync() { await Host.DisposeAsync(); providerHttp.Dispose(); }
    }
    private sealed class ProviderHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? LastBody { get; private set; }
        public HttpStatusCode Status { get; init; } = HttpStatusCode.OK;
        public Func<Task>? BeforeResponse { get; init; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++; LastBody = await request.Content!.ReadAsStringAsync(ct);
            if (BeforeResponse is not null) await BeforeResponse();
            string assessment = JsonSerializer.Serialize(new { flags = Array.Empty<object>(), summary = "Human review remains required" });
            return new HttpResponseMessage(Status) { Content = JsonContent.Create(new { candidates = new[] { new { content = new { parts = new[] { new { text = assessment } } } } }, usageMetadata = new { promptTokenCount = 120, candidatesTokenCount = 10, thoughtsTokenCount = 2 } }) };
        }
    }
    private sealed class ReadHookStore(FakeMediaObjectStore inner, Func<Task>? beforeRead) : IMediaObjectStore
    {
        public bool IsAvailable => inner.IsAvailable;
        public Task<PutOutcome> PutIfAbsentAsync(string key, byte[] content, string contentType, CancellationToken ct) => inner.PutIfAbsentAsync(key, content, contentType, ct);
        public async Task<MediaObjectContent?> OpenReadAsync(string key, CancellationToken ct) { if (beforeRead is not null) await beforeRead(); return await inner.OpenReadAsync(key, ct); }
    }
}
