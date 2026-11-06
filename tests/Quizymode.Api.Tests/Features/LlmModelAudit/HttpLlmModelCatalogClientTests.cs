using System.Net;
using System.Text;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Features.LlmModelAudit;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Xunit;

namespace Quizymode.Api.Tests.Features.LlmModelAudit;

/// <summary>#480: the model-list client sends the key in a header only, strips the Gemini models/ prefix, and fails closed.</summary>
public sealed class HttpLlmModelCatalogClientTests
{
    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? Last { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Last = request;
            return Task.FromResult(respond(request));
        }
    }

    private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static (HttpLlmModelCatalogClient Client, StubHandler Handler) Create(Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        StubHandler handler = new(respond);
        return (new HttpLlmModelCatalogClient(new HttpClient(handler), NullLogger<HttpLlmModelCatalogClient>.Instance), handler);
    }

    private static LlmVendorEndpoint Endpoint(string vendor) => new(vendor, "https://example.test/v1", "secret-key");

    [Fact]
    public async Task Gemini_UsesHeaderKeyAndStripsModelsPrefix()
    {
        (HttpLlmModelCatalogClient client, StubHandler handler) = Create(_ => Json("""{"data":[{"id":"models/gemini-3.5-flash-lite"},{"id":"models/other"}]}"""));

        LlmCatalogResult result = await client.ListModelsAsync(Endpoint("Gemini"), default);

        result.Outcome.Should().Be(LlmCatalogOutcome.Ok);
        result.Models.Should().Contain("gemini-3.5-flash-lite");
        handler.Last!.Headers.GetValues("x-goog-api-key").Should().ContainSingle("secret-key");
        handler.Last.RequestUri!.ToString().Should().NotContain("secret-key");
        handler.Last.Headers.Authorization.Should().BeNull();
    }

    [Fact]
    public async Task OpenAiCompatible_UsesBearerHeader()
    {
        (HttpLlmModelCatalogClient client, StubHandler handler) = Create(_ => Json("""{"data":[{"id":"gpt-5-nano"}]}"""));

        LlmCatalogResult result = await client.ListModelsAsync(Endpoint("OpenAI"), default);

        result.Models.Should().Contain("gpt-5-nano");
        handler.Last!.Headers.Authorization!.Scheme.Should().Be("Bearer");
        handler.Last.RequestUri!.AbsoluteUri.Should().Be("https://example.test/v1/models");
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task ErrorStatus_IsFailed(HttpStatusCode status)
    {
        (HttpLlmModelCatalogClient client, _) = Create(_ => Json("{}", status));

        (await client.ListModelsAsync(Endpoint("Groq"), default)).Outcome.Should().Be(LlmCatalogOutcome.Failed);
    }

    [Fact]
    public async Task Timeout_IsFailed()
    {
        (HttpLlmModelCatalogClient client, _) = Create(_ => throw new TaskCanceledException("timeout"));

        (await client.ListModelsAsync(Endpoint("Groq"), default)).Outcome.Should().Be(LlmCatalogOutcome.Failed);
    }

    [Fact]
    public async Task OversizedBody_IsFailed()
    {
        string huge = "{\"data\":[{\"id\":\"" + new string('a', HttpLlmModelCatalogClient.MaxBodyBytes + 10) + "\"}]}";
        (HttpLlmModelCatalogClient client, _) = Create(_ => Json(huge));

        (await client.ListModelsAsync(Endpoint("Groq"), default)).Outcome.Should().Be(LlmCatalogOutcome.Failed);
    }

    [Fact]
    public async Task InvalidJson_IsFailed()
    {
        (HttpLlmModelCatalogClient client, _) = Create(_ => Json("not json"));

        (await client.ListModelsAsync(Endpoint("Groq"), default)).Outcome.Should().Be(LlmCatalogOutcome.Failed);
    }
}
