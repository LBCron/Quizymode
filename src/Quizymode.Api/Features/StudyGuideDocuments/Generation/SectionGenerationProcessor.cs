using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

/// <summary>
/// Runs one claimed generation (AC 6.6): takes the tier's vendor route (premium route when the job's tier is Premium),
/// skips vendors without an API key and vendors cooling down after an HTTP 429 (unless every keyed vendor is cooling
/// down, then the whole keyed route is tried), and tries them in order with prompt v2. A vendor attempt fails over to the next
/// vendor on a provider error, rate limit (429, which also starts the vendor's cooldown), auth error (rejected key), timeout, content-filter stop, invalid JSON, or low quote yield (no question kept, or fewer
/// than half kept). Every attempt is logged in <c>LlmAttempts</c> with its outcome and the vendor's HTTP status. On success the candidates are saved, the source text is
/// cleared, and tokens/vendor/model are recorded. When every vendor fails, the best low-yield result is kept if it has
/// at least one verified question; otherwise the job is Failed with a user-safe error and its quota charges are refunded.
/// Idempotent: jobs that are missing or no longer Processing are skipped.
/// </summary>
internal sealed class SectionGenerationProcessor(
    ApplicationDbContext db,
    IOpenAiCompatibleChatClient chatClient,
    ILlmVendorRegistry vendors,
    LlmVendorCooldowns cooldowns,
    ITextModerationService moderation,
    IOptions<StudyGuideGenerationOptions> options,
    TimeProvider timeProvider,
    ILogger<SectionGenerationProcessor> logger)
{
    public const string FailureMessage =
        "We couldn't generate questions for this section right now. The section was not charged; please try again later.";

    private static readonly JsonSerializerOptions AnswerJsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ApplicationDbContext _db = db;
    private readonly IOpenAiCompatibleChatClient _chatClient = chatClient;
    private readonly ILlmVendorRegistry _vendors = vendors;
    private readonly LlmVendorCooldowns _cooldowns = cooldowns;
    private readonly ITextModerationService _moderation = moderation;
    private readonly StudyGuideGenerationOptions _options = options.Value;
    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly ILogger<SectionGenerationProcessor> _logger = logger;

    public async Task ProcessAsync(Guid generationId, CancellationToken cancellationToken)
    {
        SectionGeneration? generation = await _db.SectionGenerations
            .FirstOrDefaultAsync(g => g.Id == generationId, cancellationToken);
        if (generation is null || generation.Status != SectionGenerationStatus.Processing)
        {
            return;
        }

        if (generation.Attempts > Math.Max(1, _options.MaxAttempts) || string.IsNullOrWhiteSpace(generation.SourceText))
        {
            await FailAsync(generation, cancellationToken);
            return;
        }

        LlmProviderSettings settings = await LlmProviderSettingsStore.GetOrCreateAsync(_db, cancellationToken);
        List<string> configuredRoute = LlmProviderSettingsStore.RouteFor(settings, generation.Tier);
        List<string> route = configuredRoute.Where(_vendors.IsConfigured).ToList();
        List<string> skipped = configuredRoute.Except(route).ToList();
        if (skipped.Count > 0)
        {
            // A missing optional key is a configuration state, not an outage, and repeats on every generation,
            // so it is Debug (#490). The Warning for a route with no keyed vendor at all stays below.
            _logger.LogDebug(
                "StudyGuideGeneration: {GenerationId} skipped vendor(s) without a key in the {Tier} route: {Vendors}.",
                generation.Id,
                generation.Tier,
                string.Join(", ", skipped));
        }

        if (route.Count == 0)
        {
            _logger.LogWarning("StudyGuideGeneration: no configured vendor in the {Tier} route.", generation.Tier);
            await FailAsync(generation, cancellationToken);
            return;
        }

        List<string> available = route.Where(vendor => !_cooldowns.IsCoolingDown(vendor)).ToList();
        if (available.Count == 0)
        {
            // Cooldowns are an optimization; they must not fail a job on their own.
            _logger.LogInformation(
                "StudyGuideGeneration: {GenerationId} every keyed vendor in the {Tier} route is cooling down; trying them anyway.",
                generation.Id,
                generation.Tier);
        }
        else
        {
            foreach (string vendor in route.Except(available))
            {
                _logger.LogInformation(
                    "StudyGuideGeneration: {GenerationId} skipped {Vendor}: rate-limited, cooling down until {Until:u}.",
                    generation.Id,
                    vendor,
                    _cooldowns.CoolingDownUntil(vendor));
            }

            route = available;
        }

        string sourceText = generation.SourceText;
        int maxQuestions = Math.Clamp(_options.MaxQuestions, 1, 20);
        bool clinicalScenario = generation.Mode == SectionGeneration.ClinicalScenarioMode;
        ChatCompletionRequest request = new(
            StudyGuidePromptV2.SystemPromptFor(clinicalScenario),
            StudyGuidePromptV2.BuildUserPrompt(sourceText, maxQuestions, clinicalScenario),
            Math.Max(256, _options.MaxTokens),
            _options.Temperature);

        (string Vendor, string Model, ChatCompletionResult Result, CandidateParseResult Parsed)? best = null;
        foreach (string vendor in route)
        {
            string model = LlmProviderSettingsStore.ModelFor(settings, vendor);
            generation.LeaseUntilUtc = Now().AddMinutes(Math.Max(1, _options.LeaseMinutes));
            await _db.SaveChangesAsync(cancellationToken);

            ChatCompletionResult result = await _chatClient.CompleteAsync(_vendors.Get(vendor), model, request, cancellationToken);
            LlmAttemptOutcome outcome = result.Outcome;
            if (outcome == LlmAttemptOutcome.RateLimited)
            {
                DateTimeOffset until = _cooldowns.Start(vendor, result.RetryAfter, result.DailyQuotaExhausted);
                _logger.LogWarning(
                    "StudyGuideGeneration: {Vendor} is rate-limited{Daily}; cooling down until {Until:u}.",
                    vendor,
                    result.DailyQuotaExhausted ? " (daily quota)" : string.Empty,
                    until);
            }

            CandidateParseResult? parsed = null;
            if (outcome == LlmAttemptOutcome.Success)
            {
                parsed = StudyGuideCandidateParser.Parse(result.Content ?? string.Empty, sourceText, maxQuestions, _moderation, clinicalScenario);
                if (!parsed.IsValidJson)
                {
                    outcome = LlmAttemptOutcome.InvalidJson;
                }
                else if (parsed.IsLowYield)
                {
                    outcome = LlmAttemptOutcome.LowQuoteYield;
                    if (parsed.Kept.Count > 0 && (best is null || parsed.Kept.Count > best.Value.Parsed.Kept.Count))
                    {
                        best = (vendor, model, result, parsed);
                    }
                }
            }

            _db.LlmAttempts.Add(new LlmAttempt
            {
                Id = Guid.NewGuid(),
                GenerationId = generation.Id,
                Vendor = vendor,
                Model = model,
                Outcome = outcome,
                InputTokens = result.InputTokens,
                OutputTokens = result.OutputTokens,
                DurationMs = result.DurationMs,
                HttpStatus = result.HttpStatus,
                CreatedUtc = Now()
            });
            LogAttempt(generation.Id, vendor, model, outcome, result);

            if (outcome == LlmAttemptOutcome.Success && parsed is not null)
            {
                await CompleteAsync(generation, vendor, model, result, parsed, cancellationToken);
                return;
            }

            await _db.SaveChangesAsync(cancellationToken);
        }

        if (best is not null)
        {
            await CompleteAsync(generation, best.Value.Vendor, best.Value.Model, best.Value.Result, best.Value.Parsed, cancellationToken);
            return;
        }

        await FailAsync(generation, cancellationToken);
    }

    private async Task CompleteAsync(
        SectionGeneration generation,
        string vendor,
        string model,
        ChatCompletionResult result,
        CandidateParseResult parsed,
        CancellationToken cancellationToken)
    {
        DateTime now = Now();
        generation.Status = SectionGenerationStatus.Completed;
        generation.Vendor = vendor;
        generation.Model = model;
        generation.InputTokens = result.InputTokens;
        generation.OutputTokens = result.OutputTokens;
        generation.DroppedCount = parsed.DroppedCount;
        generation.Error = null;
        generation.SourceText = null;
        generation.LeaseUntilUtc = null;
        generation.CompletedUtc = now;

        List<GenerationCandidate> existing = await _db.GenerationCandidates
            .Where(candidate => candidate.GenerationId == generation.Id)
            .ToListAsync(cancellationToken);
        _db.GenerationCandidates.RemoveRange(existing);
        _db.GenerationCandidates.AddRange(parsed.Kept.Select((candidate, index) => new GenerationCandidate
        {
            Id = Guid.NewGuid(),
            GenerationId = generation.Id,
            Index = index,
            Question = candidate.Question,
            CorrectAnswer = candidate.CorrectAnswer,
            IncorrectAnswersJson = JsonSerializer.Serialize(candidate.IncorrectAnswers, AnswerJsonOptions),
            IncorrectAnswerRationaleJson = JsonSerializer.Serialize(candidate.IncorrectAnswerRationale ?? [], AnswerJsonOptions),
            Explanation = candidate.Explanation,
            SourceQuote = candidate.SourceQuote,
            Page = candidate.Page
        }));

        await _db.SaveChangesAsync(cancellationToken);
        _logger.LogInformation(
            "StudyGuideGeneration: {GenerationId} ({Mode}) completed by {Vendor} ({Model}) with {Kept} question(s), {Dropped} dropped.",
            generation.Id,
            generation.Mode,
            vendor,
            model,
            parsed.Kept.Count,
            parsed.DroppedCount);
    }

    /// <summary>
    /// One line per vendor attempt, the same data as the LlmAttempts row (AC 5.12.3) so a failure is diagnosable from Grafana alone.
    /// The redacted vendor error excerpt is logged by OpenAiCompatibleChatClient on the same attempt (AC 5.12.5).
    /// </summary>
    private void LogAttempt(Guid generationId, string vendor, string model, LlmAttemptOutcome outcome, ChatCompletionResult result)
    {
        // Success, low yield and content-filter replies are normal results. Everything else means the vendor did not deliver a usable answer.
        LogLevel level = outcome is LlmAttemptOutcome.Success or LlmAttemptOutcome.LowQuoteYield or LlmAttemptOutcome.ContentFilter
            ? LogLevel.Information
            : LogLevel.Warning;
        _logger.Log(
            level,
            "StudyGuideGeneration: {GenerationId} attempt with {Vendor} ({Model}) ended {Outcome}; HTTP {HttpStatus}, {DurationMs} ms, tokens in {InputTokens} out {OutputTokens}.",
            generationId,
            vendor,
            model,
            outcome,
            result.HttpStatus?.ToString() ?? "none",
            result.DurationMs,
            result.InputTokens?.ToString() ?? "n/a",
            result.OutputTokens?.ToString() ?? "n/a");
    }

    /// <summary>Marks the job Failed with a user-safe error and refunds every quota charge attached to it.</summary>
    internal async Task FailAsync(SectionGeneration generation, CancellationToken cancellationToken)
    {
        DateTime now = Now();
        generation.Status = SectionGenerationStatus.Failed;
        generation.Error = FailureMessage;
        generation.SourceText = null;
        generation.LeaseUntilUtc = null;
        generation.CompletedUtc = now;

        List<StudyGuideQuotaCharge> charges = await _db.StudyGuideQuotaCharges
            .Where(charge => charge.GenerationId == generation.Id)
            .ToListAsync(cancellationToken);
        _db.StudyGuideQuotaCharges.RemoveRange(charges);
        await _db.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "StudyGuideGeneration: {GenerationId} failed after {Attempts} attempt(s); refunded {Count} charge(s).",
            generation.Id,
            generation.Attempts,
            charges.Count);
    }

    private DateTime Now() => _timeProvider.GetUtcNow().UtcDateTime;
}
