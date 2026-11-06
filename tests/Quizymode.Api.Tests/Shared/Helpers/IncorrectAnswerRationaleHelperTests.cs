using FluentAssertions;
using FluentValidation;
using FluentValidation.TestHelper;
using Quizymode.Api.Shared.Helpers;
using Xunit;

namespace Quizymode.Api.Tests.Shared.Helpers;

public sealed class IncorrectAnswerRationaleHelperTests
{
    [Fact]
    public void Normalize_TrimsAndDropsBlankAndOutOfRangeEntries()
    {
        Dictionary<int, string> input = new()
        {
            [0] = "  Too broad.  ",
            [1] = "   ",
            [2] = "Not this one.",
            [7] = "Out of range.",
            [-1] = "Negative index.",
        };

        Dictionary<int, string> result = IncorrectAnswerRationaleHelper.Normalize(input, answerCount: 3);

        result.Should().BeEquivalentTo(new Dictionary<int, string>
        {
            [0] = "Too broad.",
            [2] = "Not this one.",
        });
    }

    [Fact]
    public void Normalize_CapsLengthAt200Characters()
    {
        string longText = new('x', 260);

        Dictionary<int, string> result = IncorrectAnswerRationaleHelper.Normalize(
            new Dictionary<int, string> { [0] = longText },
            answerCount: 1);

        result[0].Should().HaveLength(IncorrectAnswerRationaleHelper.MaxLength);
    }

    [Fact]
    public void Normalize_NullInputReturnsEmpty()
    {
        IncorrectAnswerRationaleHelper.Normalize(null, answerCount: 3).Should().BeEmpty();
    }

    [Fact]
    public void AreEquivalent_ComparesIndexesAndTexts()
    {
        Dictionary<int, string> left = new() { [0] = "A", [1] = "B" };

        IncorrectAnswerRationaleHelper.AreEquivalent(left, new Dictionary<int, string> { [1] = "B", [0] = "A" })
            .Should().BeTrue();
        IncorrectAnswerRationaleHelper.AreEquivalent(left, new Dictionary<int, string> { [0] = "A", [1] = "C" })
            .Should().BeFalse();
        IncorrectAnswerRationaleHelper.AreEquivalent(left, new Dictionary<int, string> { [0] = "A" })
            .Should().BeFalse();
        IncorrectAnswerRationaleHelper.AreEquivalent(null, new Dictionary<int, string>()).Should().BeTrue();
    }

    [Fact]
    public void Validator_RejectsKeysOutsideAnswerCount()
    {
        RationaleRequestValidator validator = new();

        TestValidationResult<RationaleRequest> result = validator.TestValidate(new RationaleRequest(
            new Dictionary<int, string> { [3] = "Too far." },
            AnswerCount: 3));

        result.ShouldHaveValidationErrorFor(x => x.IncorrectAnswerRationale);
    }

    [Fact]
    public void Validator_RejectsEntriesLongerThan200()
    {
        RationaleRequestValidator validator = new();

        TestValidationResult<RationaleRequest> result = validator.TestValidate(new RationaleRequest(
            new Dictionary<int, string> { [0] = new('x', IncorrectAnswerRationaleHelper.MaxLength + 1) },
            AnswerCount: 3));

        result.ShouldHaveValidationErrorFor(x => x.IncorrectAnswerRationale);
    }

    [Fact]
    public void Validator_AcceptsValidRationale()
    {
        RationaleRequestValidator validator = new();

        TestValidationResult<RationaleRequest> result = validator.TestValidate(new RationaleRequest(
            new Dictionary<int, string> { [0] = "Short reason." },
            AnswerCount: 3));

        result.ShouldNotHaveAnyValidationErrors();
    }

    private sealed record RationaleRequest(Dictionary<int, string>? IncorrectAnswerRationale, int AnswerCount);

    private sealed class RationaleRequestValidator : AbstractValidator<RationaleRequest>
    {
        public RationaleRequestValidator()
        {
            this.AddIncorrectAnswerRationaleRules(x => x.IncorrectAnswerRationale, req => req.AnswerCount);
        }
    }
}
