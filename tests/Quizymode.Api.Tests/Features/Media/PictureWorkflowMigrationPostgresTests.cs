using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

[Trait("Category", "Postgres")]
public sealed class PictureWorkflowMigrationPostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    [SkippableFact]
    public async Task FreshAndCurrentMainUpgradeKeepAppliedAuditAndRationaleData()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await using var db = fixture.CreateDbContext();
        var applied = (await db.Database.GetAppliedMigrationsAsync()).ToList();
        applied.Should().Contain("20261106043918_AddLlmModelFindings").And.Contain("20261106111800_AddIncorrectAnswerRationale");
        applied.Count(x => x.EndsWith("CompletePictureWorkflow398")).Should().Be(1);
        applied.Should().NotContain(x => x.Contains("AddPictureAdvisoryCostReservation") || x.Contains("AddDurablePictureUploadAttempts"));
        // Fixture first migrates an empty real PostgreSQL DB. Rewind ONLY the unpublished398 addition on this disposable DB.
        IMigrator migrator = db.GetService<IMigrator>(); await migrator.MigrateAsync("20261106111800_AddIncorrectAnswerRationale");
        Guid findingId = Guid.NewGuid(), itemId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "LlmModelFindings" ("Id","Vendor","Model","Kind","Status","FirstSeenUtc","LastSeenUtc")
            VALUES ({findingId},'Gemini','fake-preserved-model','ModelMissing','Open',now(),now())
            """);
        string rationale = "{\"0\":\"Preserved rationale\"}";
        // Use a separate current-main context model via SQL so new columns are not read before upgrade.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Items" ("Id","Question","CorrectAnswer","IncorrectAnswers","IncorrectAnswerRationale","FuzzySignature","FuzzyBucket","IsPrivate","CreatedBy","CreatedAt","ReadyForReview","ImageRevision","Explanation")
            VALUES ({itemId},'Preserved context','A','["B"]'::jsonb,{rationale}::jsonb,'abc',1,true,'migration-test',now(),false,0,'')
            """);
        string clinicalHash = new string('c', 64);
        db.SectionGenerations.AddRange(new[] { SectionGeneration.GuideOnlyMode, SectionGeneration.ClinicalScenarioMode }.Select(mode => new SectionGeneration { Id = Guid.NewGuid(), TextSha256 = clinicalHash, Mode = mode, PromptVersion = 1, Status = SectionGenerationStatus.Completed, Tier = StudyGuideTier.Free, CreatedUtc = DateTime.UtcNow, QueuedUtc = DateTime.UtcNow, NotBeforeUtc = DateTime.UtcNow }));
        await db.SaveChangesAsync();
        await migrator.MigrateAsync();
        await using var verify = fixture.CreateDbContext();
        (await verify.LlmModelFindings.SingleAsync(x => x.Id == findingId)).Model.Should().Be("fake-preserved-model");
        (await verify.Items.SingleAsync(x => x.Id == itemId)).IncorrectAnswerRationale[0].Should().Be("Preserved rationale");
        (await verify.SectionGenerations.Where(x => x.TextSha256 == clinicalHash).Select(x => x.Mode).ToListAsync()).Should().BeEquivalentTo(SectionGeneration.GuideOnlyMode, SectionGeneration.ClinicalScenarioMode);
        (await verify.MediaIngressAttempts.CountAsync()).Should().Be(0);
        (await verify.Database.GetAppliedMigrationsAsync()).Count(x => x.EndsWith("CompletePictureWorkflow398")).Should().Be(1);
    }
}
