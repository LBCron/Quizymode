using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Shared.Helpers;

/// <summary>An uploaded picture attached to an item slot, as the reviewer sees it.</summary>
internal sealed record PictureSlot(Guid AssetId, string Sha256, string AltText, string? Attribution);

/// <summary>What a save does to the item's picture review: <see cref="Changed"/> means a new revision is claimed.</summary>
internal readonly record struct ImageReviewTransition(bool Changed, ItemImageReviewState? State, int Revision, bool CreatesSubmission);

/// <summary>Response shape for an item's picture review (AC 3.25.2). Shown to the creator and admins only.</summary>
public sealed record ItemImageReviewInfo(string State, int Revision, string? Reason = null);

/// <summary>
/// Pure rules for item picture review (#400, AC 3.25): content hashing, the state machine, and error shapes.
/// </summary>
internal static class ItemImageReviewRules
{
    /// <summary>The unique (ItemId, Revision) index of <c>ItemImageReviews</c>.</summary>
    public const string RevisionIndexName = "IX_ItemImageReviews_ItemId_Revision";

    public const string PolicyVersion = "pictures-v1";

    public const string AssetInvalidCode = "Item.ImageAssetInvalid";
    public const string ReviewRequiredCode = "Item.ImageReviewRequired";
    public const string ReviewStaleCode = "Item.ImageReviewStale";
    public const string AssetUnavailableCode = "Item.ImageAssetUnavailable";
    public const string ManagedBySeedCode = "Item.ImagesManagedBySeed";

    /// <summary>One message for every unusable asset (unknown, not yours, not Ready, withdrawn) so ids cannot be probed.</summary>
    public static Error AssetInvalid() =>
        Error.Validation(AssetInvalidCode, "A picture could not be used. Upload it again and retry.");

    public static Error ManagedBySeed() =>
        Error.Validation(ManagedBySeedCode, "Pictures on this item are managed by seed data and can't be changed here.");

    public static Error ReviewRequired() =>
        Error.Conflict(ReviewRequiredCode, "Pictures on this item must be approved before it can be published.");

    public static Error ReviewStale() =>
        Error.Conflict(ReviewStaleCode, "The item's pictures changed while you were saving. Reload and try again.");

    /// <summary>The key stored in <c>Item.QuestionImageKey</c>/<c>ExplanationImageKey</c> for an uploaded picture.</summary>
    public static string KeyOf(Guid assetId) => $"media:{assetId:N}";

    /// <summary>The picture identity used by the Add duplicate rule (AC 2.1.21): bytes for uploads, key for curated, null for none.</summary>
    public static string? DuplicateIdentity(string? key, Guid? assetId, string? assetSha256) =>
        assetId is not null ? $"sha256:{assetSha256}" : key;

    /// <summary>
    /// Lowercase hex SHA-256 over a versioned canonical JSON of everything a reviewer judges: the question text, answers,
    /// explanation, spoken forms, and per slot the picture bytes (SHA-256), alt text and attribution. Category, keywords,
    /// source and group label are excluded. Inputs are the values as saved (after normalization).
    /// </summary>
    public static string ComputeContentHash(
        string question,
        string correctAnswer,
        IReadOnlyList<string> incorrectAnswers,
        string explanation,
        ItemSpeechSupport? questionSpeech,
        PictureSlot? questionImage,
        PictureSlot? explanationImage)
    {
        using MemoryStream stream = new();
        using (Utf8JsonWriter writer = new(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("v", "v1");
            writer.WriteString("question", question);
            writer.WriteString("correctAnswer", correctAnswer);
            writer.WriteStartArray("incorrectAnswers");
            foreach (string answer in incorrectAnswers)
            {
                writer.WriteStringValue(answer);
            }

            writer.WriteEndArray();
            writer.WriteString("explanation", explanation);
            if (questionSpeech is null)
            {
                writer.WriteNull("questionSpeech");
            }
            else
            {
                writer.WriteStartObject("questionSpeech");
                writer.WriteString("pronunciation", questionSpeech.Pronunciation);
                writer.WriteString("languageCode", questionSpeech.LanguageCode);
                writer.WriteEndObject();
            }

            WriteSlot(writer, "questionImage", questionImage);
            WriteSlot(writer, "explanationImage", explanationImage);
            writer.WriteEndObject();
        }

        return Convert.ToHexStringLower(SHA256.HashData(stream.ToArray()));
    }

    private static void WriteSlot(Utf8JsonWriter writer, string name, PictureSlot? slot)
    {
        if (slot is null)
        {
            writer.WriteNull(name);
            return;
        }

        writer.WriteStartObject(name);
        writer.WriteString("sha256", slot.Sha256);
        writer.WriteString("altText", slot.AltText);
        writer.WriteString("attribution", slot.Attribution);
        writer.WriteEndObject();
    }

    /// <summary>
    /// The state machine (AC 3.25.3). A save with no uploaded slot clears the state; the first upload, or any change to the
    /// reviewed content, re-submits as PendingReview; an unchanged hash keeps the current state (a Rejected item saved
    /// unchanged stays Rejected). The revision only ever increases.
    /// </summary>
    public static ImageReviewTransition Plan(
        ItemImageReviewState? currentState,
        int currentRevision,
        bool hasUpload,
        string? newHash,
        string? storedHash,
        bool assetsChanged = false)
    {
        if (!hasUpload)
        {
            return currentState is null
                ? new ImageReviewTransition(false, null, currentRevision, false)
                : new ImageReviewTransition(true, null, currentRevision + 1, false);
        }

        if (!assetsChanged && currentState is not null && storedHash is not null && string.Equals(storedHash, newHash, StringComparison.Ordinal))
        {
            return new ImageReviewTransition(false, currentState, currentRevision, false);
        }

        return new ImageReviewTransition(true, ItemImageReviewState.PendingReview, currentRevision + 1, true);
    }

    /// <summary>
    /// Publish guard policy (AC 3.25.6): a private-to-public transition (or a new public item) with pictures that are not
    /// Approved is refused. This is policy for admin workflows; the eligibility gate is the security boundary.
    /// </summary>
    public static bool BlocksPublish(bool wasPrivate, bool willBePrivate, ItemImageReviewState? resultingState) =>
        wasPrivate && !willBePrivate && resultingState is not null and not ItemImageReviewState.Approved;

    public static ItemImageReviewInfo? InfoOf(Item item, string? rejectionReason = null) =>
        item.ImageReviewState is null
            ? null
            : new ItemImageReviewInfo(
                item.ImageReviewState.Value.ToString(),
                item.ImageRevision,
                item.ImageReviewState == ItemImageReviewState.Rejected ? rejectionReason : null);

    /// <summary>
    /// Rejection reasons for the current revision of the given Rejected items, in one query. Callers must only pass items the
    /// requester may see review details for (creator or admin, AC 3.25.2).
    /// </summary>
    public static async Task<Dictionary<Guid, string?>> LoadRejectionReasonsAsync(
        ApplicationDbContext db,
        IReadOnlyCollection<Item> rejectedItems,
        CancellationToken cancellationToken)
    {
        if (rejectedItems.Count == 0)
        {
            return new Dictionary<Guid, string?>();
        }

        List<Guid> ids = rejectedItems.Select(i => i.Id).ToList();
        Dictionary<Guid, int> revisions = rejectedItems.ToDictionary(i => i.Id, i => i.ImageRevision);
        var rows = await db.ItemImageReviews.AsNoTracking()
            .Where(r => ids.Contains(r.ItemId) && r.Decision == ItemImageReviewDecisions.Rejected)
            .Select(r => new { r.ItemId, r.Revision, r.Reason })
            .ToListAsync(cancellationToken);

        return rows
            .Where(r => revisions.TryGetValue(r.ItemId, out int revision) && revision == r.Revision)
            .ToDictionary(r => r.ItemId, r => r.Reason);
    }

    /// <summary>True only for the unique (ItemId, Revision) violation of two submissions racing; other unique violations keep their own handling.</summary>
    public static bool IsRevisionConflict(DbUpdateException exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation, ConstraintName: RevisionIndexName })
            {
                return true;
            }

            if (current.Message.Contains("UNIQUE constraint failed: ItemImageReviews", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}
