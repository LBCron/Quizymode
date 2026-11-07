using System.Text.RegularExpressions;
using FluentValidation;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>
/// Shared rules for the optional curated question picture (#407). The key must name a bundled asset
/// (<c>curated:&lt;folder&gt;/&lt;name&gt;</c>, lowercase letters, digits and hyphens); alt text is required.
/// </summary>
internal static partial class ItemImageReferenceHelper
{
    internal const int MaxKeyLength = 100;
    internal const int MaxAltTextLength = 300;
    internal const string InvalidKeyMessage = "Question image key must look like 'curated:folder/name' (lowercase letters, digits, hyphens; max 100 characters).";
    internal const string InvalidAltTextMessage = "Question image alt text is required (1-300 characters, no line breaks or control characters).";
    internal const string InvalidExplanationKeyMessage = "Explanation image key must look like 'curated:folder/name' (lowercase letters, digits, hyphens; max 100 characters).";
    internal const string InvalidExplanationAltTextMessage = "Explanation image alt text is required (1-300 characters, no line breaks or control characters).";
    internal const string ExplanationRequiredMessage = "Explanation is required when an explanation image is set.";
    internal const string ExplanationRequiredForUpdateMessage = "Explanation can't be empty while the item has an explanation picture.";
    internal const string PicturesNotImportableMessage = "Pictures can't be imported. Remove questionImage/explanationImage; curated pictures are added through seed data.";

    [GeneratedRegex("^curated:[a-z0-9-]+(/[a-z0-9-]+)+$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyRegex();

    /// <summary>Trims key and alt text; returns null when no key is present.</summary>
    internal static ItemImageReference? Normalize(ItemImageReference? image)
    {
        if (image is null) return null;
        return new ItemImageReference(image.Key?.Trim() ?? string.Empty, image.AltText?.Trim() ?? string.Empty, ItemImageSubmission.NormalizeAttribution(image.Attribution), ItemImageSubmission.NormalizeAttribution(image.LongDescription));
    }

    internal static bool IsValidKey(string? key) =>
        !string.IsNullOrEmpty(key) && key.Length <= MaxKeyLength && KeyRegex().IsMatch(key);

    internal static bool IsValidAltText(string? altText)
    {
        if (string.IsNullOrWhiteSpace(altText)) return false;
        string trimmed = altText.Trim();
        if (trimmed.Length > MaxAltTextLength) return false;
        foreach (char c in trimmed)
        {
            if (char.IsControl(c)) return false;
        }

        return true;
    }

    /// <summary>The stored image key, or null when the item has no picture.</summary>
    internal static string? KeyOf(ItemImageReference? image) => image?.Key;

    internal static ItemImageReference? FromColumns(string? key, string? altText, string? attribution = null, string? longDescription = null, int revision = 0) =>
        key is null ? null : new ItemImageReference(key, altText ?? string.Empty, attribution, longDescription, revision);

    /// <summary>Adds key format and alt text rules for an optional image reference.</summary>
    internal static void AddQuestionImageRules<T>(
        this AbstractValidator<T> validator,
        System.Linq.Expressions.Expression<Func<T, ItemImageReference?>> expression) =>
        validator.AddImageRules(expression, InvalidKeyMessage, InvalidAltTextMessage);

    /// <summary>Adds key format and alt text rules for the optional explanation picture (#403).</summary>
    internal static void AddExplanationImageRules<T>(
        this AbstractValidator<T> validator,
        System.Linq.Expressions.Expression<Func<T, ItemImageReference?>> expression,
        System.Linq.Expressions.Expression<Func<T, string?>> explanation)
    {
        validator.AddImageRules(expression, InvalidExplanationKeyMessage, InvalidExplanationAltTextMessage);


    }

    private static void AddImageRules<T>(
        this AbstractValidator<T> validator,
        System.Linq.Expressions.Expression<Func<T, ItemImageReference?>> expression,
        string keyMessage,
        string altMessage)
    {
        validator.RuleFor(expression)
            .Must(image => image is null || IsValidKey(image.Key?.Trim()))
            .WithMessage(keyMessage);

        validator.RuleFor(expression)
            .Must(image => image is null || ItemImageSlotRules.IsValidLongDescription(image.LongDescription))
            .WithMessage("Picture longDescription must be at most 2000 characters without control characters other than line breaks.");

        validator.RuleFor(expression)
            .Must(image => image is null || IsValidAltText(image.AltText))
            .WithMessage(altMessage);
    }

    /// <summary>
    /// Import endpoints reject pictures (#403 D1): a missing field or JSON null is accepted, any other value is not.
    /// </summary>
    internal static void AddPictureImportRejectionRules<T>(
        this AbstractValidator<T> validator,
        System.Linq.Expressions.Expression<Func<T, System.Text.Json.JsonElement?>> questionImage,
        System.Linq.Expressions.Expression<Func<T, System.Text.Json.JsonElement?>> explanationImage)
    {
        validator.RuleFor(questionImage)
            .Must(IsAbsent)
            .WithName("QuestionImage")
            .WithMessage("QuestionImage: " + PicturesNotImportableMessage);

        validator.RuleFor(explanationImage)
            .Must(IsAbsent)
            .WithName("ExplanationImage")
            .WithMessage("ExplanationImage: " + PicturesNotImportableMessage);
    }

    private static bool IsAbsent(System.Text.Json.JsonElement? value) =>
        value is null || value.Value.ValueKind is System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined;
}
