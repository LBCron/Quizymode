using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

/// <summary>
/// Reads the single admin routing row (AC 5.12), seeding defaults on first read: models Gemini <c>gemini-3.5-flash-lite</c>,
/// Groq <c>openai/gpt-oss-120b</c>, Cerebras <c>gpt-oss-120b</c>, OpenRouter <c>google/gemma-4-31b-it:free</c>, OpenAI
/// <c>gpt-5-nano</c>; free route Gemini → Groq → Cerebras → OpenRouter → OpenAI; premium route OpenAI → Gemini → Cerebras
/// → Groq → OpenRouter.
/// </summary>
internal static class LlmProviderSettingsStore
{
    public const string DefaultGeminiModel = "gemini-3.5-flash-lite";
    public const string DefaultGroqModel = "openai/gpt-oss-120b";
    public const string DefaultCerebrasModel = "gpt-oss-120b";
    public const string DefaultOpenRouterModel = "google/gemma-4-31b-it:free";
    public const string DefaultOpenAiModel = "gpt-5-nano";

    public static readonly IReadOnlyDictionary<string, string> DefaultModels = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [LlmVendors.Gemini] = DefaultGeminiModel,
        [LlmVendors.Groq] = DefaultGroqModel,
        [LlmVendors.Cerebras] = DefaultCerebrasModel,
        [LlmVendors.OpenRouter] = DefaultOpenRouterModel,
        [LlmVendors.OpenAI] = DefaultOpenAiModel
    };

    public static readonly IReadOnlyList<string> DefaultRouteFree =
        [LlmVendors.Gemini, LlmVendors.Groq, LlmVendors.Cerebras, LlmVendors.OpenRouter, LlmVendors.OpenAI];

    public static readonly IReadOnlyList<string> DefaultRoutePremium =
        [LlmVendors.OpenAI, LlmVendors.Gemini, LlmVendors.Cerebras, LlmVendors.Groq, LlmVendors.OpenRouter];

    public static async Task<LlmProviderSettings> GetOrCreateAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        LlmProviderSettings? settings = await db.LlmProviderSettings
            .FirstOrDefaultAsync(row => row.Id == LlmProviderSettings.SingletonId, cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        settings = CreateDefaults(DateTime.UtcNow);
        db.LlmProviderSettings.Add(settings);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another request seeded the row first.
            db.Entry(settings).State = EntityState.Detached;
            settings = await db.LlmProviderSettings.FirstAsync(row => row.Id == LlmProviderSettings.SingletonId, cancellationToken);
        }

        return settings;
    }

    /// <summary>True when at least one vendor in the tier's saved route has an API key (so a job for that tier can run).</summary>
    public static async Task<bool> IsTierRouteAvailableAsync(
        ApplicationDbContext db,
        ILlmVendorRegistry vendors,
        StudyGuideTier tier,
        CancellationToken cancellationToken)
    {
        if (!vendors.AnyConfigured)
        {
            return false;
        }

        LlmProviderSettings settings = await GetOrCreateAsync(db, cancellationToken);
        return RouteFor(settings, tier).Any(vendors.IsConfigured);
    }

    public static LlmProviderSettings CreateDefaults(DateTime nowUtc) =>
        new()
        {
            Id = LlmProviderSettings.SingletonId,
            Models = new Dictionary<string, string>(DefaultModels, StringComparer.Ordinal),
            RouteFree = FormatRoute(DefaultRouteFree),
            RoutePremium = FormatRoute(DefaultRoutePremium),
            UpdatedUtc = nowUtc
        };

    /// <summary>The saved model for a vendor, else the vendor's default (a vendor added after the row was saved), else empty.</summary>
    public static string ModelFor(LlmProviderSettings settings, string vendor) =>
        settings.Models.TryGetValue(vendor, out string? model) && !string.IsNullOrWhiteSpace(model)
            ? model
            : DefaultModels.GetValueOrDefault(vendor, string.Empty);

    /// <summary>Replaces the dictionary so EF change tracking always sees the update.</summary>
    public static void SetModel(LlmProviderSettings settings, string vendor, string model) =>
        settings.Models = new Dictionary<string, string>(settings.Models, StringComparer.Ordinal) { [vendor] = model };

    public static List<string> RouteFor(LlmProviderSettings settings, StudyGuideTier tier) =>
        ParseRoute(tier == StudyGuideTier.Premium ? settings.RoutePremium : settings.RouteFree);

    public static List<string> ParseRoute(string? route) =>
        (route ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(LlmVendors.Normalize)
            .Where(vendor => vendor is not null)
            .Select(vendor => vendor!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

    public static string FormatRoute(IEnumerable<string> vendors) => string.Join(",", vendors);
}
