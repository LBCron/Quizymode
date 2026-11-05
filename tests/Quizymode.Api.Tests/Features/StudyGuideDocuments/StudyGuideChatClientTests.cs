using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>Vendor reply classification, the HTTP status carried on every received reply, and log hygiene (AC 5.12.5, 6.6.12).</summary>
public sealed class StudyGuideChatClientTests
{
    private const string GeminiBadKeyBody = "[{\"error\":{\"code\":400,\"message\":\"API key not valid. Please pass a valid API key.\",\"status\":\"INVALID_ARGUMENT\"}}]";
    private const string OpenAiBadKeyBody = "{\"error\":{\"message\":\"Incorrect API key provided: sk-proj-****abcd. You can find your API key at https://platform.openai.com.\",\"type\":\"invalid_request_error\"}}";
    private const string DeepSeekBadKeyBody = "{\"error\":{\"message\":\"Authentication Fails, Your api key: ****abcd is invalid\",\"type\":\"authentication_error\"}}";

    private sealed class CapturingLogger : ILogger<OpenAiCompatibleChatClient>
    {
        public List<string> Messages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Messages.Add(formatter(state, exception));
    }

    private static async Task<ChatCompletionResult> CallAsync(Func<HttpRequestMessage, string, HttpResponseMessage> respond, CapturingLogger? logger = null)
    {
        OpenAiCompatibleChatClient client = new(new HttpClient(new FakeChatHandler(respond)), logger ?? new CapturingLogger());
        return await client.CompleteAsync(
            new LlmVendorEndpoint(LlmVendors.OpenAI, "https://api.openai.com/v1", "test-key"),
            "gpt-5-nano",
            new ChatCompletionRequest("system", "user", 1000, 0.2),
            CancellationToken.None);
    }

    private static HttpResponseMessage Body(HttpStatusCode status, string body) => FakeChatHandler.Json(status, body);

    [Theory]
    [InlineData(LlmVendors.OpenRouter, true)]
    [InlineData(LlmVendors.OpenAI, false)]
    [InlineData(LlmVendors.Gemini, false)]
    [InlineData(LlmVendors.Groq, false)]
    [InlineData(LlmVendors.Cerebras, false)]
    public async Task ChatClient_OnlyOpenRouterRestrictsProviderDataCollection(string vendor, bool restrictDataCollection)
    {
        bool received = false;
        OpenAiCompatibleChatClient client = new(new HttpClient(new FakeChatHandler((request, body) =>
        {
            received = true;
            using JsonDocument document = JsonDocument.Parse(body);
            bool hasProvider = document.RootElement.TryGetProperty("provider", out JsonElement provider);
            hasProvider.Should().Be(restrictDataCollection);
            if (restrictDataCollection)
            {
                provider.GetProperty("data_collection").GetString().Should().Be("deny");
                request.Headers.GetValues("HTTP-Referer").Should().ContainSingle().Which.Should().Be("https://www.quizymode.com");
                request.Headers.GetValues("X-Title").Should().ContainSingle().Which.Should().Be("Quizymode");
            }

            return FakeVendorHandler.Completion("{}");
        })), new CapturingLogger());

        ChatCompletionResult result = await client.CompleteAsync(
            new LlmVendorEndpoint(vendor, "https://vendor.test/v1", "test-key"),
            "test-model",
            new ChatCompletionRequest("system", "user", 1000, 0.2),
            CancellationToken.None);

        received.Should().BeTrue();
        result.Outcome.Should().Be(LlmAttemptOutcome.Success);
    }

    [Theory]
    [InlineData(401, "{}", LlmAttemptOutcome.AuthError, 401)]
    [InlineData(403, "{}", LlmAttemptOutcome.ProviderError, 403)]
    [InlineData(403, "{\"error\":{\"code\":\"unsupported_country_region_territory\",\"message\":\"Country, region, or territory not supported\",\"type\":\"request_forbidden\"}}", LlmAttemptOutcome.ProviderError, 403)]
    [InlineData(403, "Project `proj_abc` does not have access to model `gpt-5`", LlmAttemptOutcome.ProviderError, 403)]
    [InlineData(403, "<html>403 Forbidden</html>", LlmAttemptOutcome.ProviderError, 403)]
    [InlineData(403, "Forbidden", LlmAttemptOutcome.ProviderError, 403)]
    [InlineData(403, "{\"error\":{\"code\":403,\"message\":\"The caller does not have permission\",\"status\":\"PERMISSION_DENIED\"}}", LlmAttemptOutcome.ProviderError, 403)]
    [InlineData(403, "Request blocked: restricted API key", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(403, "{\"error\":{\"code\":\"invalid_api_key\",\"message\":\"nope\"}}", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(403, "Method doesn't allow unregistered callers. Please use API Key or other form of API consumer identity", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(403, "Your API key was reported as leaked. Please use another API key.", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(403, "{\"error\":{\"details\":[{\"reason\":\"API_KEY_SERVICE_BLOCKED\"}]}}", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(403, "{\"error\":{\"status\":\"UNAUTHENTICATED\"}}", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(403, "Request had invalid authentication credentials", LlmAttemptOutcome.AuthError, 403)]
    [InlineData(401, "boom", LlmAttemptOutcome.AuthError, 401)]
    [InlineData(400, GeminiBadKeyBody, LlmAttemptOutcome.AuthError, 400)]
    [InlineData(400, "{\"error\":\"unknown field\"}", LlmAttemptOutcome.ProviderError, 400)]
    [InlineData(500, "{\"error\":\"boom\"}", LlmAttemptOutcome.ProviderError, 500)]
    [InlineData(429, "{\"error\":\"slow down\"}", LlmAttemptOutcome.RateLimited, 429)]
    public async Task ChatClient_ClassifiesFailedResponses(int status, string body, LlmAttemptOutcome outcome, int expectedStatus)
    {
        ChatCompletionResult result = await CallAsync((_, _) => Body((HttpStatusCode)status, body));

        result.Outcome.Should().Be(outcome);
        result.HttpStatus.Should().Be(expectedStatus);
        result.Content.Should().BeNull();
    }

    [Fact]
    public async Task ChatClient_Timeout_HasNoHttpStatus()
    {
        ChatCompletionResult result = await CallAsync((_, _) => throw new TaskCanceledException("timeout"));

        result.Outcome.Should().Be(LlmAttemptOutcome.Timeout);
        result.HttpStatus.Should().BeNull();
    }

    [Fact]
    public async Task ChatClient_NetworkFailure_HasNoHttpStatus()
    {
        ChatCompletionResult result = await CallAsync((_, _) => throw new HttpRequestException("connection refused"));

        result.Outcome.Should().Be(LlmAttemptOutcome.ProviderError);
        result.HttpStatus.Should().BeNull();
    }

    [Fact]
    public async Task ChatClient_NoApiKey_HasNoHttpStatus()
    {
        OpenAiCompatibleChatClient client = new(new HttpClient(new FakeChatHandler((_, _) => throw new InvalidOperationException())), new CapturingLogger());

        ChatCompletionResult result = await client.CompleteAsync(
            new LlmVendorEndpoint(LlmVendors.OpenAI, "https://api.openai.com/v1", ""),
            "gpt-5-nano",
            new ChatCompletionRequest("system", "user", 1000, 0.2),
            CancellationToken.None);

        result.Outcome.Should().Be(LlmAttemptOutcome.ProviderError);
        result.HttpStatus.Should().BeNull();
    }

    [Fact]
    public async Task ChatClient_SuccessCarriesStatus200()
    {
        ChatCompletionResult result = await CallAsync((_, _) => FakeVendorHandler.Completion("{\"questions\":[]}"));

        result.Outcome.Should().Be(LlmAttemptOutcome.Success);
        result.HttpStatus.Should().Be(200);
    }

    [Fact]
    public async Task ChatClient_InvalidJsonBody_IsInvalidJsonWithStatus200()
    {
        ChatCompletionResult result = await CallAsync((_, _) => Body(HttpStatusCode.OK, "<html>not json</html>"));

        result.Outcome.Should().Be(LlmAttemptOutcome.InvalidJson);
        result.HttpStatus.Should().Be(200);
    }

    [Theory]
    [InlineData("{\"choices\":[]}", LlmAttemptOutcome.InvalidJson)]
    [InlineData("{\"choices\":[{\"finish_reason\":\"content_filter\",\"message\":{\"content\":\"\"}}]}", LlmAttemptOutcome.ContentFilter)]
    [InlineData("{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"{\"}}]}", LlmAttemptOutcome.InvalidJson)]
    [InlineData("{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"  \"}}]}", LlmAttemptOutcome.InvalidJson)]
    public async Task ChatClient_Unusable200Replies_KeepStatus200(string body, LlmAttemptOutcome outcome)
    {
        ChatCompletionResult result = await CallAsync((_, _) => Body(HttpStatusCode.OK, body));

        result.Outcome.Should().Be(outcome);
        result.HttpStatus.Should().Be(200);
    }

    [Theory]
    [InlineData(401, OpenAiBadKeyBody)]
    [InlineData(401, DeepSeekBadKeyBody)]
    [InlineData(400, GeminiBadKeyBody)]
    public async Task ChatClient_AuthErrorLogs_NeverContainTheVendorBody(int status, string body)
    {
        CapturingLogger logger = new();

        await CallAsync((_, _) => Body((HttpStatusCode)status, body), logger);

        string log = string.Join('\n', logger.Messages);
        log.Should().Contain("OpenAI").And.Contain(status.ToString());
        log.Should().NotContain("abcd").And.NotContain("sk-").And.NotContain("Incorrect API key").And.NotContain("Authentication Fails").And.NotContain("API key not valid");
    }

    [Fact]
    public async Task ChatClient_Unauthorized401_WithRestrictedKeyText_DoesNotLogBody()
    {
        CapturingLogger logger = new();

        await CallAsync((_, _) => Body(HttpStatusCode.Unauthorized, "Request blocked: restricted API key"), logger);

        string log = string.Join('\n', logger.Messages);
        log.Should().Contain("401").And.NotContain("restricted");
    }

    [Fact]
    public async Task ChatClient_RegionBlock403_LogsTheBody()
    {
        CapturingLogger logger = new();
        string body = "{\"error\":{\"message\":\"Country, region, or territory not supported\"}}";

        await CallAsync((_, _) => Body(HttpStatusCode.Forbidden, body), logger);

        string log = string.Join('\n', logger.Messages);
        log.Should().Contain("OpenAI").And.Contain("403").And.Contain("Country, region, or territory not supported");
    }

    [Fact]
    public async Task ChatClient_CredentialBody403_LogsRedactedBody()
    {
        CapturingLogger logger = new();
        string body = "{\"error\":\"restricted API key sk-proj-AbCdEf123456 ****wxyz\"}";

        await CallAsync((_, _) => Body(HttpStatusCode.Forbidden, body), logger);

        string log = string.Join('\n', logger.Messages);
        log.Should().Contain("rejected the API key (HTTP 403): ").And.Contain("restricted API key").And.Contain("[redacted]");
        log.Should().NotContain("AbCdEf123456").And.NotContain("wxyz").And.NotContain("sk-proj-A");
    }

    [Fact]
    public async Task ChatClient_Forbidden403_BearerAndUrlKeysAreNotLogged()
    {
        CapturingLogger logger = new();
        string body = "denied Bearer eyJhbGciOi.payloadpart.sigpart at https://x.test/v1?key=AIzaSyD-ummy_Key1234567890&alt=json";

        await CallAsync((_, _) => Body(HttpStatusCode.Forbidden, body), logger);

        string log = string.Join('\n', logger.Messages);
        log.Should().Contain("denied").And.Contain("alt=json");
        log.Should().NotContain("eyJhbGciOi").And.NotContain("payloadpart").And.NotContain("AIzaSy").And.NotContain("ummy_Key");
    }

    [Fact]
    public async Task ChatClient_ServerErrorLog_RedactsKeyLikeStrings()
    {
        CapturingLogger logger = new();
        string body = "{\"error\":\"upstream failure for sk-proj-AbCdEf123456 and AIzaSyA1B2C3D4E5F6 and ****wxyz\"}";

        await CallAsync((_, _) => Body(HttpStatusCode.InternalServerError, body), logger);

        string log = string.Join('\n', logger.Messages);
        log.Should().Contain("upstream failure").And.Contain("[redacted]");
        log.Should().NotContain("AbCdEf123456").And.NotContain("AIzaSy").And.NotContain("wxyz");
    }

    [Theory]
    [InlineData("key sk-proj-****abcd here", "key [redacted] here")]
    [InlineData("key sk-abc123 here", "key [redacted] here")]
    [InlineData("Your api key: ****abcd is invalid", "Your api key: [redacted] is invalid")]
    [InlineData("AIzaSyDUMMYKEY123456", "[redacted]")]
    [InlineData("quota exceeded for model", "quota exceeded for model")]
    [InlineData("sk-abc123DEF456", "[redacted]")]
    [InlineData("sk-proj-AbC_dEf-123456", "[redacted]")]
    [InlineData("AIzaSyD-ummy_Key1234567890", "[redacted]")]
    // Split so push-protection secret scanners don't flag this fake DeepSeek-shaped key.
    [InlineData("DeepSeek sk-" + "0123456789abcdef" + "0123456789abcdef bad", "DeepSeek [redacted] bad")]
    [InlineData("Authorization: Bearer eyJhbGciOi.payload.sig", "Authorization: [redacted]")]
    [InlineData("Authorization: Bearer sk-abc123DEF456 end", "Authorization: [redacted] end")]
    [InlineData("Authorization: Basic dXNlcjpwYXNz end", "Authorization: [redacted] end")]
    [InlineData("got bearer abc.def now", "got Bearer [redacted] now")]
    [InlineData("x-goog-api-key: AIzaSyD-ummy_Key1234567890", "x-goog-api-key: [redacted]")]
    [InlineData("api-key: plainsecretvalue", "api-key: [redacted]")]
    [InlineData("{\"api_key\":\"plainsecret123\"}", "{\"api_key\":\"[redacted]\"}")]
    [InlineData("{\"apiKey\":\"x9y8z7\"}", "{\"apiKey\":\"[redacted]\"}")]
    [InlineData("{\"token\":\"t0k3n\"}", "{\"token\":\"[redacted]\"}")]
    [InlineData("{\"x-api-key\":\"hdrsecret\"}", "{\"x-api-key\":\"[redacted]\"}")]
    [InlineData("{\"token\":\"ab\\\"cdsecret\"}", "{\"token\":\"[redacted]\"}")]
    [InlineData("https://h.test/v1?key=plainsecret123&alt=json", "https://h.test/v1?key=[redacted]&alt=json")]
    [InlineData("https://h.test/v1?api_key=zzz", "https://h.test/v1?api_key=[redacted]")]
    [InlineData("https://h.test/v1?a=1&access_token=yyy", "https://h.test/v1?a=1&access_token=[redacted]")]
    [InlineData("... key sk-ab", "... key [redacted]")]
    [InlineData("prefix AIza", "prefix [redacted]")]
    [InlineData("task-force quota exceeded for model gpt-5", "task-force quota exceeded for model gpt-5")]
    [InlineData("Country, region, or territory not supported", "Country, region, or territory not supported")]
    [InlineData("key rotation", "key rotation")]
    [InlineData("Authorization: Token abcdef123 end", "Authorization: [redacted] end")]
    [InlineData("Authorization: Digest username=abcdef123", "Authorization: [redacted]")]
    [InlineData("Authorization: ApiKey abcdef123", "Authorization: [redacted]")]
    [InlineData("echo {\\\"api_key\\\":\\\"plainsecret\\\"} end", "echo {\\\"api_key\\\":\\\"[redacted]\\\"} end")]
    [InlineData("https://h.test/v1?x=1&amp;key=plainsecret&amp;alt=json", "https://h.test/v1?x=1&amp;key=[redacted]&amp;alt=json")]
    [InlineData("https://h.test/v1?x=1&amp;api_key=zzz", "https://h.test/v1?x=1&amp;api_key=[redacted]")]
    [InlineData("env KEY_sk-abcdef123456 set", "env KEY_[redacted] set")]
    [InlineData("authorization: required for this endpoint", "authorization: required for this endpoint")]
    [InlineData("api-key: the provided value is invalid", "api-key: the provided value is invalid")]
    [InlineData("Bearer token expired", "Bearer token expired")]
    [InlineData("Invalid Bearer token.", "Invalid Bearer token.")]
    [InlineData("Authorization: Bearer token is missing", "Authorization: Bearer token is missing")]
    [InlineData("Authorization: Token expired", "Authorization: Token expired")]
    [InlineData("Authorization: ApiKey expired", "Authorization: ApiKey expired")]
    [InlineData("api-key: missing).", "api-key: missing).")]
    [InlineData("WWW-Authenticate: Bearer realm=\"api\"", "WWW-Authenticate: Bearer realm=\"api\"")]
    [InlineData("risk-based limits for desk-top clients", "risk-based limits for desk-top clients")]
    [InlineData("api_keys: 5 per project", "api_keys: 5 per project")]
    [InlineData("{\"max_tokens\": 4096}", "{\"max_tokens\": 4096}")]
    [InlineData("{\"key_id\": 12345}", "{\"key_id\": 12345}")]
    [InlineData("x-goog-api-key=AIza" + "SyD-ummy_Key1234567890", "x-goog-api-key=[redacted]")]
    [InlineData("api-key=plainsecret", "api-key=[redacted]")]
    [InlineData("x-api-key = hdrsecret9", "x-api-key = [redacted]")]
    [InlineData("api_key: abc123xyz", "api_key: [redacted]")]
    [InlineData("api_key=x", "api_key=[redacted]")]
    [InlineData("api_key: \"x\"", "api_key: \"[redacted]\"")]
    [InlineData("api_key: 'x'", "api_key: '[redacted]'")]
    [InlineData("apiKey=plainsecret&alt=json", "apiKey=[redacted]&alt=json")]
    [InlineData("access_token=yyy end", "access_token=[redacted] end")]
    [InlineData("Authorization=Basic dXNlcjpwYXNz", "Authorization=[redacted]")]
    [InlineData("authorization: \"Bearer eyJ.abc\"", "authorization: \"[redacted]\"")]
    [InlineData("{\\\"token\\\":\\\"abc\\\\\\\"def\\\"}", "{\\\"token\\\":\\\"[redacted]\\\"}")]
    [InlineData("{\\\"token\\\":\\\"abc\\\\\\\\\\\"} tail", "{\\\"token\\\":\\\"[redacted]\\\"} tail")]
    [InlineData("{'api_key': 'x'}", "{'api_key': '[redacted]'}")]
    [InlineData("{'token': 'ab\\'cd'}", "{'token': '[redacted]'}")]
    [InlineData("{\"access_token\": 12345}", "{\"access_token\": [redacted]}")]
    [InlineData("{'token': 12345}", "{'token': [redacted]}")]
    [InlineData("{\\\"key\\\":98765}", "{\\\"key\\\":[redacted]}")]
    [InlineData("{\"key\":\"abc", "{\"key\":\"[redacted]")]
    [InlineData("{\"error\":{\"message\":\"bad\",\"key\":\"abc", "{\"error\":{\"message\":\"bad\",\"key\":\"[redacted]")]
    [InlineData("{\\\"api_key\\\":\\\"abc", "{\\\"api_key\\\":\\\"[redacted]")]
    [InlineData("{'secret': 'abc", "{'secret': '[redacted]")]
    [InlineData("KEYsk-" + "0123456789abcdefABCD rest", "KEY[redacted] rest")]
    [InlineData("sk_" + "live_51HabcdefGHIJ", "[redacted]")]
    [InlineData("use sk_" + "test_ABCDEFGH1234 now", "use [redacted] now")]
    [InlineData("rk_" + "live_abcdefgh12", "[redacted]")]
    [InlineData("Bearer token expired; got Bearer abc.def9", "Bearer token expired; got Bearer [redacted]")]
    [InlineData("Bearer dXNlcjpwYXNz", "Bearer [redacted]")]
    [InlineData("api_key: \"my secret phrase\" end", "api_key: \"[redacted]\" end")]
    [InlineData("api_key: 'two words' end", "api_key: '[redacted]' end")]
    [InlineData("api_key: \"abc\\\"def\" end", "api_key: \"[redacted]\" end")]
    [InlineData("api_key=\\\"abc def\\\" end", "api_key=\\\"[redacted]\\\" end")]
    [InlineData("api_key: \\\"abc\\\\\\\"def\\\" tail", "api_key: \\\"[redacted]\\\" tail")]
    [InlineData("api_key=\\\"abc", "api_key=\\\"[redacted]")]
    public void ErrorExcerpt_RedactsKeyShapedText(string input, string expected)
    {
        OpenAiCompatibleChatClient.ErrorExcerpt(input).Should().Be(expected);
    }

    [Fact]
    public void ErrorExcerpt_RedactsBeforeTruncating()
    {
        string input = new string('x', 294) + " sk-proj-SECRETKEYSECRET";

        // "sk-pr" ends exactly at character 300, so truncate-then-redact would leak the "sk-pr" prefix.
        OpenAiCompatibleChatClient.ErrorExcerpt(input).Should().NotContain("SECRET").And.NotContain("sk-");
    }

    [Theory]
    [InlineData("sk-proj-", "SeCrEtKeYvAlUe99", "", "[redacted]")]
    [InlineData("sk-", "0123456789abcdefQWERTY", "", "[redacted]")]
    [InlineData("AIza", "SyD-ummy_Key1234567890", "", "[redacted]")]
    [InlineData("Bearer ", "eyJhbGciOi.pAyLoAd.sIgNaTuRe", "", "Bearer [redacted]")]
    [InlineData("?key=", "plainsecret123456", "&alt=json", "?key=[redacted]")]
    [InlineData("{\"api_key\":\"", "plainsecret123456", "\"}", "{\"api_key\":\"[redacted]")]
    [InlineData("x-api-key: ", "plainsecret123456", " end", "x-api-key: [redacted]")]
    [InlineData("sk_" + "live_", "51HabcdefGHIJKLmnop", "", "[redacted]")]
    [InlineData("{'api_key': '", "plainsecret123456", "'}", "{'api_key': '[redacted]")]
    [InlineData("{\\\"token\\\":\\\"", "plainsecret123456", "\\\"}", "{\\\"token\\\":\\\"[redacted]")]
    [InlineData("{\"access_token\": ", "98765432109876543210", "}", "{\"access_token\": [redacted]")]
    [InlineData("KEYsk-", "0123456789abcdef" + "QWERTYxyz", "", "KEY[redacted]")]
    public void ErrorExcerpt_NeverLeaksASecretStraddlingTheCut(string prefix, string secret, string suffix, string redactedPrefix)
    {
        int straddling = 0;
        int orderingMistakesCaught = 0;
        for (int pad = 250; pad <= 305; pad++)
        {
            int secretStart = pad + 1 + prefix.Length;
            if (secretStart >= 300 || secretStart + secret.Length <= 300)
            {
                continue;
            }

            straddling++;
            string padding = string.Concat(Enumerable.Repeat("z. ", pad / 3 + 1))[..pad];
            string input = padding + " " + prefix + secret + suffix;
            // Redact-then-cut: the whole secret becomes the marker first, then the 300-character cut applies to that.
            string expected = CollapseAndCut(padding + " " + redactedPrefix + suffix);

            string excerpt = OpenAiCompatibleChatClient.ErrorExcerpt(input);

            excerpt.Should().Be(expected, $"pad {pad}");
            for (int i = 0; i + 4 <= secret.Length; i++)
            {
                excerpt.Should().NotContain(secret.Substring(i, 4), $"pad {pad}");
            }

            // What a cut-then-redact implementation would have produced; the exact-match assertion above must reject it.
            if (OpenAiCompatibleChatClient.Redact(CollapseAndCut(input)) != expected)
            {
                orderingMistakesCaught++;
            }
        }

        // Guards against a row that never crosses character 300 and so proves nothing.
        straddling.Should().BeGreaterThan(5);
        // Guards against a row on which the ordering mistake would go unnoticed.
        orderingMistakesCaught.Should().BeGreaterThan(0);
    }

    private static string CollapseAndCut(string text)
    {
        string singleLine = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return singleLine.Length <= 300 ? singleLine : singleLine[..300] + "…";
    }

    [Fact]
    public void RedactionPatterns_EveryIgnoreCasePatternIsAlsoCultureInvariant()
    {
        foreach (Regex pattern in OpenAiCompatibleChatClient.RedactionPatterns.Where(p => p.Options.HasFlag(RegexOptions.IgnoreCase)))
        {
            pattern.Options.Should().HaveFlag(RegexOptions.CultureInvariant, pattern.ToString());
        }

        OpenAiCompatibleChatClient.RedactionPatterns.Should().Contain(p => p.Options.HasFlag(RegexOptions.IgnoreCase));
    }

    [Fact]
    public void ErrorExcerpt_RedactsUppercaseHeaderNamesUnderTurkishCulture()
    {
        // The patterns are static and built with whatever culture is current at type init; CultureInvariant makes the
        // uppercase "I" in AUTHORIZATION fold to "i" regardless, which this guards.
        CultureInfo original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            OpenAiCompatibleChatClient.ErrorExcerpt("AUTHORIZATION=abc123").Should().Be("AUTHORIZATION=[redacted]");
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    public static TheoryData<string, string> AdversarialBodies => new()
    {
        { "authorization-200k-a", "authorization: " + new string('a', 200_000) },
        { "bearer-200k-a", "Bearer " + new string('a', 200_000) },
        { "api_key-colon-x30k", string.Concat(Enumerable.Repeat("api_key:", 30_000)) },
        { "authorization-bearer-x20k", string.Concat(Enumerable.Repeat("authorization:Bearer ", 20_000)) },
        { "bearer-a-x30k", string.Concat(Enumerable.Repeat("Bearer a", 30_000)) },
        { "single-quoted-key-x30k", string.Concat(Enumerable.Repeat("{'key':'", 30_000)) },
        { "escaped-json-key-x30k", string.Concat(Enumerable.Repeat("\\\"key\\\":", 30_000)) },
        { "numeric-token-x30k", string.Concat(Enumerable.Repeat("\"token\": 1", 30_000)) },
        { "asksk-x40k", string.Concat(Enumerable.Repeat("asksk-", 40_000)) },
        { "sk-a-x60k", "x" + string.Concat(Enumerable.Repeat("sk-a", 60_000)) },
        { "token-backslash-pairs", "\"token\":\"" + string.Concat(Enumerable.Repeat("\\\\", 100_000)) },
    };

    [Theory]
    [MemberData(nameof(AdversarialBodies))]
    public void ErrorExcerpt_AdversarialBodiesFinishQuickly(string name, string body)
    {
        // Construct the compiled regexes before timing.
        OpenAiCompatibleChatClient.ErrorExcerpt("warm-up");

        Stopwatch stopwatch = Stopwatch.StartNew();
        OpenAiCompatibleChatClient.ErrorExcerpt(body);
        stopwatch.Stop();

        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(2), name);
    }

    [Fact]
    public async Task ChatClient_RateLimitReadsRetryAfterHeaderAndDailyQuota()
    {
        OpenAiCompatibleChatClient client = new(new HttpClient(new FakeChatHandler((_, _) =>
        {
            HttpResponseMessage response = Body((HttpStatusCode)429, "{\"error\":{\"message\":\"Rate limit reached on tokens per day (TPD)\"}}");
            response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(90));
            return response;
        })), new CapturingLogger());

        ChatCompletionResult result = await client.CompleteAsync(new LlmVendorEndpoint("Groq", "https://api.groq.com/openai/v1", "key"), "m", new ChatCompletionRequest("s", "u", 100, 0.2), CancellationToken.None);

        result.Outcome.Should().Be(LlmAttemptOutcome.RateLimited);
        result.RetryAfter.Should().Be(TimeSpan.FromSeconds(90));
        result.DailyQuotaExhausted.Should().BeTrue();
    }

    [Fact]
    public async Task ChatClient_RateLimitReadsGeminiRetryDelayFromBody()
    {
        OpenAiCompatibleChatClient client = new(new HttpClient(new FakeChatHandler((_, _) =>
            Body((HttpStatusCode)429, "[{\"error\":{\"code\":429,\"details\":[{\"@type\":\"type.googleapis.com/google.rpc.RetryInfo\",\"retryDelay\":\"37s\"}]}}]"))), new CapturingLogger());

        ChatCompletionResult result = await client.CompleteAsync(new LlmVendorEndpoint("Gemini", "https://g.test", "key"), "m", new ChatCompletionRequest("s", "u", 100, 0.2), CancellationToken.None);

        result.Outcome.Should().Be(LlmAttemptOutcome.RateLimited);
        result.RetryAfter.Should().Be(TimeSpan.FromSeconds(37));
        result.DailyQuotaExhausted.Should().BeFalse();
    }
}
