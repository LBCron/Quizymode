using System.Linq.Expressions;
using FluentValidation;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>
/// Optional short "why this option is wrong" text per incorrect answer (#367). Keyed by the incorrect answer index;
/// the correct answer keeps <c>Explanation</c>.
/// </summary>
internal static class IncorrectAnswerRationaleHelper
{
    public const int MaxLength = 200;

    public const int MaxAnswers = 4;

    /// <summary>Trims values, drops blanks and out-of-range indexes, and caps the entry count and length.</summary>
    public static Dictionary<int, string> Normalize(IDictionary<int, string>? rationaleByIndex, int answerCount)
    {
        Dictionary<int, string> normalized = [];
        if (rationaleByIndex is null)
        {
            return normalized;
        }

        foreach ((int index, string? text) in rationaleByIndex)
        {
            if (index < 0 || index >= answerCount || string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            string trimmed = text.Trim();
            normalized[index] = trimmed.Length <= MaxLength ? trimmed : trimmed[..MaxLength];
        }

        return normalized;
    }

    /// <summary>Two rationale maps are equal when they hold the same indexes and texts.</summary>
    public static bool AreEquivalent(IDictionary<int, string>? left, IDictionary<int, string>? right)
    {
        Dictionary<int, string> normalizedLeft = Normalize(left, int.MaxValue);
        Dictionary<int, string> normalizedRight = Normalize(right, int.MaxValue);
        return normalizedLeft.Count == normalizedRight.Count
            && normalizedLeft.All(pair => normalizedRight.TryGetValue(pair.Key, out string? other) && other == pair.Value);
    }

    /// <summary>Adds index-range and length rules for an indexed incorrect-answer rationale map.</summary>
    internal static void AddIncorrectAnswerRationaleRules<T>(
        this AbstractValidator<T> validator,
        Expression<Func<T, Dictionary<int, string>?>> expression,
        Func<T, int> getAnswerCount)
    {
        validator.RuleFor(expression)
            .Must((request, rationaleByIndex) =>
                rationaleByIndex is null
                || rationaleByIndex.Keys.All(index => index >= 0 && index < getAnswerCount(request)))
            .WithMessage("IncorrectAnswerRationale keys must match existing incorrect answer indexes");

        validator.RuleFor(expression)
            .Must(rationaleByIndex =>
                rationaleByIndex is null
                || rationaleByIndex.Values.All(text => text is null || text.Trim().Length <= MaxLength))
            .WithMessage($"IncorrectAnswerRationale entries must not exceed {MaxLength} characters");
    }
}
