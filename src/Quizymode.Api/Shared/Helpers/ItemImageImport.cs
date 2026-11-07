using System.Text.Json;
using FluentValidation;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Shared.Helpers;
internal static class ItemImageImport
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private sealed class Validator : AbstractValidator<ImageSlotInput>
    {
        internal Validator() { this.AddImageSlotRules(x => x, "Picture", false); }
    }
    internal static ImageSlotInput? Parse(JsonElement? value)
    {
        if (value is null || value.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
        ImageSlotInput? slot = value.Value.Deserialize<ImageSlotInput>(Json);
        if (slot is null || !new Validator().Validate(slot).IsValid) throw new JsonException("Unsupported picture reference. Use an owned uploaded assetId and descriptions; URLs, keys, bytes and review approval are not importable.");
        return slot;
    }
    internal static bool IsValid(JsonElement? value)
    {
        try { Parse(value); return true; } catch (JsonException) { return false; }
    }
    internal static async Task<Error?> ValidateAsync(ApplicationDbContext db, string owner, IReadOnlyList<IItemImageImportInput> items, CancellationToken ct)
    {
        int picturedCount = items.Count(item => item.QuestionImage is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined } || item.ExplanationImage is { ValueKind: not JsonValueKind.Null and not JsonValueKind.Undefined });
        if (picturedCount > 0)
        {
            Error? quota = await ItemImageSubmission.PendingQuotaAsync(db, owner, null, picturedCount, ct);
            if (quota is not null) return quota;
        }
        foreach (IItemImageImportInput item in items)
        {
            foreach (JsonElement? value in new[] { item.QuestionImage, item.ExplanationImage })
            {
                ImageSlotInput? slot;
                try { slot = Parse(value); } catch (JsonException) { return Error.Validation("Item.InvalidImportedPicture", "Unsupported picture reference. Reuse only your own uploaded assetId; curated keys, URLs and bytes cannot be imported."); }
                if (slot is null) continue;
                var resolved = await ItemImageSubmission.ResolveSlotAsync(db, owner, null, null, null, slot, ct);
                if (resolved.Error is not null) return resolved.Error;
            }
        }
        return null;
    }
}
