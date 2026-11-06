using FluentAssertions;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>Question style prompts (#368): recall is the default, clinical scenario asks for patient scenarios.</summary>
public sealed class StudyGuidePromptV2Tests
{
    [Fact]
    public void BuildUserPrompt_DefaultsToRecallWithoutScenarioRule()
    {
        string prompt = StudyGuidePromptV2.BuildUserPrompt("Section text", 5);

        prompt.Should().NotContain("Clinical scenario style");
        StudyGuidePromptV2.SystemPromptFor(clinicalScenario: false).Should().Be(StudyGuidePromptV2.SystemPrompt);
    }

    [Fact]
    public void BuildUserPrompt_ClinicalScenarioAddsScenarioRuleAndSystemPrompt()
    {
        string prompt = StudyGuidePromptV2.BuildUserPrompt("Section text", 5, clinicalScenario: true);

        prompt.Should().Contain("Clinical scenario style: each question is at most two sentences");
        prompt.Should().Contain("<study_guide_section>\nSection text\n</study_guide_section>");
        StudyGuidePromptV2.SystemPromptFor(clinicalScenario: true).Should().Be(StudyGuidePromptV2.ClinicalSystemPrompt);
    }

    [Fact]
    public void ModeFor_MapsOnlyClinicalScenarioToTheClinicalMode()
    {
        SectionGeneration.ModeFor("ClinicalScenario").Should().Be(SectionGeneration.ClinicalScenarioMode);
        SectionGeneration.ModeFor("Recall").Should().Be(SectionGeneration.GuideOnlyMode);
        SectionGeneration.ModeFor(null).Should().Be(SectionGeneration.GuideOnlyMode);
    }
}
