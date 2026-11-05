namespace Quizymode.Api.Shared.Helpers;

internal static class ItemSimHashInput
{
    internal static string Normalize(string question) => question.Trim().ToLowerInvariant();
}
