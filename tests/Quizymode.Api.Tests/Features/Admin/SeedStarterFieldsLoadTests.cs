using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

/// <summary>#462 (AC 5.2): a JSON seed item's starterWorld and wowLine survive both case-insensitive file loaders into SeedItemRequest.</summary>
public sealed class SeedStarterFieldsLoadTests : IDisposable
{
    private const string WowLine = "Nepal has the only national flag that is not a rectangle or a square.";

    private const string ItemsJson = """
        [
          {
            "itemId": "99999999-9999-9999-9999-999999999911",
            "category": "geography",
            "navigationKeyword1": "flags",
            "navigationKeyword2": "countries",
            "question": "Which country's flag is this?",
            "correctAnswer": "Nepal",
            "incorrectAnswers": ["Bhutan"],
            "starterWorld": "flags",
            "wowLine": "Nepal has the only national flag that is not a rectangle or a square."
          },
          {
            "itemId": "99999999-9999-9999-9999-999999999912",
            "category": "geography",
            "navigationKeyword1": "flags",
            "navigationKeyword2": "countries",
            "question": "Capital of France?",
            "correctAnswer": "Paris",
            "incorrectAnswers": ["Lyon"]
          }
        ]
        """;

    private readonly string _root = Path.Combine(Path.GetTempPath(), "starter-seed-" + Guid.NewGuid());

    public SeedStarterFieldsLoadTests()
    {
        string items = Path.Combine(_root, "data", "seed-source", "items", "geography");
        Directory.CreateDirectory(items);
        File.WriteAllText(Path.Combine(items, "geography.flags.countries.json"), ItemsJson);
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public async Task DatabaseSeeder_LoadSeedItemRequestsAsync_CarriesStarterFields()
    {
        string path = Path.Combine(_root, "data", "seed-source", "items");

        List<SeedSyncAdmin.SeedItemRequest> requests = await DatabaseSeederHostedService.LoadSeedItemRequestsAsync(
            path, null, NullLogger.Instance, CancellationToken.None);

        requests.Should().HaveCount(2);
        requests[0].StarterWorld.Should().Be("flags");
        requests[0].WowLine.Should().Be(WowLine);
        requests[1].StarterWorld.Should().BeNull();
        requests[1].WowLine.Should().BeNull();
    }

    [Fact]
    public async Task LocalSeedLoader_LoadManifestAsync_CarriesStarterFields()
    {
        Mock<IWebHostEnvironment> env = new();
        env.Setup(e => e.ContentRootPath).Returns(_root);
        LocalSeedLoader loader = new(env.Object, NullLogger<LocalSeedLoader>.Instance);

        Result<LoadedLocalSeedManifest> result = await loader.LoadManifestAsync(50, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Manifest.Items.Select(i => i.StarterWorld).Should().Equal("flags", null);
        result.Value.Manifest.Items.Select(i => i.WowLine).Should().Equal(WowLine, null);
    }
}
