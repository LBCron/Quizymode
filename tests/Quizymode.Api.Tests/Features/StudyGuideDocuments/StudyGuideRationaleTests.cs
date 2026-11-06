using FluentAssertions;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>AC 3.27.5: generated "why this option is wrong" text is parsed, stored and carried into accepted items.</summary>
public sealed class StudyGuideRationaleTests
{
    private const string Json =
        "{\"questions\":[" +
        "{\"question\":\"What is the capital of France?\",\"correctAnswer\":\"Capital is Paris\"," +
        "\"incorrectAnswers\":[\"Capital is Lyon\",\"Capital is Nice\"]," +
        "\"incorrectAnswerRationale\":{\"capital is nice\":\"The guide names Paris, not Nice.\",\"Capital is Lyon\":\"Lyon is not the capital.\",\"Not an answer\":\"ignored\"}," +
        "\"explanation\":\"The guide names Paris.\"," +
        "\"sourceQuote\":\"Paris is the capital and most populous city of France\",\"page\":null}" +
        "]}";

    [Fact]
    public void Parse_MapsRationaleToIncorrectAnswerIndexesByText()
    {
        CandidateParseResult result = StudyGuideCandidateParser.Parse(
            Json,
            StudyGuideTestData.SectionText,
            20,
            StudyGuideTestData.Moderation());

        ParsedCandidate candidate = result.Kept.Should().ContainSingle().Subject;
        candidate.IncorrectAnswerRationale.Should().BeEquivalentTo(new Dictionary<int, string>
        {
            [0] = "Lyon is not the capital.",
            [1] = "The guide names Paris, not Nice.",
        });
    }

    [Fact]
    public void Parse_WithoutRationale_KeepsQuestionWithEmptyRationale()
    {
        const string withoutRationale =
            "{\"questions\":[{\"question\":\"What is the capital of France?\",\"correctAnswer\":\"Capital is Paris\"," +
            "\"incorrectAnswers\":[\"Capital is Lyon\"],\"explanation\":\"The guide names Paris.\"," +
            "\"sourceQuote\":\"Paris is the capital and most populous city of France\",\"page\":null}]}";

        CandidateParseResult result = StudyGuideCandidateParser.Parse(
            withoutRationale,
            StudyGuideTestData.SectionText,
            20,
            StudyGuideTestData.Moderation());

        result.Kept.Should().ContainSingle().Which.IncorrectAnswerRationale.Should().BeEmpty();
    }

    [Fact]
    public void MapRationale_FollowsAnswerTextAfterReorder()
    {
        GenerationCandidate candidate = Candidate(
            incorrectAnswers: "[\"Capital is Lyon\",\"Capital is Nice\"]",
            rationale: "{\"0\":\"Lyon is not the capital.\",\"1\":\"The guide names Paris, not Nice.\"}");

        Dictionary<int, string>? mapped = AcceptStudyGuideCandidates.MapRationale(
            candidate,
            ["Capital is Nice", "Capital is Lyon"]);

        mapped.Should().BeEquivalentTo(new Dictionary<int, string>
        {
            [0] = "The guide names Paris, not Nice.",
            [1] = "Lyon is not the capital.",
        });
    }

    [Fact]
    public void MapRationale_DropsRationaleWhenItsAnswerWasEdited()
    {
        GenerationCandidate candidate = Candidate(
            incorrectAnswers: "[\"Capital is Lyon\"]",
            rationale: "{\"0\":\"Lyon is not the capital.\"}");

        Dictionary<int, string>? mapped = AcceptStudyGuideCandidates.MapRationale(candidate, ["Marseille"]);

        mapped.Should().BeNull();
    }

    [Fact]
    public void MapRationale_NoGeneratedRationale_ReturnsNull()
    {
        GenerationCandidate candidate = Candidate(incorrectAnswers: "[\"Capital is Lyon\"]", rationale: "{}");

        AcceptStudyGuideCandidates.MapRationale(candidate, ["Capital is Lyon"]).Should().BeNull();
    }

    private static GenerationCandidate Candidate(string incorrectAnswers, string rationale) => new()
    {
        Id = Guid.NewGuid(),
        GenerationId = Guid.NewGuid(),
        Question = "What is the capital of France?",
        CorrectAnswer = "Capital is Paris",
        IncorrectAnswersJson = incorrectAnswers,
        IncorrectAnswerRationaleJson = rationale,
        Explanation = "The guide names Paris.",
        SourceQuote = "Paris is the capital and most populous city of France",
    };
}
