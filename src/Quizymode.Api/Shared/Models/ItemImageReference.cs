namespace Quizymode.Api.Shared.Models;

/// <summary>
/// Question or explanation picture: a curated key (#407) resolved by the web build into a bundled image, or <c>media:{assetId:N}</c> for an upload (#400), plus its alt text and optional attribution.
/// </summary>
public sealed record ItemImageReference(string Key, string AltText, string? Attribution = null);
