using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Features.LlmModelAudit;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.LlmModelAudit;

/// <summary>#480: the audit pass records, dedupes, notifies and resolves findings (SQLite; vendors and email faked).</summary>
public sealed class LlmModelAuditRunnerTests : DatabaseTestFixture
{
    private readonly FakeCatalogClient _catalog = new();
    private readonly CountingEmailSender _email = new();

    private LlmModelAuditRunner Runner(params string[] keyedVendors) =>
        new(CreateDbContext(), LlmModelAuditTestSupport.Registry(keyedVendors), _catalog, _email, TimeProvider.System, NullLogger<LlmModelAuditRunner>.Instance);

    private Task<List<LlmModelFinding>> FindingsAsync() => DbContext.LlmModelFindings.AsNoTracking().ToListAsync();

    [Fact]
    public async Task ModelPresent_NoFindingNoEmail()
    {
        _catalog.SetModels("OpenAI", "gpt-5-nano", "other");

        await Runner("OpenAI").RunAsync(default);

        (await FindingsAsync()).Should().BeEmpty();
        _email.Sent.Should().Be(0);
    }

    [Fact]
    public async Task ModelMissing_OneOpenFindingOneEmail_AndSameDayRerunAddsNothing()
    {
        _catalog.SetModels("OpenAI", "something-else");

        LlmModelAuditRunResult first = await Runner("OpenAI").RunAsync(default);
        LlmModelAuditRunResult second = await Runner("OpenAI").RunAsync(default);

        List<LlmModelFinding> findings = await FindingsAsync();
        findings.Should().ContainSingle();
        findings[0].Vendor.Should().Be("OpenAI");
        findings[0].Model.Should().Be("gpt-5-nano");
        findings[0].Status.Should().Be(LlmModelFindingStatus.Open);
        findings[0].NotifiedUtc.Should().NotBeNull();
        first.NewFindings.Should().Be(1);
        second.NewFindings.Should().Be(0);
        _email.Sent.Should().Be(1);
    }

    [Fact]
    public async Task VendorWithoutKey_IsSkippedWithoutFinding()
    {
        await Runner().RunAsync(default);

        _catalog.Calls.Should().BeEmpty();
        (await FindingsAsync()).Should().BeEmpty();
        _email.Sent.Should().Be(0);
    }

    [Fact]
    public async Task FailedCheck_CreatesNoFindingAndKeepsExistingOne()
    {
        _catalog.SetFailed("Groq");

        await Runner("Groq").RunAsync(default);

        (await FindingsAsync()).Should().BeEmpty();

        _catalog.SetModels("Groq", "x");
        await Runner("Groq").RunAsync(default);
        _catalog.SetFailed("Groq");
        await Runner("Groq").RunAsync(default);

        (await FindingsAsync()).Should().ContainSingle(f => f.Status == LlmModelFindingStatus.Open);
    }

    [Fact]
    public async Task ModelReappearing_ResolvesTheFinding()
    {
        _catalog.SetModels("Cerebras", "x");
        await Runner("Cerebras").RunAsync(default);
        _catalog.SetModels("Cerebras", "x", "gpt-oss-120b");

        LlmModelAuditRunResult result = await Runner("Cerebras").RunAsync(default);

        LlmModelFinding finding = (await FindingsAsync()).Should().ContainSingle().Subject;
        finding.Status.Should().Be(LlmModelFindingStatus.Resolved);
        finding.ResolvedUtc.Should().NotBeNull();
        result.Resolved.Should().Be(1);
    }

    [Fact]
    public async Task ModelChangedByAdmin_ResolvesOldFindingWhenNewModelIsListed()
    {
        _catalog.SetModels("OpenAI", "x");
        await Runner("OpenAI").RunAsync(default);

        LlmProviderSettings settings = await LlmProviderSettingsStore.GetOrCreateAsync(DbContext, default);
        LlmProviderSettingsStore.SetModel(settings, "OpenAI", "x");
        await DbContext.SaveChangesAsync();
        await Runner("OpenAI").RunAsync(default);

        (await FindingsAsync()).Should().ContainSingle().Which.Status.Should().Be(LlmModelFindingStatus.Resolved);
    }

    [Fact]
    public async Task EmailNotConfigured_KeepsFindingUnnotified_AndNextRunWithConfigSendsDigest()
    {
        _email.Configured = false;
        _catalog.SetModels("OpenAI", "x");

        Func<Task> run = () => Runner("OpenAI").RunAsync(default);
        await run.Should().NotThrowAsync();

        (await FindingsAsync()).Should().ContainSingle().Which.NotifiedUtc.Should().BeNull();
        _email.Sent.Should().Be(0);

        _email.Configured = true;
        await Runner("OpenAI").RunAsync(default);

        (await FindingsAsync()).Should().ContainSingle().Which.NotifiedUtc.Should().NotBeNull();
        _email.Sent.Should().Be(1);
    }
}
