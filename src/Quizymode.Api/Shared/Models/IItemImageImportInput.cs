using System.Text.Json;
namespace Quizymode.Api.Shared.Models;
/// <summary>Media-only input contract shared by import workflows without depending on a feature request type.</summary>
internal interface IItemImageImportInput
{
    JsonElement? QuestionImage { get; }
    JsonElement? ExplanationImage { get; }
}
