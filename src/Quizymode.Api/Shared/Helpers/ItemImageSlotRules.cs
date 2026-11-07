using FluentValidation;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>Request validation for the uploaded-picture slots on POST/PUT /items (AC 3.25.2).</summary>
internal static class ItemImageSlotRules
{
    internal const int MaxAttributionLength = 300;

    internal const string AssetIdRequiredMessage =
        "assetId is required. Upload the picture with POST /media/images first; URLs, keys and files can't be sent here.";

    internal const string UnmappedMessage = "only assetId, altText, attribution, longDescription and remove are accepted; keys and URLs can't be sent here.";

    internal const string AltTextMessage = "altText is required (1-300 characters, no line breaks or control characters).";
    internal const string AttributionMessage = "attribution must be at most 300 characters with no line breaks or control characters.";
    internal const string RemoveNotAllowedMessage = "remove isn't supported when creating an item.";
    internal const string RemoveExclusiveMessage = "remove can't be combined with assetId, altText or attribution.";
    internal const string ExplanationRequiredMessage = "Explanation is required when an explanation picture is set.";

    /// <summary>
    /// Adds the slot shape rules. A null slot is always valid (POST: no picture; PUT: keep). <paramref name="allowRemove"/> is
    /// true for PUT only.
    /// </summary>
    internal static void AddImageSlotRules<T>(
        this AbstractValidator<T> validator,
        System.Linq.Expressions.Expression<Func<T, ImageSlotInput?>> expression,
        string name,
        bool allowRemove)
    {
        validator.RuleFor(expression)
            .Must(slot => slot is null || slot.Unmapped is not { Count: > 0 })
            .WithName(name)
            .WithMessage($"{name}: {UnmappedMessage}");

        validator.RuleFor(expression)
            .Must(slot => slot is null || slot.Remove != true || allowRemove)
            .WithName(name)
            .WithMessage($"{name}: {RemoveNotAllowedMessage}");

        validator.RuleFor(expression)
            .Must(slot => slot is null || slot.Remove != true || (slot.AssetId is null && slot.AltText is null && slot.Attribution is null && slot.LongDescription is null))
            .WithName(name)
            .WithMessage($"{name}: {RemoveExclusiveMessage}");

        validator.RuleFor(expression)
            .Must(slot => slot is null || slot.Remove == true || (slot.AssetId is Guid id && id != Guid.Empty))
            .WithName(name)
            .WithMessage($"{name}: {AssetIdRequiredMessage}");

        validator.RuleFor(expression)
            .Must(slot => slot is null || slot.Remove == true || ItemImageReferenceHelper.IsValidAltText(slot.AltText))
            .WithName(name)
            .WithMessage($"{name}: {AltTextMessage}");

        validator.RuleFor(expression)
            .Must(slot => slot is null || IsValidLongDescription(slot.LongDescription))
            .WithName(name)
            .WithMessage($"{name}: longDescription must be at most 2000 characters without control characters other than line breaks.");

        validator.RuleFor(expression)
            .Must(slot => slot is null || slot.Remove == true || IsValidAttribution(slot.Attribution))
            .WithName(name)
            .WithMessage($"{name}: {AttributionMessage}");
    }

    /// <summary>An explanation picture needs explanation text to illustrate (D4); removing one needs none.</summary>
    internal static void AddExplanationPictureRequiresTextRule<T>(
        this AbstractValidator<T> validator,
        System.Linq.Expressions.Expression<Func<T, ImageSlotInput?>> slot,
        System.Linq.Expressions.Expression<Func<T, string?>> explanation)
    {

    }

    internal static bool IsValidLongDescription(string? text) =>
        text is null || (text.Trim().Length <= 2000 && !text.Any(c => char.IsControl(c) && c is not '\n' and not '\r'));

    private static bool IsValidAttribution(string? attribution)
    {
        if (string.IsNullOrWhiteSpace(attribution))
        {
            return true;
        }

        string trimmed = attribution.Trim();
        return trimmed.Length <= MaxAttributionLength && !trimmed.Any(char.IsControl);
    }
}
