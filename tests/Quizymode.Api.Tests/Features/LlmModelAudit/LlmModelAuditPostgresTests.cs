using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Data;
using Quizymode.Api.Features.LlmModelAudit;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.LlmModelAudit;

/// <summary>#480 on real PostgreSQL: the partial unique index and overlapping runs. Requires Docker.</summary>
[Trait("Category", "Postgres")]
public sealed class LlmModelAuditPostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    private static LlmModelFinding Finding(LlmModelFindingStatus status) => new()
    {
        Id = Guid.NewGuid(),
        Vendor = "OpenAI",
        Model = "gpt-5-nano",
        Kind = LlmModelFindingKind.ModelMissing,
        Status = status,
        FirstSeenUtc = DateTime.UtcNow,
        LastSeenUtc = DateTime.UtcNow
    };

    private async Task ResetAsync()
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE \"LlmModelFindings\"");
    }

    [SkippableFact]
    public async Task PartialUniqueIndex_AllowsOneOpenRowPerModelButManyResolved()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();

        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            db.LlmModelFindings.AddRange(Finding(LlmModelFindingStatus.Resolved), Finding(LlmModelFindingStatus.Resolved), Finding(LlmModelFindingStatus.Open));
            await db.SaveChangesAsync();
        }

        await using ApplicationDbContext duplicate = fixture.CreateDbContext();
        duplicate.LlmModelFindings.Add(Finding(LlmModelFindingStatus.Open));
        Func<Task> save = () => duplicate.SaveChangesAsync();
        await save.Should().ThrowAsync<DbUpdateException>();
    }

    [SkippableFact]
    public async Task OverlappingRuns_ProduceOneFindingAndOneEmail()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        FakeCatalogClient catalog = new();
        catalog.SetModels("OpenAI", "x");
        CountingEmailSender email = new();

        Task<LlmModelAuditRunResult>[] runs = Enumerable.Range(0, 4)
            .Select(_ => Task.Run(() => new LlmModelAuditRunner(
                fixture.CreateDbContext(), LlmModelAuditTestSupport.Registry("OpenAI"), catalog, email, TimeProvider.System, NullLogger<LlmModelAuditRunner>.Instance)
                .RunAsync(default)))
            .ToArray();
        await Task.WhenAll(runs);

        await using ApplicationDbContext db = fixture.CreateDbContext();
        (await db.LlmModelFindings.CountAsync()).Should().Be(1);
        email.Sent.Should().Be(1);
    }
}
