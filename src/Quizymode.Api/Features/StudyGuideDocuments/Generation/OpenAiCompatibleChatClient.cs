using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

internal sealed record ChatCompletionRequest(string SystemPrompt, string UserPrompt, int MaxTokens, double Temperature);

/// <summary>
/// Outcome of one vendor call. <see cref="Content"/> is set only on <see cref="LlmAttemptOutcome.Success"/>.
/// <see cref="HttpStatus"/> is the status of every response that was received (including 2xx replies that turn out to
/// be invalid); it is null when no response arrived: vendor not configured, timeout, <see cref="HttpRequestException"/>,
/// or a body read that failed after the headers. <see cref="RetryAfter"/> and <see cref="DailyQuotaExhausted"/> are set
/// only on <see cref="LlmAttemptOutcome.RateLimited"/>, from the <c>Retry-After</c> header (or a <c>retryDelay</c> in the
/// body) and from a body that names a per-day limit.
/// </summary>
internal sealed record ChatCompletionResult(
    LlmAttemptOutcome Outcome,
    string? Content,
    int? InputTokens,
    int? OutputTokens,
    int DurationMs,
    int? HttpStatus = null,
    TimeSpan? RetryAfter = null,
    bool DailyQuotaExhausted = false);

internal interface IOpenAiCompatibleChatClient
{
    Task<ChatCompletionResult> CompleteAsync(
        LlmVendorEndpoint endpoint,
        string model,
        ChatCompletionRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// One typed HttpClient for every OpenAI-compatible chat completions API (Gemini, Groq, Cerebras, OpenRouter, OpenAI): POST
/// <c>{baseUrl}/chat/completions</c> with a Bearer key, JSON mode (<c>response_format: json_object</c>), low temperature,
/// and capped output tokens. OpenAI reasoning models (gpt-5*, o-series) get <c>max_completion_tokens</c> and no
/// temperature, which those models require; gpt-oss models get <c>reasoning_effort: low</c>; a vendor's
/// <see cref="LlmVendorEndpoint.MaxTokens"/> caps the requested output tokens. OpenRouter calls carry the app attribution
/// headers and restrict routing to providers that deny data collection. HTTP 429 is <see cref="LlmAttemptOutcome.RateLimited"/>. The Authorization header is redacted from HTTP logs and keys are never
/// logged. HTTP 401 means a bad key; a 403 is a bad key only when its body says so (otherwise a region/model-access
/// block, a provider error).
/// </summary>
internal sealed class OpenAiCompatibleChatClient(HttpClient httpClient, ILogger<OpenAiCompatibleChatClient> logger)
    : IOpenAiCompatibleChatClient
{
    private readonly HttpClient _httpClient = httpClient;
    private readonly ILogger<OpenAiCompatibleChatClient> _logger = logger;
    private const int MaxErrorExcerptLength = 300;

    public async Task<ChatCompletionResult> CompleteAsync(
        LlmVendorEndpoint endpoint,
        string model,
        ChatCompletionRequest request,
        CancellationToken cancellationToken)
    {
        Stopwatch stopwatch = Stopwatch.StartNew();
        if (!endpoint.IsConfigured)
        {
            return new ChatCompletionResult(LlmAttemptOutcome.ProviderError, null, null, null, 0);
        }

        using HttpRequestMessage httpRequest = new(HttpMethod.Post, $"{endpoint.BaseUrl.TrimEnd('/')}/chat/completions")
        {
            Content = JsonContent.Create(BuildRequestBody(endpoint, model, request))
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", endpoint.ApiKey);
        if (endpoint.Vendor == LlmVendors.OpenRouter)
        {
            httpRequest.Headers.TryAddWithoutValidation("HTTP-Referer", "https://www.quizymode.com");
            httpRequest.Headers.TryAddWithoutValidation("X-Title", "Quizymode");
        }

        try
        {
            using HttpResponseMessage response = await _httpClient.SendAsync(httpRequest, cancellationToken);
            string responseText = await response.Content.ReadAsStringAsync(cancellationToken);
            int elapsed = (int)stopwatch.ElapsedMilliseconds;
            int status = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode)
            {
                LlmAttemptOutcome failure = ClassifyFailure(status, responseText);
                if (failure == LlmAttemptOutcome.AuthError && status != 403)
                {
                    // 401 and 400 bodies are where vendors echo masked key fragments and they add nothing beyond the status,
                    // so they are never logged (AC 5.12.5). A 403 is ambiguous (bad key vs. region/model block), so its
                    // redacted body is the diagnostic and is always logged.
                    _logger.LogWarning(
                        "StudyGuideGeneration: {Vendor} rejected the API key (HTTP {StatusCode}).",
                        endpoint.Vendor,
                        status);
                }
                else if (failure == LlmAttemptOutcome.AuthError)
                {
                    _logger.LogWarning(
                        "StudyGuideGeneration: {Vendor} rejected the API key (HTTP {StatusCode}): {Error}",
                        endpoint.Vendor,
                        status,
                        ErrorExcerpt(responseText));
                }
                else
                {
                    _logger.LogWarning(
                        "StudyGuideGeneration: {Vendor} returned {StatusCode}: {Error}",
                        endpoint.Vendor,
                        status,
                        ErrorExcerpt(responseText));
                }

                if (failure == LlmAttemptOutcome.RateLimited)
                {
                    return new ChatCompletionResult(
                        failure,
                        null,
                        null,
                        null,
                        elapsed,
                        status,
                        ReadRetryAfter(response, responseText),
                        IndicatesDailyQuota(responseText));
                }

                return new ChatCompletionResult(failure, null, null, null, elapsed, status);
            }

            return ReadCompletion(endpoint.Vendor, responseText, elapsed, status);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("StudyGuideGeneration: {Vendor} request timed out.", endpoint.Vendor);
            return new ChatCompletionResult(LlmAttemptOutcome.Timeout, null, null, null, (int)stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning("StudyGuideGeneration: {Vendor} request failed: {Error}", endpoint.Vendor, ex.Message);
            return new ChatCompletionResult(LlmAttemptOutcome.ProviderError, null, null, null, (int)stopwatch.ElapsedMilliseconds);
        }
    }

    internal static JsonObject BuildRequestBody(LlmVendorEndpoint endpoint, string model, ChatCompletionRequest request)
    {
        string vendor = endpoint.Vendor;
        int maxTokens = endpoint.MaxTokens is int cap && cap > 0 ? Math.Min(request.MaxTokens, cap) : request.MaxTokens;
        JsonObject body = new()
        {
            ["model"] = model,
            ["messages"] = new JsonArray(
                new JsonObject { ["role"] = "system", ["content"] = request.SystemPrompt },
                new JsonObject { ["role"] = "user", ["content"] = request.UserPrompt }),
            ["response_format"] = new JsonObject { ["type"] = "json_object" },
            ["stream"] = false
        };

        if (vendor == LlmVendors.OpenAI && IsOpenAiReasoningModel(model))
        {
            body["max_completion_tokens"] = maxTokens;
            // Without this, reasoning can use the whole completion budget before any answer is written.
            body["reasoning_effort"] = ReasoningEffortFor(model);
        }
        else
        {
            body["temperature"] = request.Temperature;
            body["max_tokens"] = maxTokens;
            if (IsGptOssModel(model))
            {
                // gpt-oss (Groq, Cerebras) reasons by default; low effort leaves the output budget for the answer.
                body["reasoning_effort"] = "low";
            }
        }

        if (vendor == LlmVendors.OpenRouter)
        {
            body["provider"] = new JsonObject { ["data_collection"] = "deny" };
        }

        return body;
    }

    /// <summary>The lowest effort each reasoning family accepts: gpt-5 models take "minimal", o-series models "low".</summary>
    internal static string ReasoningEffortFor(string model) =>
        model.Trim().StartsWith("gpt-5", StringComparison.OrdinalIgnoreCase) ? "minimal" : "low";

    /// <summary>
    /// Maps a non-2xx reply to an outcome: 401 is <see cref="LlmAttemptOutcome.AuthError"/>; so is a 403 whose body
    /// indicates a key/credential problem, and a 400 whose body mentions an API key (Gemini answers a bad key with 400
    /// "API key not valid"). Any other 403 (region or model-access block) and everything else is a provider error.
    /// </summary>
    internal static LlmAttemptOutcome ClassifyFailure(int status, string body) =>
        status == 429 ? LlmAttemptOutcome.RateLimited :
        status == 401 ||
        (status == 403 && IndicatesCredentialProblem(body)) ||
        (status == 400 && body.Contains("API key", StringComparison.OrdinalIgnoreCase))
            ? LlmAttemptOutcome.AuthError
            : LlmAttemptOutcome.ProviderError;

    private static readonly string[] CredentialMarkers = ["api key", "api_key", "apikey", "api-key", "authenticat", "credential"];

    private static bool IndicatesCredentialProblem(string body) =>
        CredentialMarkers.Any(marker => body.Contains(marker, StringComparison.OrdinalIgnoreCase));

    private const RegexOptions Opt = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled;
    private const string HeaderNames = @"authorization|x-goog-api-key|x-api-key|api[-_ ]?key|access[-_]?token";
    private const string Schemes = @"(?>(?:(?:bearer|basic|token|digest|apikey)\s+)?)";
    private const string FieldNames = @"api[-_]?key|x-api-key|x-goog-api-key|key|access[-_]?token|token|authorization|secret|password";
    // Token shape (kept case-sensitive with (?-i:)): 16+ characters, or a digit in the first 15, or a symbol inside the
    // value, or a lowercase letter followed by an uppercase one. Ordinary prose such as "required for this endpoint" fails it.
    private const string HeaderTokenShape = @"(?-i:(?=[^\s""',}]{16}|[^\s""',}0-9]{0,14}[0-9]|[A-Za-z]{0,13}[^\s""',}A-Za-z0-9]{1,14}[A-Za-z0-9]|[A-Z]{0,13}[a-z]{1,14}[A-Z]))";
    private const string BearerTokenShape = @"(?-i:(?=[A-Za-z0-9\-._~+/=]{16}|[A-Za-z\-._~+/=]{0,14}[0-9]|[A-Za-z]{0,13}[\-._~+/=]{1,14}[A-Za-z0-9]|[A-Z]{0,13}[a-z]{1,14}[A-Z]))";

    // Applied in order. Each replacement redacts the secret value and keeps the field name, separator and quotes.
    // A value after "=" or inside quotes is always redacted; an unquoted value after ":" and a Bearer token are
    // redacted only when token-shaped. Every bounded or atomic body keeps matching linear on adversarial input.
    private static readonly (Regex Pattern, string Replacement)[] KeyLikePatterns =
    [
        (new(@"\b(" + HeaderNames + @")(\s*[:=]\s*"")(?>(?:[^""\\]|\\.)*)(""?)", Opt), "${1}${2}[redacted]${3}"),
        (new(@"\b(" + HeaderNames + @")(\s*[:=]\s*')(?>(?:[^'\\]|\\.)*)('?)", Opt), "${1}${2}[redacted]${3}"),
        (new(@"\b(" + HeaderNames + @")(\s*[:=]\s*\\"")(?>(?:[^""\\]|\\[^""\\]|\\\\(?:\\\\|\\""|\\[^""\\]|[^""\\]))*)((?:\\"")?)", Opt), "${1}${2}[redacted]${3}"),
        (new(@"\b(" + HeaderNames + @")(\s*=\s*)" + Schemes + @"[^\s""'&#,;}\\]+", Opt), "${1}${2}[redacted]"),
        (new(@"\b(" + HeaderNames + @")(\s*:\s*)" + Schemes + HeaderTokenShape + @"[^\s""',}]+", Opt), "${1}${2}[redacted]"),
        (new(@"\bbearer\s+" + BearerTokenShape + @"[A-Za-z0-9\-._~+/]+=*", Opt), "Bearer [redacted]"),
        (new(@"(""(?:" + FieldNames + @")""\s*:\s*"")(?>(?:[^""\\]|\\.)*)(""?)", Opt), "${1}[redacted]${2}"),
        (new(@"(\\""(?:" + FieldNames + @")\\""\s*:\s*\\"")(?>(?:[^""\\]|\\[^""\\]|\\\\(?:\\\\|\\""|\\[^""\\]|[^""\\]))*)((?:\\"")?)", Opt), "${1}[redacted]${2}"),
        (new(@"('(?:" + FieldNames + @")'\s*:\s*')(?>(?:[^'\\]|\\.)*)('?)", Opt), "${1}[redacted]${2}"),
        (new(@"((?:\\?""|')(?:" + FieldNames + @")(?:\\?""|')\s*:\s*)-?[0-9][0-9.eE+\-]*", Opt), "${1}[redacted]"),
        (new(@"([?&](?:amp;)?(?:key|api_key|apikey|access_token|token)=)[^&\s""'#]+", Opt), "${1}[redacted]"),
        (new(@"(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-*]+", RegexOptions.Compiled), "[redacted]"),
        // Stuck to a preceding letter or digit: needs 20+ key characters with a digit in the first 48 (bounded to stay linear).
        (new(@"(?<=[A-Za-z0-9])sk-(?=[A-Za-z0-9_\-]{20})(?=[A-Za-z_\-]{0,47}[0-9])[A-Za-z0-9_\-*]+", RegexOptions.Compiled), "[redacted]"),
        (new(@"[sr]k_(?:live|test)_[A-Za-z0-9]{8,}", RegexOptions.Compiled), "[redacted]"),
        (new(@"AIza[0-9A-Za-z_\-]*", RegexOptions.Compiled), "[redacted]"),
        (new(@"\*+[A-Za-z0-9]{3,6}", RegexOptions.Compiled), "[redacted]")
    ];

    /// <summary>The redaction regexes in application order; exposed so tests can check their options.</summary>
    internal static IReadOnlyList<Regex> RedactionPatterns { get; } = KeyLikePatterns.Select(rule => rule.Pattern).ToArray();

    /// <summary>
    /// Redacts anything shaped like an API key, bearer token, credential header/field or key URL parameter.
    /// The field name, separator and quotes are kept.
    /// </summary>
    internal static string Redact(string text) =>
        KeyLikePatterns.Aggregate(text, (current, rule) => rule.Pattern.Replace(current, rule.Replacement));

    /// <summary>
    /// A short, single-line excerpt of a vendor error body for the log. Vendor errors describe the problem
    /// (bad key, unknown field, quota); they don't echo our request, so nothing from the study guide is logged.
    /// Key-shaped text is redacted from the whole body first (the name, separator and quotes are kept; ordinary words
    /// that are not token-shaped are left alone), then whitespace is collapsed and the result is cut, so a secret can't straddle the cut.
    /// </summary>
    internal static string ErrorExcerpt(string responseText)
    {
        string singleLine = string.Join(' ', Redact(responseText).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return singleLine.Length <= MaxErrorExcerptLength ? singleLine : singleLine[..MaxErrorExcerptLength] + "…";
    }

    internal static bool IsGptOssModel(string model) =>
        model.Contains("gpt-oss", StringComparison.OrdinalIgnoreCase);

    private static readonly string[] DailyQuotaMarkers = ["perday", "per day", "per_day", "per-day", "daily", "tokens per day", "requests per day"];

    /// <summary>True when a 429 body names a per-day limit (Gemini "...PerDay...", Groq "tokens per day (TPD)", OpenRouter "free-models-per-day").</summary>
    internal static bool IndicatesDailyQuota(string body) =>
        DailyQuotaMarkers.Any(marker => body.Contains(marker, StringComparison.OrdinalIgnoreCase));

    private static readonly Regex RetryDelayPattern = new(@"""retryDelay""\s*:\s*""(\d+(?:\.\d+)?)s""", Opt);

    /// <summary>The <c>Retry-After</c> header (seconds or HTTP date), else a Gemini-style <c>"retryDelay": "37s"</c> in the body.</summary>
    internal static TimeSpan? ReadRetryAfter(HttpResponseMessage response, string body)
    {
        RetryConditionHeaderValue? header = response.Headers.RetryAfter;
        if (header?.Delta is TimeSpan delta && delta > TimeSpan.Zero)
        {
            return delta;
        }

        if (header?.Date is DateTimeOffset date)
        {
            TimeSpan untilDate = date - DateTimeOffset.UtcNow;
            if (untilDate > TimeSpan.Zero)
            {
                return untilDate;
            }
        }

        Match match = RetryDelayPattern.Match(body);
        return match.Success &&
               double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double seconds) &&
               seconds > 0
            ? TimeSpan.FromSeconds(seconds)
            : null;
    }

    internal static bool IsOpenAiReasoningModel(string model)
    {
        string normalized = model.Trim().ToLowerInvariant();
        return normalized.StartsWith("gpt-5", StringComparison.Ordinal) ||
               (normalized.Length > 1 && normalized[0] == 'o' && char.IsDigit(normalized[1]));
    }

    private ChatCompletionResult ReadCompletion(string vendor, string responseText, int elapsed, int status)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(responseText);
            JsonElement root = document.RootElement;
            (int? inputTokens, int? outputTokens) = ReadUsage(root);

            if (!root.TryGetProperty("choices", out JsonElement choices) ||
                choices.ValueKind != JsonValueKind.Array ||
                choices.GetArrayLength() == 0)
            {
                return new ChatCompletionResult(LlmAttemptOutcome.InvalidJson, null, inputTokens, outputTokens, elapsed, status);
            }

            JsonElement choice = choices[0];
            string? finishReason = choice.TryGetProperty("finish_reason", out JsonElement finish) && finish.ValueKind == JsonValueKind.String
                ? finish.GetString()
                : null;

            if (finishReason == "content_filter")
            {
                _logger.LogInformation("StudyGuideGeneration: {Vendor} declined the request (content_filter).", vendor);
                return new ChatCompletionResult(LlmAttemptOutcome.ContentFilter, null, inputTokens, outputTokens, elapsed, status);
            }

            if (finishReason == "length")
            {
                _logger.LogWarning("StudyGuideGeneration: {Vendor} reply hit the output token limit.", vendor);
                return new ChatCompletionResult(LlmAttemptOutcome.InvalidJson, null, inputTokens, outputTokens, elapsed, status);
            }

            string content = choice.TryGetProperty("message", out JsonElement message) &&
                             message.ValueKind == JsonValueKind.Object &&
                             message.TryGetProperty("content", out JsonElement contentElement) &&
                             contentElement.ValueKind == JsonValueKind.String
                ? (contentElement.GetString() ?? string.Empty).Trim()
                : string.Empty;

            return content.Length == 0
                ? new ChatCompletionResult(LlmAttemptOutcome.InvalidJson, null, inputTokens, outputTokens, elapsed, status)
                : new ChatCompletionResult(LlmAttemptOutcome.Success, content, inputTokens, outputTokens, elapsed, status);
        }
        catch (JsonException)
        {
            _logger.LogWarning("StudyGuideGeneration: {Vendor} response was not valid JSON.", vendor);
            return new ChatCompletionResult(LlmAttemptOutcome.InvalidJson, null, null, null, elapsed, status);
        }
    }

    private static (int? Input, int? Output) ReadUsage(JsonElement root)
    {
        if (!root.TryGetProperty("usage", out JsonElement usage) || usage.ValueKind != JsonValueKind.Object)
        {
            return (null, null);
        }

        int? input = usage.TryGetProperty("prompt_tokens", out JsonElement prompt) && prompt.ValueKind == JsonValueKind.Number && prompt.TryGetInt32(out int promptTokens)
            ? promptTokens
            : null;
        int? output = usage.TryGetProperty("completion_tokens", out JsonElement completion) && completion.ValueKind == JsonValueKind.Number && completion.TryGetInt32(out int completionTokens)
            ? completionTokens
            : null;
        return (input, output);
    }
}
