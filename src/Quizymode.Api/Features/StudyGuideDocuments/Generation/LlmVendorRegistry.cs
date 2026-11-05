namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

/// <summary>Known OpenAI-compatible vendors (canonical names as stored in routes and attempt logs).</summary>
internal static class LlmVendors
{
    public const string Gemini = "Gemini";
    public const string Groq = "Groq";
    public const string Cerebras = "Cerebras";
    public const string OpenRouter = "OpenRouter";
    public const string OpenAI = "OpenAI";

    public static readonly IReadOnlyList<string> All = [Gemini, Groq, Cerebras, OpenRouter, OpenAI];

    /// <summary>Canonical vendor name for a case-insensitive match, or null when unknown (e.g. the retired "DeepSeek").</summary>
    public static string? Normalize(string? value) =>
        All.FirstOrDefault(vendor => string.Equals(vendor, value?.Trim(), StringComparison.OrdinalIgnoreCase));
}

/// <summary>
/// Base URL, API key and optional output-token cap for one vendor. The key is never logged, returned, or included in
/// <see cref="ToString"/>.
/// </summary>
internal sealed class LlmVendorEndpoint(string vendor, string baseUrl, string apiKey, int? maxTokens = null)
{
    public string Vendor { get; } = vendor;

    public string BaseUrl { get; } = baseUrl;

    public string ApiKey { get; } = apiKey;

    /// <summary>Upper bound on the output tokens requested from this vendor (<c>{Vendor}:MaxTokens</c>); null means no cap.</summary>
    public int? MaxTokens { get; } = maxTokens;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);

    public override string ToString() => $"{Vendor} ({BaseUrl})";
}

internal interface ILlmVendorRegistry
{
    LlmVendorEndpoint Get(string vendor);

    bool IsConfigured(string vendor);

    bool AnyConfigured { get; }
}

/// <summary>
/// Vendor endpoints from configuration only (never the database): <c>{Vendor}:ApiKey</c> or env <c>{VENDOR}_API_KEY</c>
/// (<c>GEMINI_API_KEY</c>, <c>GROQ_API_KEY</c>, <c>CEREBRAS_API_KEY</c>, <c>OPENROUTER_API_KEY</c>, <c>OPENAI_API_KEY</c>);
/// base URLs default to the vendors' OpenAI-compatible endpoints and can be overridden with <c>{Vendor}:BaseUrl</c>;
/// <c>{Vendor}:MaxTokens</c> caps the output tokens requested (Groq defaults to 4000 to stay inside its 8K tokens/minute free limit).
/// </summary>
internal sealed class LlmVendorRegistry : ILlmVendorRegistry
{
    public const int DefaultGroqMaxTokens = 4000;

    private readonly Dictionary<string, LlmVendorEndpoint> _endpoints;

    public LlmVendorRegistry(IConfiguration configuration)
    {
        _endpoints = new Dictionary<string, LlmVendorEndpoint>(StringComparer.OrdinalIgnoreCase)
        {
            [LlmVendors.Gemini] = Read(configuration, LlmVendors.Gemini, "GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai", null),
            [LlmVendors.Groq] = Read(configuration, LlmVendors.Groq, "GROQ_API_KEY", "https://api.groq.com/openai/v1", DefaultGroqMaxTokens),
            [LlmVendors.Cerebras] = Read(configuration, LlmVendors.Cerebras, "CEREBRAS_API_KEY", "https://api.cerebras.ai/v1", null),
            [LlmVendors.OpenRouter] = Read(configuration, LlmVendors.OpenRouter, "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", null),
            [LlmVendors.OpenAI] = Read(configuration, LlmVendors.OpenAI, "OPENAI_API_KEY", "https://api.openai.com/v1", null)
        };
    }

    public LlmVendorEndpoint Get(string vendor) =>
        _endpoints.TryGetValue(vendor, out LlmVendorEndpoint? endpoint)
            ? endpoint
            : new LlmVendorEndpoint(vendor, string.Empty, string.Empty);

    public bool IsConfigured(string vendor) => Get(vendor).IsConfigured;

    public bool AnyConfigured => _endpoints.Values.Any(endpoint => endpoint.IsConfigured);

    private static LlmVendorEndpoint Read(IConfiguration configuration, string section, string environmentVariable, string defaultBaseUrl, int? defaultMaxTokens)
    {
        string? apiKey = configuration[$"{section}:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            apiKey = configuration[environmentVariable];
        }

        string? baseUrl = configuration[$"{section}:BaseUrl"];
        int? maxTokens = int.TryParse(configuration[$"{section}:MaxTokens"], out int configured) && configured > 0
            ? configured
            : defaultMaxTokens;
        return new LlmVendorEndpoint(
            section,
            string.IsNullOrWhiteSpace(baseUrl) ? defaultBaseUrl : baseUrl.Trim(),
            apiKey?.Trim() ?? string.Empty,
            maxTokens);
    }
}
