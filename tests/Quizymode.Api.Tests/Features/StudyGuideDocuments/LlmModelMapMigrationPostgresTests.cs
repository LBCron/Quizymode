using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>#464: the per-vendor model columns become a JSON map; DeepSeek is retired from routes. Requires Docker.</summary>
[Trait("Category", "Postgres")]
public sealed class LlmModelMapMigrationPostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    private const string Previous = "20261103165430_AddItemStarterFields";

    [SkippableTheory]
    [InlineData("gemini-2.5-flash-lite", "gpt-5-nano", "Gemini,OpenAI,DeepSeek", "DeepSeek,OpenAI,Gemini",
        "gemini-3.5-flash-lite", "Gemini,Groq,Cerebras,OpenRouter,OpenAI", "OpenAI,Gemini,Cerebras,Groq,OpenRouter")]
    [InlineData("gemini-3.1-flash-lite", "gpt-5-mini", "OpenAI,DeepSeek", "DeepSeek",
        "gemini-3.1-flash-lite", "OpenAI", "OpenAI,Gemini,Cerebras,Groq,OpenRouter")]
    public async Task Migration_CarriesModelsOverAndRewritesRoutes(
        string geminiModel,
        string openAiModel,
        string routeFree,
        string routePremium,
        string expectedGemini,
        string expectedFree,
        string expectedPremium)
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await using ApplicationDbContext db = fixture.CreateDbContext();
        IMigrator migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(Previous);
        await db.Database.ExecuteSqlRawAsync("DELETE FROM \"LlmProviderSettings\"");
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "LlmProviderSettings" ("Id", "DeepSeekModel", "OpenAiModel", "GeminiModel", "RouteFree", "RoutePremium", "UpdatedUtc")
            VALUES (1, 'deepseek-flash', {openAiModel}, {geminiModel}, {routeFree}, {routePremium}, now())
            """);

        await migrator.MigrateAsync();

        await using ApplicationDbContext verify = fixture.CreateDbContext();
        LlmProviderSettings settings = await verify.LlmProviderSettings.AsNoTracking().SingleAsync();
        settings.Models.Should().BeEquivalentTo(new Dictionary<string, string>
        {
            ["Gemini"] = expectedGemini,
            ["Groq"] = "openai/gpt-oss-120b",
            ["Cerebras"] = "gpt-oss-120b",
            ["OpenRouter"] = "google/gemma-4-31b-it:free",
            ["OpenAI"] = openAiModel
        });
        settings.RouteFree.Should().Be(expectedFree);
        settings.RoutePremium.Should().Be(expectedPremium);
        LlmProviderSettingsStore.ModelFor(settings, LlmVendors.OpenAI).Should().Be(openAiModel);

        await migrator.MigrateAsync(Previous);
        await migrator.MigrateAsync();
    }
}
