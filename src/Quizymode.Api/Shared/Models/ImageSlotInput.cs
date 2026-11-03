namespace Quizymode.Api.Shared.Models;

/// <summary>
/// Request shape for an uploaded picture on POST/PUT /items (AC 3.25.2). Set or replace with <see cref="AssetId"/>
/// (plus <see cref="AltText"/>); on PUT, <see cref="Remove"/> clears the slot. POST rejects <see cref="Remove"/>.
/// </summary>
public sealed record ImageSlotInput(
    Guid? AssetId = null,
    string? AltText = null,
    string? Attribution = null,
    bool? Remove = null)
{
    /// <summary>Any member other than the four above (for example <c>key</c> or <c>url</c>); rejected by validation.</summary>
    [System.Text.Json.Serialization.JsonExtensionData]
    public Dictionary<string, System.Text.Json.JsonElement>? Unmapped { get; init; }
}
