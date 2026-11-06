using FluentAssertions;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>AC 6.6.34: clinical-scenario generations keep only clinical-style questions.</summary>
public sealed class StudyGuideClinicalStyleTests
{
    private const string ClinicalQuestion =
        "A client with suspected meningitis is admitted to the unit. Which action should the nurse take first?";

    private const string RecallQuestion = "Which type of precautions should the nurse implement?";

    private const string Json =
        "{\"questions\":[" +
        "{\"question\":\"" + ClinicalQuestion + "\",\"correctAnswer\":\"Capital is Paris\"," +
        "\"incorrectAnswers\":[\"Capital is Lyon\",\"Capital is Nice\"],\"explanation\":\"The guide names Paris.\"," +
        "\"sourceQuote\":\"Paris is the capital and most populous city of France\",\"page\":null}," +
        "{\"question\":\"" + RecallQuestion + "\",\"correctAnswer\":\"Droplet precautions\"," +
        "\"incorrectAnswers\":[\"Gloves only\",\"Gown only\"],\"explanation\":\"The guide names Berlin.\"," +
        "\"sourceQuote\":\"Berlin is the capital of Germany and its largest city by population\",\"page\":null}" +
        "]}";

    [Theory]
    [InlineData("A client with suspected meningitis is admitted. Which action should the nurse take first?", true)]
    [InlineData("A patient reports chest pain. What is the priority intervention?", true)]
    [InlineData("A client is admitted with bacterial meningitis. Which type of precautions should the nurse implement?", false)]
    [InlineData("Which type of precautions should the nurse implement?", false)]
    [InlineData("What is the normal range for adult body temperature?", false)]
    [InlineData("A client is admitted. The client is confused. The client has a fever. Which action should the nurse take first?", false)]
    public void IsClinicalStyle_RequiresShortPatientScenarioAndActionQuestion(string question, bool expected)
    {
        StudyGuideCandidateParser.IsClinicalStyle(question).Should().Be(expected);
    }

    [Fact]
    public void Parse_ClinicalScenario_DropsRecallStyleQuestions()
    {
        CandidateParseResult result = StudyGuideCandidateParser.Parse(
            Json,
            StudyGuideTestData.SectionText,
            20,
            StudyGuideTestData.Moderation(),
            clinicalScenario: true);

        result.Kept.Should().ContainSingle().Which.Question.Should().Be(ClinicalQuestion);
        result.DroppedCount.Should().Be(1);
    }

    [Fact]
    public void Parse_RecallStyle_KeepsBothQuestions()
    {
        CandidateParseResult result = StudyGuideCandidateParser.Parse(
            Json,
            StudyGuideTestData.SectionText,
            20,
            StudyGuideTestData.Moderation());

        result.Kept.Should().HaveCount(2);
        result.DroppedCount.Should().Be(0);
    }
}
