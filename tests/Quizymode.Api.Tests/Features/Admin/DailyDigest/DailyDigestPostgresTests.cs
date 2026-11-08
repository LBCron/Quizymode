using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Admin.DailyDigest;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using Xunit.Abstractions;

namespace Quizymode.Api.Tests.Features.Admin.DailyDigest;

/// <summary>
/// Runs in its own non-parallel collection so the timing budget test does not measure CPU and Docker
/// contention from the other PostgreSQL-backed test classes, each of which starts its own container.
/// </summary>
[CollectionDefinition("DailyDigestTiming", DisableParallelization = true)]
public sealed class DailyDigestTimingCollectionDefinition { }

/// <summary>#509 AC 19 on real PostgreSQL: the migration, the filtered unique index and concurrent claims. Requires Docker.</summary>
[Trait("Category", "Postgres")]
[Collection("DailyDigestTiming")]
public sealed class DailyDigestPostgresTests(PostgresContainerFixture fixture, ITestOutputHelper output) : IClassFixture<PostgresContainerFixture>
{
    private static readonly DateTime Due = new(2026, 11, 7, 14, 0, 0, DateTimeKind.Utc);

    private async Task ResetAsync()
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE \"DailyDigestRuns\"");
    }

    private static DailyDigestRun Run(string kind, DateOnly date) => new()
    {
        Id = Guid.NewGuid(),
        Kind = kind,
        ReportDate = date,
        TimeZone = "America/Chicago",
        WindowStartUtc = Due,
        WindowEndUtc = Due.AddDays(1),
        Status = DailyDigestRunStatus.Sending,
        CreatedUtc = Due
    };

    [SkippableFact]
    public async Task FilteredUniqueIndex_AllowsOneScheduledRowPerDayButManyAdHocRows()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        DateOnly day = new(2026, 11, 6);

        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            db.DailyDigestRuns.AddRange(Run(DailyDigestRunKind.Scheduled, day), Run(DailyDigestRunKind.AdHoc, day), Run(DailyDigestRunKind.AdHoc, day));
            await db.SaveChangesAsync();
        }

        await using ApplicationDbContext duplicate = fixture.CreateDbContext();
        duplicate.DailyDigestRuns.Add(Run(DailyDigestRunKind.Scheduled, day));
        Func<Task> save = () => duplicate.SaveChangesAsync();
        await save.Should().ThrowAsync<DbUpdateException>();
    }

    [SkippableFact]
    public async Task TwoSchedulersTickingTogether_SendOneEmailAndWriteOneRow()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        FakeClock clock = new(Due);
        RecordingEmailSender email = new();

        Task Tick() => Task.Run(async () =>
        {
            await using ApplicationDbContext db = fixture.CreateDbContext();
            DailyDigestService service = new(
                new DailyDigestComposer(db, clock, NullLogger<DailyDigestComposer>.Instance),
                new DailyDigestRunStore(db, clock),
                email,
                Microsoft.Extensions.Options.Options.Create(new DailyDigestOptions { Enabled = true }),
                clock,
                NullLogger<DailyDigestService>.Instance);
            await service.TickAsync(CancellationToken.None);
        });

        await Task.WhenAll(Tick(), Tick(), Tick(), Tick());

        email.Sent.Should().HaveCount(1);
        await using ApplicationDbContext db = fixture.CreateDbContext();
        List<DailyDigestRun> rows = await db.DailyDigestRuns.AsNoTracking().Where(run => run.Kind == DailyDigestRunKind.Scheduled).ToListAsync();
        rows.Should().ContainSingle();
        rows[0].Status.Should().Be(DailyDigestRunStatus.Sent);
        rows[0].SummaryJson.Should().NotBeNullOrEmpty();
    }

    [SkippableFact]
    public async Task ALostClaim_CannotWriteAStatus()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        FakeClock clock = new(Due);
        await using ApplicationDbContext db = fixture.CreateDbContext();
        DailyDigestRunStore store = new(db, clock);
        DailyDigestRunStore.Claim? claim = await store.TryClaimAsync(new DateOnly(2026, 11, 6), Due, Due.AddDays(1), "America/Chicago", Due.AddDays(1), CancellationToken.None);
        claim.Should().NotBeNull();
        DailyDigestRunStore.Claim stale = claim! with { Token = Guid.NewGuid() };

        (await store.CompleteSentAsync(stale, CancellationToken.None)).Should().BeFalse();
        (await store.BeginSendAsync(stale, CancellationToken.None)).Should().BeFalse();
        (await store.CompleteSentAsync(claim, CancellationToken.None)).Should().BeTrue();
    }

    [SkippableFact]
    public async Task ARenewedSendingLease_IsNotTakenOver()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        DateOnly day = new(2026, 11, 6);
        FakeClock clock = new(Due);
        await using ApplicationDbContext db = fixture.CreateDbContext();
        DailyDigestRunStore store = new(db, clock);
        DailyDigestRunStore.Claim? claim = await store.TryClaimAsync(day, Due, Due.AddDays(1), "America/Chicago", Due.AddDays(1), CancellationToken.None);
        claim.Should().NotBeNull();

        // The clock is past the original lease, but the owner renewed it: the row must not be taken over.
        clock.UtcNow = Due.AddHours(1);
        await using (ApplicationDbContext other = fixture.CreateDbContext())
        {
            await other.DailyDigestRuns.Where(run => run.Id == claim!.Id)
                .ExecuteUpdateAsync(set => set.SetProperty(run => run.LeaseUntilUtc, Due.AddHours(3)));
        }

        (await store.TryClaimAsync(day, Due, Due.AddDays(1), "America/Chicago", Due.AddDays(1), CancellationToken.None)).Should().BeNull();
        await using (ApplicationDbContext check = fixture.CreateDbContext())
        {
            DailyDigestRun row = await check.DailyDigestRuns.AsNoTracking().SingleAsync(run => run.Id == claim!.Id);
            row.Status.Should().Be(DailyDigestRunStatus.Sending);
            row.ClaimToken.Should().Be(claim!.Token);
        }
    }

    [SkippableFact]
    public async Task Compose_OverA180DayProdSizedHistory_FinishesWithinTheBudget()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        DateOnly day = new(2026, 11, 6);
        await using (ApplicationDbContext seed = fixture.CreateDbContext())
        {
            await seed.Database.ExecuteSqlRawAsync("TRUNCATE TABLE \"PageViews\", \"AnalyticsSessions\", \"AnalyticsEvents\"");
            seed.ChangeTracker.AutoDetectChangesEnabled = false;
            // About 60k sessions over 180 days, one hit each, mostly internal like prod; every 20th session has a quiz event.
            for (int i = 0; i < 60_000; i++)
            {
                DateTime at = Due.AddDays(-1).AddMinutes(-(i % (180 * 24 * 60)));
                string id = "perf-" + i;
                bool isInternal = i % 10 != 0;
                seed.AnalyticsSessions.Add(DigestSeed.Session(id, at, i % 3 == 0 ? null : "v" + (i % 4000)));
                seed.PageViews.Add(DigestSeed.Hit(id, at, isInternal: isInternal));
                if (i % 20 == 0)
                {
                    seed.AnalyticsEvents.Add(DigestSeed.Event(AnalyticsEventCatalog.QuickQuizStarted, id, "run-" + i, at));
                }

                if (i % 5_000 == 4_999)
                {
                    await seed.SaveChangesAsync();
                    seed.ChangeTracker.Clear();
                }
            }

            await seed.SaveChangesAsync();
        }

        await using ApplicationDbContext db = fixture.CreateDbContext();
        DailyDigestComposer composer = new(db, new FakeClock(Due), NullLogger<DailyDigestComposer>.Instance);
        System.Diagnostics.Stopwatch watch = System.Diagnostics.Stopwatch.StartNew();
        DigestReport report = await composer.ComposeDailyAsync(day, TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"), CancellationToken.None);
        watch.Stop();

        output.WriteLine($"Composed a daily digest over 60k sessions / 180 days in {watch.ElapsedMilliseconds} ms");
        report.AllUnavailable.Should().BeFalse();
        report.Current.Visits.Should().NotBeNull();
        watch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(90));
    }
}
