namespace Quizymode.Api.Features.Starter;

/// <summary>Allowed starter-quiz "world" values (#462). Mirrored by the web app's world map.</summary>
public static class StarterWorlds
{
    public const int MaxWorldLength = 24;
    public const int MaxWowLineLength = 140;

    public static readonly IReadOnlyList<string> All =
    [
        "flags", "genai", "space", "animals", "food", "time", "body", "places"
    ];

    public static bool IsValid(string? world) =>
        world is not null && All.Contains(world, StringComparer.Ordinal);
}
