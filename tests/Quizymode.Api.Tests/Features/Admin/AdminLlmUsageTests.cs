using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

/// <summary>Admin LLM usage report (AC 5.12.6, 5.12.7): per vendor/model totals, estimated cost, and top users.</summary>
public sealed class AdminLlmUsageTests : DatabaseTestFixture
{
    private static readonly DateTime Now = new(2026, 10, 20, 12, 0, 0, DateTimeKind.Utc);

    private static IConfiguration Pricing(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.ToDictionary(v => $"LlmPricing:{v.Key}", v => (string?)v.Value))
            .Build();

    private void AddAttempt(
        string vendor,
        string model,
        LlmAttemptOutcome outcome,
        int? input,
        int? output,
        int durationMs,
        double ageDays = 1) =>
        DbContext.LlmAttempts.Add(new LlmAttempt
        {
            Id = Guid.NewGuid(),
            Vendor = vendor,
            Model = model,
            Outcome = outcome,
            InputTokens = input,
            OutputTokens = output,
            DurationMs = durationMs,
            CreatedUtc = Now.AddDays(-ageDays)
        });

    private Guid AddGeneration(int? input, int? output)
    {
        SectionGeneration generation = new()
        {
            Id = Guid.NewGuid(),
            TextSha256 = Guid.NewGuid().ToString("N"),
            Status = SectionGenerationStatus.Completed,
            Tier = StudyGuideTier.Free,
            NotBeforeUtc = Now,
            CreatedUtc = Now,
            QueuedUtc = Now,
            InputTokens = input,
            OutputTokens = output
        };
        DbContext.SectionGenerations.Add(generation);
        return generation.Id;
    }

    private void AddCharge(string userId, Guid generationId, int cost = 1, double ageDays = 1) =>
        DbContext.StudyGuideQuotaCharges.Add(new StudyGuideQuotaCharge
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            SectionId = Guid.NewGuid(),
            GenerationId = generationId,
            ChargedUtc = Now.AddDays(-ageDays),
            Cost = cost
        });

    private async Task<AdminLlmProviders.UsageResponse> UsageAsync(int days = 30, IConfiguration? configuration = null)
    {
        await DbContext.SaveChangesAsync();
        return await AdminLlmProviders.HandleUsageAsync(days, DbContext, configuration ?? Pricing(), Now, CancellationToken.None);
    }

    [Fact]
    public async Task Usage_TotalsPerVendorAndModel_IncludeFailedAttemptsAndExcludeOldOnes()
    {
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 100, 50, 1000);
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.AuthError, null, null, 200);
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.LowQuoteYield, 300, 150, 600);
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 9999, 9999, 9999, ageDays: 31);
        AddAttempt("DeepSeek", "d-1", LlmAttemptOutcome.ProviderError, 7, null, 40);
        AddAttempt("Gemini", "g-2", LlmAttemptOutcome.Success, 1, 2, 10);

        AdminLlmProviders.UsageResponse usage = await UsageAsync();

        usage.Days.Should().Be(30);
        usage.SinceUtc.Should().Be(Now.AddDays(-30));
        usage.Rows.Select(r => (r.Vendor, r.Model)).Should().Equal(("DeepSeek", "d-1"), ("Gemini", "g-1"), ("Gemini", "g-2"));
        AdminLlmProviders.UsageRow gemini = usage.Rows[1];
        gemini.Attempts.Should().Be(3);
        gemini.Successes.Should().Be(1);
        gemini.InputTokens.Should().Be(400, "failed attempts' tokens count, nulls count as zero");
        gemini.OutputTokens.Should().Be(200);
        gemini.AvgDurationMs.Should().Be(600);
        usage.Rows[0].Successes.Should().Be(0);
        usage.Rows[0].InputTokens.Should().Be(7);
    }

    [Fact]
    public async Task Usage_WindowFollowsTheRequestedDays()
    {
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 1, 1, 10, ageDays: 0.5);
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 1, 1, 10, ageDays: 3);

        (await UsageAsync(1)).Rows.Single().Attempts.Should().Be(1);
        (await UsageAsync(7)).Rows.Single().Attempts.Should().Be(2);
    }

    [Fact]
    public async Task Usage_AverageDurationIsRounded()
    {
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 1, 1, 10);
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 1, 1, 11);
        AddAttempt("Gemini", "g-1", LlmAttemptOutcome.Success, 1, 1, 11);

        (await UsageAsync()).Rows.Single().AvgDurationMs.Should().Be(11, "10.67 rounds to 11");
    }

    [Fact]
    public async Task Usage_SumsTokensAsLong()
    {
        AddAttempt("OpenAI", "o-1", LlmAttemptOutcome.Success, int.MaxValue, int.MaxValue, 1);
        AddAttempt("OpenAI", "o-1", LlmAttemptOutcome.Success, int.MaxValue, 1, 1);

        AdminLlmProviders.UsageRow row = (await UsageAsync()).Rows.Single();

        row.InputTokens.Should().Be(2L * int.MaxValue);
        row.OutputTokens.Should().Be(int.MaxValue + 1L);
    }

    [Fact]
    public async Task Usage_EstimatedCost_PricedUnpricedAndHalfPriced()
    {
        AddAttempt("OpenAI", "priced", LlmAttemptOutcome.Success, 2_000_000, 500_000, 10);
        AddAttempt("OpenAI", "unpriced", LlmAttemptOutcome.Success, 1000, 1000, 10);
        AddAttempt("OpenAI", "half", LlmAttemptOutcome.Success, 1000, 1000, 10);
        AddAttempt("OpenAI", "bad-price", LlmAttemptOutcome.Success, 1000, 1000, 10);
        AddAttempt("OpenAI", "negative", LlmAttemptOutcome.Success, 1000, 1000, 10);
        AddAttempt("OpenAI", "with:colon", LlmAttemptOutcome.Success, 1000, 1000, 10);

        AdminLlmProviders.UsageResponse usage = await UsageAsync(configuration: Pricing(
            ("priced:InputPerMTok", "0.10"), ("priced:OutputPerMTok", "0.40"),
            ("half:InputPerMTok", "0.10"),
            ("bad-price:InputPerMTok", "abc"), ("bad-price:OutputPerMTok", "1"),
            ("negative:InputPerMTok", "-1"), ("negative:OutputPerMTok", "1"),
            ("with:colon:InputPerMTok", "1"), ("with:colon:OutputPerMTok", "1")));

        Dictionary<string, decimal?> cost = usage.Rows.ToDictionary(r => r.Model, r => r.EstimatedCostUsd);
        cost["priced"].Should().Be(0.4000m, "2M in * 0.10 + 0.5M out * 0.40");
        cost["unpriced"].Should().BeNull();
        cost["half"].Should().BeNull("both prices are required");
        cost["bad-price"].Should().BeNull();
        cost["negative"].Should().BeNull();
        cost["with:colon"].Should().BeNull("':' is the configuration path separator");
    }

    [Fact]
    public void Pricing_RoundsMidpointsAwayFromZeroToFourDecimals_AndParsesInvariantly()
    {
        IConfiguration configuration = Pricing(("m:InputPerMTok", "1.0"), ("m:OutputPerMTok", "0"), ("comma:InputPerMTok", "1,5"), ("comma:OutputPerMTok", "1"));

        LlmPricing.EstimateCostUsd(configuration, "OpenAI", "m", 1_250, 0).Should().Be(0.0013m, "0.00125 is a midpoint and rounds away from zero");
        LlmPricing.EstimateCostUsd(configuration, "OpenAI", "m", 0, 0).Should().Be(0m);
        LlmPricing.EstimateCostUsd(configuration, "OpenAI", "comma", 1000, 1000).Should().BeNull("only '.' is a decimal separator");
    }

    [Theory]
    [InlineData("Groq", "openai/gpt-oss-120b", 0)]
    [InlineData("Cerebras", "gpt-oss-120b", 0)]
    [InlineData("OpenRouter", "google/gemma-4-31b-it:free", 0)]
    [InlineData("OpenRouter", "openai/gpt-5", null)]
    [InlineData("DeepSeek", "deepseek-flash", null)]
    public void Pricing_FreeTierVendorsAreZero_OthersNeedConfiguredPrices(string vendor, string model, int? expected)
    {
        LlmPricing.EstimateCostUsd(Pricing(), vendor, model, 1_000_000, 1_000_000).Should().Be(expected is null ? null : (decimal)expected.Value);
    }

    [Fact]
    public async Task TopUsers_SumChargedSectionsAndRecordedTokens_ExcludeOldCharges()
    {
        Guid g1 = AddGeneration(100, 40);
        Guid g2 = AddGeneration(10, 5);
        Guid pending = AddGeneration(null, null);
        Guid old = AddGeneration(5000, 5000);
        AddCharge("user-a", g1);
        AddCharge("user-a", g2, cost: 2);
        AddCharge("user-b", pending);
        AddCharge("user-b", old, ageDays: 45);
        AddCharge("user-c", g1, ageDays: 60);

        AdminLlmProviders.UsageResponse usage = await UsageAsync();

        usage.TopUsers.Should().Equal(
            new AdminLlmProviders.TopUser("user-a", 3, 110, 45),
            new AdminLlmProviders.TopUser("user-b", 1, 0, 0));
    }

    [Fact]
    public async Task TopUsers_DuplicateChargesForTheSameGeneration_CountTokensOnce()
    {
        Guid generation = AddGeneration(100, 40);
        AddCharge("user-a", generation);
        AddCharge("user-a", generation);

        AdminLlmProviders.TopUser user = (await UsageAsync()).TopUsers.Single();

        user.ChargedSections.Should().Be(2);
        user.InputTokens.Should().Be(100);
        user.OutputTokens.Should().Be(40);
    }

    [Fact]
    public async Task TopUsers_AttachedFreeUserWithoutACharge_IsAbsent()
    {
        Guid generation = AddGeneration(100, 40);
        AddCharge("payer", generation);

        (await UsageAsync()).TopUsers.Select(u => u.UserId).Should().Equal("payer");
    }

    [Fact]
    public async Task TopUsers_TwentyOneUsers_ReturnsTwentyOrderedBySectionsThenTokens()
    {
        for (int i = 1; i <= 21; i++)
        {
            Guid generation = AddGeneration(i, 0);
            AddCharge($"user-{i:00}", generation, cost: i <= 2 ? 5 : 1);
        }

        IReadOnlyList<AdminLlmProviders.TopUser> top = (await UsageAsync()).TopUsers;

        top.Should().HaveCount(20);
        top.Take(2).Select(u => u.UserId).Should().Equal("user-02", "user-01");
        top.Skip(2).Select(u => u.UserId).First().Should().Be("user-21", "ties on sections break by tokens, highest first");
        top.Select(u => u.UserId).Should().NotContain("user-03", "the lowest of the 19 single-section users is dropped");
    }

    [Fact]
    public async Task Usage_EmptyDatabase_ReturnsEmptyLists()
    {
        AdminLlmProviders.UsageResponse usage = await UsageAsync();

        usage.Rows.Should().BeEmpty();
        usage.TopUsers.Should().BeEmpty();
    }
}
