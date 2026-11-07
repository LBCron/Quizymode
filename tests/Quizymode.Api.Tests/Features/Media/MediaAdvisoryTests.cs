using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Quizymode.Api.Features.Media;
using Xunit;
namespace Quizymode.Api.Tests.Features.Media;
public sealed class MediaAdvisoryTests
{
    [Theory]
    [InlineData("{\"flags\":[{\"category\":\"unknown\",\"score\":0.1,\"reason\":\"risk\"}],\"summary\":\"review\"}")]
    [InlineData("{\"flags\":[{\"category\":\"privacy\",\"score\":1.1,\"reason\":\"risk\"}],\"summary\":\"review\"}")]
    [InlineData("{\"flags\":[],\"summary\":\"review\",\"approved\":true}")]
    [InlineData("{\"flags\":[],\"summary\":\"review\",\"summary\":\"other\"}")]
    public void RejectsUnknownOutOfRangeAndApprovalOutput(string json) => FluentActions.Invoking(() => MediaAdvisorySchema.Parse(json)).Should().Throw<JsonException>();
    [Fact]
    public async Task DefaultModelIsAcceptedAndRequestContainsUntrustedContextAndNormalizedWebp()
    {
        string? observed = null; string? path = null;
        using HttpClient http = new(new Handler(async request => { path = request.RequestUri!.AbsolutePath; observed = await request.Content!.ReadAsStringAsync(); return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"{\\\"flags\\\":[],\\\"summary\\\":\\\"Human review needed\\\"}\"}]}}]}", Encoding.UTF8, "application/json") }; }));
        IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Gemini:ApiKey"] = "synthetic-test-key" }).Build();
        MediaAdvisoryResult result = await new GeminiMediaAdvisory(http, configuration).AssessAsync(new MediaAdvisoryOptions().Model, "Untrusted educational context", [new byte[] { 1, 2 }], CancellationToken.None);
        path.Should().Contain("gemini-3.5-flash-lite:generateContent"); observed.Should().Contain("UNTRUSTED DATA").And.Contain("image/webp").And.Contain("Untrusted educational context"); result.Summary.Should().Be("Human review needed");
    }
    [Theory]
    [InlineData("../other")]
    [InlineData("model/key")]
    [InlineData("model?key=secret")]
    public async Task RejectsUnsafeModelBeforeDispatch(string model)
    {
        using HttpClient http = new(new Handler(_ => throw new InvalidOperationException("No network allowed")));
        IConfiguration configuration = new ConfigurationBuilder().Build();
        await FluentActions.Awaiting(() => new GeminiMediaAdvisory(http, configuration).AssessAsync(model, "context", [], CancellationToken.None)).Should().ThrowAsync<InvalidOperationException>().WithMessage("Invalid model.");
    }
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => send(request); }
}
