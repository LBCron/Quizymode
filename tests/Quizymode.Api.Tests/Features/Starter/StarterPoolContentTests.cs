using System.Text.Json;
using System.Text.RegularExpressions;
using FluentAssertions;
using Quizymode.Api.Features.Starter;
using Xunit;

namespace Quizymode.Api.Tests.Features.Starter;

/// <summary>#462: the curated starter pool in data/seed-source/items meets the issue's content rules (AC 3.0.26).</summary>
public sealed class StarterPoolContentTests
{
    private const int MaxQuestionLength = 90;
    private const int MaxAnswerLength = 30;

    private sealed record StarterItem(
        string ItemId,
        string File,
        string Question,
        string CorrectAnswer,
        List<string> IncorrectAnswers,
        string? Source,
        string? QuestionImageKey,
        string World,
        string? WowLine);

    private static readonly Lazy<string> RepoRoot = new(FindRepoRoot);

    private static readonly Lazy<(List<StarterItem> Starters, List<string> AllIds)> Content = new(Load);

    private static List<StarterItem> Starters => Content.Value.Starters;

    private static string FindRepoRoot()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "data", "seed-source", "items")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new DirectoryNotFoundException("Could not find data/seed-source/items above the test binaries.");
    }

    private static (List<StarterItem>, List<string>) Load()
    {
        string itemsRoot = Path.Combine(RepoRoot.Value, "data", "seed-source", "items");
        List<StarterItem> starters = [];
        List<string> allIds = [];
        foreach (string file in Directory.GetFiles(itemsRoot, "*.json", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            using JsonDocument document = JsonDocument.Parse(File.ReadAllText(file));
            foreach (JsonElement item in document.RootElement.EnumerateArray())
            {
                string id = item.GetProperty("itemId").GetString()!;
                allIds.Add(id);
                if (!item.TryGetProperty("starterWorld", out _) && !item.TryGetProperty("wowLine", out _))
                {
                    continue;
                }

                string? Text(string name) =>
                    item.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

                starters.Add(new StarterItem(
                    id,
                    Path.GetRelativePath(itemsRoot, file),
                    Text("question") ?? string.Empty,
                    Text("correctAnswer") ?? string.Empty,
                    item.GetProperty("incorrectAnswers").EnumerateArray().Select(a => a.GetString() ?? string.Empty).ToList(),
                    Text("source"),
                    item.TryGetProperty("questionImage", out JsonElement image) ? image.GetProperty("key").GetString() : null,
                    Text("starterWorld") ?? string.Empty,
                    Text("wowLine")));
            }
        }

        return (starters, allIds);
    }

    [Fact]
    public void Pool_HasAtLeastFortyItems_AcrossAllEightWorlds()
    {
        Starters.Should().HaveCountGreaterThanOrEqualTo(40);
        Starters.Select(s => s.World).Distinct().Order().Should().Equal(StarterWorlds.All.Order());
    }

    [Fact]
    public void Pool_HasEnoughItemsPerWorld()
    {
        Dictionary<string, int> perWorld = Starters.GroupBy(s => s.World).ToDictionary(g => g.Key, g => g.Count());

        perWorld["flags"].Should().BeGreaterThanOrEqualTo(8);
        perWorld["genai"].Should().BeGreaterThanOrEqualTo(8);
        foreach (string world in StarterWorlds.All.Where(w => w is not ("flags" or "genai")))
        {
            perWorld[world].Should().BeGreaterThanOrEqualTo(5, world);
        }
    }

    [Fact]
    public void Pool_EveryWorldIsAllowedAndEveryItemHasAWowLine()
    {
        foreach (StarterItem item in Starters)
        {
            StarterWorlds.IsValid(item.World).Should().BeTrue($"{item.ItemId} in {item.File} has world '{item.World}'");
            item.WowLine.Should().NotBeNullOrWhiteSpace($"{item.ItemId} in {item.File} needs a wowLine");
            item.WowLine!.Length.Should().BeInRange(1, StarterWorlds.MaxWowLineLength, $"{item.ItemId} wowLine length");
            item.WowLine.Should().Be(item.WowLine.Trim());
            Regex.IsMatch(item.WowLine, @"[\r\n\t]").Should().BeFalse($"{item.ItemId} wowLine must be a single plain line");
        }
    }

    [Fact]
    public void Pool_QuestionsAndAnswersAreShort()
    {
        foreach (StarterItem item in Starters)
        {
            item.Question.Length.Should().BeLessThanOrEqualTo(MaxQuestionLength, $"question of {item.ItemId}: {item.Question}");
            item.CorrectAnswer.Length.Should().BeLessThanOrEqualTo(MaxAnswerLength, $"correct answer of {item.ItemId}: {item.CorrectAnswer}");
            item.IncorrectAnswers.Should().NotBeEmpty();
            foreach (string wrong in item.IncorrectAnswers)
            {
                wrong.Length.Should().BeLessThanOrEqualTo(MaxAnswerLength, $"incorrect answer of {item.ItemId}: {wrong}");
            }
        }
    }

    [Fact]
    public void Pool_EveryItemHasAnHttpSource()
    {
        foreach (StarterItem item in Starters)
        {
            item.Source.Should().NotBeNullOrWhiteSpace($"{item.ItemId} in {item.File}");
            Uri.TryCreate(item.Source, UriKind.Absolute, out Uri? uri).Should().BeTrue($"{item.ItemId} source '{item.Source}'");
            uri!.Scheme.Should().BeOneOf("http", "https");
        }
    }

    [Fact]
    public void Pool_HasNoDuplicateIds()
    {
        Starters.GroupBy(s => s.ItemId).Where(g => g.Count() > 1).Select(g => g.Key).Should().BeEmpty();
        Content.Value.AllIds.GroupBy(id => id).Where(g => g.Count() > 1).Select(g => g.Key).Should().BeEmpty();
    }

    [Fact]
    public void Pool_FlagItemsHaveACuratedQuestionImage()
    {
        List<StarterItem> flags = Starters.Where(s => s.World == "flags").ToList();

        flags.Should().NotBeEmpty();
        foreach (StarterItem flag in flags)
        {
            flag.QuestionImageKey.Should().MatchRegex("^curated:flags/[a-z]{2}$", $"{flag.ItemId} in {flag.File}");
        }
    }

    [Fact]
    public void Pool_EveryStarterIdIsInTheDevSeedSelection()
    {
        string selectionPath = Path.Combine(RepoRoot.Value, "data", "seed-dev", "selection.json");
        using JsonDocument selection = JsonDocument.Parse(File.ReadAllText(selectionPath));
        HashSet<string> selected = selection.RootElement.GetProperty("itemIds").EnumerateArray().Select(e => e.GetString()!).ToHashSet();

        Starters.Select(s => s.ItemId).Where(id => !selected.Contains(id)).Should().BeEmpty();
    }
}
