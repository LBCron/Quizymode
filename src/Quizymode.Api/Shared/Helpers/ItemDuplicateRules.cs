using Quizymode.Api.Shared.Kernel;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>
/// Duplicate rule for user-created items (AC 2.1.21): same question text (case-insensitive) or same SimHash,
/// AND the same question image key (no image equals no image). Text-only copies of a picture question are allowed.
/// </summary>
internal static class ItemDuplicateRules
{
    internal static Error Duplicate(string categoryName) =>
        Error.Validation("Item.Duplicate", $"An item with the same question already exists in category '{categoryName}'. Questions are compared case-insensitively.");

    internal static bool IsDuplicate(
        string existingQuestion,
        string existingFuzzySignature,
        string? existingImageKey,
        string newQuestion,
        string newFuzzySignature,
        string? newImageKey)
    {
        bool sameText = string.Equals(ItemSimHashInput.Normalize(existingQuestion), ItemSimHashInput.Normalize(newQuestion), StringComparison.Ordinal)
            || existingFuzzySignature == newFuzzySignature;

        return sameText && string.Equals(existingImageKey, newImageKey, StringComparison.Ordinal);
    }
}
