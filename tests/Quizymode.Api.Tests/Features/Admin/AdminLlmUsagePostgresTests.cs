using System.Data.Common;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
using Xunit.Abstractions;

namespace Quizymode.Api.Tests.Features.Admin;

/// <summary>
/// #249: the admin LLM usage report is aggregated in SQL. These tests run the real queries on PostgreSQL and compare
/// them with the previous in-memory algorithm, and assert that only two grouped commands are issued. Requires Docker.
/// </summary>
[Trait("Category", "Postgres")]
public sealed class AdminLlmUsagePostgresTests(PostgresContainerFixture fixture, ITestOutputHelper output)
    : IClassFixture<PostgresContainerFixture>
{
    private static readonly DateTime Now = new(2026, 10, 20, 12, 0, 0, DateTimeKind.Utc);

    private sealed class RecordingInterceptor : DbCommandInterceptor
    {
        public List<string> Commands { get; } = [];

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Commands.Add(command.CommandText);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Commands.Add(command.CommandText);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    private static IConfiguration PricedConfig() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["LlmPricing:g-1:InputPerMTok"] = "0.5",
        ["LlmPricing:g-1:OutputPerMTok"] = "1.5",
        ["LlmPricing:gpt-5:InputPerMTok"] = "1",
        ["LlmPricing:gpt-5:OutputPerMTok"] = "2",
        ["LlmPricing:half:InputPerMTok"] = "1",
    }).Build();

    private async Task ResetAsync()
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        await db.Database.ExecuteSqlRawAsync(
            "TRUNCATE TABLE \"LlmAttempts\", \"StudyGuideQuotaCharges\", \"SectionGenerations\" CASCADE");
    }

    private static void SeedEdgeCases(ApplicationDbContext db)
    {
        void Attempt(string vendor, string model, LlmAttemptOutcome outcome, int? input, int? output, int durationMs, double ageDays = 1) =>
            db.LlmAttempts.Add(new LlmAttempt
            {
                Id = Guid.NewGuid(), Vendor = vendor, Model = model, Outcome = outcome,
                InputTokens = input, OutputTokens = output, DurationMs = durationMs, CreatedUtc = Now.AddDays(-ageDays)
            });

        // Failed attempts with null and non-null tokens; one row outside the 30-day window.
        Attempt("Gemini", "g-1", LlmAttemptOutcome.Success, 100, 50, 1000);
        Attempt("Gemini", "g-1", LlmAttemptOutcome.AuthError, null, null, 200);
        Attempt("Gemini", "g-1", LlmAttemptOutcome.Timeout, 7, null, 201);
        Attempt("Gemini", "g-1", LlmAttemptOutcome.Success, 300, 150, 600, 40);
        // int.MaxValue sums must not overflow; mean of 10 and 11 is exactly .5 and rounds up to 11.
        Attempt("OpenAi", "gpt-5", LlmAttemptOutcome.Success, int.MaxValue, int.MaxValue, 10);
        Attempt("OpenAi", "gpt-5", LlmAttemptOutcome.Success, int.MaxValue, int.MaxValue, 11);
        // Ordinal vs collation ordering guards (ordering is applied in memory).
        Attempt("OpenAi", "GPT-4o", LlmAttemptOutcome.Timeout, null, 5, 10);
        Attempt("OpenAi", "GPT-4o", LlmAttemptOutcome.Success, 1, 5, 11);
        Attempt("OpenAi", "GPT-4o", LlmAttemptOutcome.Success, 1, 5, 11); // mean 10.67 -> 11
        Attempt("openai", "a:b", LlmAttemptOutcome.Success, 1, 1, 7);
        Attempt("openai", "half", LlmAttemptOutcome.Success, 1_000_000, 1_000_000, 3);
        Attempt("openai", "unpriced", LlmAttemptOutcome.Success, 5, 5, 3);
        Attempt("DeepSeek", "ds", LlmAttemptOutcome.Success, 1, 1, 7, 30); // exactly on the days=30 boundary

        Guid Generation(int? input, int? output)
        {
            var generation = new SectionGeneration
            {
                Id = Guid.NewGuid(), TextSha256 = Guid.NewGuid().ToString("N"), NotBeforeUtc = Now,
                CreatedUtc = Now, QueuedUtc = Now, InputTokens = input, OutputTokens = output
            };
            db.SectionGenerations.Add(generation);
            return generation.Id;
        }

        void Charge(string userId, Guid generationId, int cost = 1, double ageDays = 1) =>
            db.StudyGuideQuotaCharges.Add(new StudyGuideQuotaCharge
            {
                Id = Guid.NewGuid(), UserId = userId, SectionId = Guid.NewGuid(), GenerationId = generationId,
                ChargedUtc = Now.AddDays(-ageDays), Cost = cost
            });

        Guid completed = Generation(1000, 500);
        Guid pending = Generation(null, null);
        Guid huge = Generation(int.MaxValue, int.MaxValue);

        // Duplicate charges on one generation: cost adds up, tokens count once.
        Charge("User-B", completed);
        Charge("User-B", completed);
        Charge("user-a", completed);
        Charge("user-a", completed);
        // Ties broken by user id: "a-c" vs "ab" and "User-B" vs "user-a" differ between ordinal and linguistic order.
        Charge("a-c", pending);
        Charge("ab", pending);
        Charge("ab", completed, 1, 60); // old charge, outside 30 days
        // Charges whose generation row does not exist (no FK): zero tokens, still listed.
        Charge("orphan", Guid.NewGuid());
        Charge("orphan", Guid.NewGuid());
        Charge("big", huge);
        Charge("big", Guid.NewGuid());
        Charge("big", huge);
        // More than 20 users so the top-20 cut applies; all tie on cost and tokens.
        for (int index = 0; index < 21; index++)
        {
            Charge($"u{index:00}", pending);
        }

        db.SaveChanges();
    }

    // Verbatim copy of AdminLlmProviders.HandleUsageAsync at commit 7d645b33 (before #249): the oracle.
    private static async Task<AdminLlmProviders.UsageResponse> LegacyComputeAsync(
        int days, ApplicationDbContext db, IConfiguration configuration, DateTime nowUtc, CancellationToken cancellationToken)
    {
        DateTime since = nowUtc.AddDays(-days);

        var attempts = await db.LlmAttempts
            .AsNoTracking()
            .Where(attempt => attempt.CreatedUtc >= since)
            .Select(attempt => new { attempt.Vendor, attempt.Model, attempt.Outcome, attempt.InputTokens, attempt.OutputTokens, attempt.DurationMs })
            .ToListAsync(cancellationToken);

        List<AdminLlmProviders.UsageRow> rows = attempts
            .GroupBy(attempt => (attempt.Vendor, attempt.Model))
            .OrderBy(group => group.Key.Vendor, StringComparer.Ordinal)
            .ThenBy(group => group.Key.Model, StringComparer.Ordinal)
            .Select(group =>
            {
                long inputTokens = group.Sum(attempt => (long)(attempt.InputTokens ?? 0));
                long outputTokens = group.Sum(attempt => (long)(attempt.OutputTokens ?? 0));
                return new AdminLlmProviders.UsageRow(
                    group.Key.Vendor,
                    group.Key.Model,
                    group.Count(),
                    group.Count(attempt => attempt.Outcome == LlmAttemptOutcome.Success),
                    inputTokens,
                    outputTokens,
                    (int)Math.Round(group.Average(attempt => (double)attempt.DurationMs), MidpointRounding.AwayFromZero),
                    LlmPricing.EstimateCostUsd(configuration, group.Key.Vendor, group.Key.Model, inputTokens, outputTokens));
            })
            .ToList();

        var charges = await db.StudyGuideQuotaCharges
            .AsNoTracking()
            .Where(charge => charge.ChargedUtc >= since)
            .Select(charge => new { charge.UserId, charge.GenerationId, charge.Cost })
            .ToListAsync(cancellationToken);
        List<Guid> generationIds = charges.Select(charge => charge.GenerationId).Distinct().ToList();
        Dictionary<Guid, (long Input, long Output)> tokensByGeneration = generationIds.Count == 0
            ? []
            : (await db.SectionGenerations
                    .AsNoTracking()
                    .Where(generation => generationIds.Contains(generation.Id))
                    .Select(generation => new { generation.Id, generation.InputTokens, generation.OutputTokens })
                    .ToListAsync(cancellationToken))
                .ToDictionary(generation => generation.Id, generation => ((long)(generation.InputTokens ?? 0), (long)(generation.OutputTokens ?? 0)));

        List<AdminLlmProviders.TopUser> topUsers = charges
            .GroupBy(charge => (charge.UserId, charge.GenerationId))
            .Select(pair => (
                pair.Key.UserId,
                Cost: pair.Sum(charge => charge.Cost),
                Tokens: tokensByGeneration.GetValueOrDefault(pair.Key.GenerationId)))
            .GroupBy(pair => pair.UserId)
            .Select(user => new AdminLlmProviders.TopUser(
                user.Key,
                user.Sum(pair => pair.Cost),
                user.Sum(pair => pair.Tokens.Input),
                user.Sum(pair => pair.Tokens.Output)))
            .OrderByDescending(user => user.ChargedSections)
            .ThenByDescending(user => user.InputTokens + user.OutputTokens)
            .ThenBy(user => user.UserId, StringComparer.Ordinal)
            .Take(AdminLlmProviders.MaxTopUsers)
            .ToList();

        return new AdminLlmProviders.UsageResponse(days, since, rows, topUsers);
    }

    [SkippableFact]
    public async Task SqlAggregation_MatchesLegacyInMemoryResult()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        await using (ApplicationDbContext seed = fixture.CreateDbContext())
        {
            SeedEdgeCases(seed);
        }

        await using ApplicationDbContext db = fixture.CreateDbContext();
        IConfiguration config = PricedConfig();

        // Guard against a vacuous comparison: the oracle itself must be non-trivial.
        AdminLlmProviders.UsageResponse legacy30 = await LegacyComputeAsync(30, db, config, Now, CancellationToken.None);
        legacy30.Rows.Count.Should().BeGreaterThanOrEqualTo(4);
        legacy30.TopUsers.Should().HaveCount(20);
        legacy30.TopUsers.Should().Contain(user => user.UserId == "orphan" && user.InputTokens == 0 && user.OutputTokens == 0);
        legacy30.Rows.Should().Contain(row => row.Model == "gpt-5" && row.AvgDurationMs == 11);
        legacy30.Rows.Should().Contain(row => row.Model == "gpt-5" && row.EstimatedCostUsd != null);
        legacy30.Rows.Should().Contain(row => row.Model == "g-1" && row.EstimatedCostUsd != null);

        foreach (int days in new[] { 1, 30, 90 })
        {
            AdminLlmProviders.UsageResponse legacy = await LegacyComputeAsync(days, db, config, Now, CancellationToken.None);
            AdminLlmProviders.UsageResponse sql = await AdminLlmProviders.HandleUsageAsync(days, db, config, Now, CancellationToken.None);

            sql.Should().BeEquivalentTo(legacy, options => options.WithStrictOrdering(), $"days={days}");
        }
    }

    [SkippableFact]
    public async Task SqlAggregation_RunsAsTwoGroupedQueries_NoRowLoads()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();
        await using (ApplicationDbContext seed = fixture.CreateDbContext())
        {
            for (int index = 0; index < 50; index++)
            {
                seed.LlmAttempts.Add(new LlmAttempt
                {
                    Id = Guid.NewGuid(), Vendor = "Gemini", Model = index % 2 == 0 ? "m-a" : "m-b",
                    Outcome = LlmAttemptOutcome.Success, InputTokens = 1, OutputTokens = 1, DurationMs = 5,
                    CreatedUtc = Now.AddDays(-1)
                });
            }

            seed.SaveChanges();
        }

        DateTime since = Now.AddDays(-30);
        await using (ApplicationDbContext rowsDb = fixture.CreateDbContext())
        {
            List<AdminLlmProviders.UsageRowAggregate> aggregates =
                await AdminLlmProviders.BuildRowAggregatesQuery(rowsDb, since).ToListAsync();
            aggregates.Should().HaveCount(2);
            output.WriteLine("-- attempts aggregate query");
            output.WriteLine(AdminLlmProviders.BuildRowAggregatesQuery(rowsDb, since).ToQueryString());
            output.WriteLine("-- top users aggregate query");
            output.WriteLine(AdminLlmProviders.BuildTopUserAggregatesQuery(rowsDb, since).ToQueryString());
        }

        var recorder = new RecordingInterceptor();
        await using ApplicationDbContext db = fixture.CreateDbContext(recorder);
        await AdminLlmProviders.HandleUsageAsync(30, db, PricedConfig(), Now, CancellationToken.None);

        recorder.Commands.Should().HaveCount(2);
        recorder.Commands.Should().OnlyContain(sql => sql.Contains("GROUP BY"));
        recorder.Commands.Should().ContainSingle(sql => sql.Contains("FROM \"LlmAttempts\""));
        recorder.Commands.Should().ContainSingle(sql => sql.Contains("LEFT JOIN \"SectionGenerations\""));
        string attemptsSql = recorder.Commands.Single(sql => sql.Contains("FROM \"LlmAttempts\""));
        attemptsSql.Should().Contain("sum(");
        // The only reference to DurationMs is inside its sum(...): the raw column is never selected.
        attemptsSql.Should().Contain("sum(l.\"DurationMs\"");
        attemptsSql.Split("\"DurationMs\"").Length.Should().Be(2);
    }

    [SkippableFact]
    public async Task EmptyTables_ReturnEmptyLists()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await ResetAsync();

        await using ApplicationDbContext db = fixture.CreateDbContext();
        AdminLlmProviders.UsageResponse response =
            await AdminLlmProviders.HandleUsageAsync(30, db, PricedConfig(), Now, CancellationToken.None);

        response.Rows.Should().BeEmpty();
        response.TopUsers.Should().BeEmpty();
    }
}
