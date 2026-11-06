using System.Text.Json;
using System.Text.RegularExpressions;
using Quizymode.Api.Features.StudyGuideDocuments.Extraction;
using Quizymode.Api.Services;

namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

internal sealed record ParsedCandidate(
    string Question,
    string CorrectAnswer,
    List<string> IncorrectAnswers,
    string Explanation,
    string SourceQuote,
    int? Page);

/// <summary><see cref="ReturnedCount"/> questions came back; <see cref="Kept"/> passed every check.</summary>
internal sealed record CandidateParseResult(bool IsValidJson, int ReturnedCount, List<ParsedCandidate> Kept)
{
    public int DroppedCount => Math.Max(0, ReturnedCount - Kept.Count);

    /// <summary>Fallback trigger: nothing kept, or fewer than half of the returned questions kept.</summary>
    public bool IsLowYield => Kept.Count == 0 || Kept.Count * 2 < ReturnedCount;
}

/// <summary>
/// Parses a prompt-v2 reply and filters it per question (unlike AC 6.5, invalid questions are dropped, not fatal):
/// per-item field rules (same limits as item creation), the source-quote check, the profanity check, and duplicate
/// removal. Pages come from the page marker preceding the matched quote when possible, else the model's page if it
/// names a page in the section.
/// </summary>
internal static class StudyGuideCandidateParser
{
    private static readonly Regex ClinicalPatientCue = new(
        @"\b(client|clients|patient|patients|resident|residents|child|children|infant|newborn|toddler|older adult|adult|woman|man)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ClinicalActionCue = new(
        @"\b(first|priority|priorities|initial|immediate|immediately|red flag|most urgent|urgent)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// AC 6.6.34: a clinical-style question is at most two sentences, describes a client or patient, and asks a priority,
    /// first-action or red-flag question. The processor drops recall-style questions returned under the clinical request.
    /// </summary>
    internal static bool IsClinicalStyle(string question)
    {
        int sentences = question.Split(['.', '?', '!'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Length;
        return sentences is >= 1 and <= 2 &&
            ClinicalPatientCue.IsMatch(question) &&
            ClinicalActionCue.IsMatch(question);
    }

    public static CandidateParseResult Parse(
        string rawText,
        string sectionText,
        int maxQuestions,
        ITextModerationService moderation,
        bool clinicalScenario = false)
    {
        List<JsonElement> elements;
        try
        {
            using JsonDocument document = JsonDocument.Parse(StripCodeFence(rawText));
            JsonElement root = document.RootElement;
            JsonElement array = root;
            if (root.ValueKind == JsonValueKind.Object && !root.TryGetProperty("questions", out array))
            {
                return new CandidateParseResult(false, 0, []);
            }

            if (array.ValueKind != JsonValueKind.Array)
            {
                return new CandidateParseResult(false, 0, []);
            }

            elements = array.EnumerateArray().Select(element => element.Clone()).ToList();
        }
        catch (JsonException)
        {
            return new CandidateParseResult(false, 0, []);
        }

        List<(int? Page, string Normalized)> pageSegments = StudyGuideSectioner.SplitByPageMarkers(sectionText)
            .Select(segment => (segment.Page, StudyGuideQuoteMatcher.Normalize(segment.Text)))
            .ToList();
        string normalizedSource = StudyGuideQuoteMatcher.Normalize(StudyGuideSectioner.StripPageMarkers(sectionText));
        HashSet<int> sectionPages = pageSegments.Where(segment => segment.Page.HasValue).Select(segment => segment.Page!.Value).ToHashSet();

        List<ParsedCandidate> kept = [];
        HashSet<string> seenQuestions = new(StringComparer.Ordinal);
        foreach (JsonElement element in elements.Take(Math.Clamp(maxQuestions, 1, 20)))
        {
            ParsedCandidate? candidate = ReadCandidate(element);
            if (candidate is null)
            {
                continue;
            }

            if (!StudyGuideQuoteMatcher.IsSupported(candidate.SourceQuote, normalizedSource))
            {
                continue;
            }

            string questionKey = StudyGuideQuoteMatcher.Normalize(candidate.Question);
            if (!seenQuestions.Add(questionKey))
            {
                continue;
            }

            if (clinicalScenario && !IsClinicalStyle(candidate.Question))
            {
                continue;
            }

            List<string?> values = [candidate.Question, candidate.CorrectAnswer, candidate.Explanation, candidate.SourceQuote];
            values.AddRange(candidate.IncorrectAnswers);
            if (moderation.Evaluate(values.ToArray()).Outcome == TextModerationOutcome.Blocked)
            {
                continue;
            }

            kept.Add(candidate with { Page = ResolvePage(candidate, pageSegments, sectionPages) });
        }

        return new CandidateParseResult(true, elements.Count, kept);
    }

    private static int? ResolvePage(ParsedCandidate candidate, List<(int? Page, string Normalized)> segments, HashSet<int> sectionPages)
    {
        string quote = StudyGuideQuoteMatcher.Normalize(candidate.SourceQuote);
        foreach ((int? page, string normalized) in segments)
        {
            if (page.HasValue && normalized.Contains(quote, StringComparison.Ordinal))
            {
                return page;
            }
        }

        if (candidate.Page is int reported && sectionPages.Contains(reported))
        {
            return reported;
        }

        return sectionPages.Count == 1 ? sectionPages.First() : null;
    }

    private static ParsedCandidate? ReadCandidate(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string question = GetString(element, "question");
        string correctAnswer = GetString(element, "correctAnswer");
        string explanation = GetString(element, "explanation");
        string sourceQuote = GetString(element, "sourceQuote");
        if (question.Length is 0 or > 1000 ||
            correctAnswer.Length is 0 or > 500 ||
            explanation.Length > 4000 ||
            sourceQuote.Length is 0 or > 1000)
        {
            return null;
        }

        if (!element.TryGetProperty("incorrectAnswers", out JsonElement incorrectElement) ||
            incorrectElement.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        List<string> incorrect = incorrectElement.EnumerateArray()
            .Where(answer => answer.ValueKind == JsonValueKind.String)
            .Select(answer => (answer.GetString() ?? string.Empty).Trim())
            .Where(answer => answer.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(answer => !string.Equals(answer, correctAnswer, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (incorrect.Count is < 1 or > 4 || incorrect.Any(answer => answer.Length > 500))
        {
            return null;
        }

        int? page = element.TryGetProperty("page", out JsonElement pageElement) && pageElement.ValueKind == JsonValueKind.Number &&
                    pageElement.TryGetInt32(out int pageNumber) && pageNumber > 0
            ? pageNumber
            : null;

        return new ParsedCandidate(question, correctAnswer, incorrect, explanation, sourceQuote, page);
    }

    private static string GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? (value.GetString() ?? string.Empty).Trim()
            : string.Empty;

    private static string StripCodeFence(string text)
    {
        string trimmed = text.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        int firstNewline = trimmed.IndexOf('\n');
        int lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        return firstNewline < 0 || lastFence <= firstNewline ? trimmed : trimmed[(firstNewline + 1)..lastFence].Trim();
    }
}
