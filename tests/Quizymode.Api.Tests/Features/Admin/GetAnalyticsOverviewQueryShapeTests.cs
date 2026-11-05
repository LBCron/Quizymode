using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin;

/// <summary>
/// Issue #471: the internal-traffic filter uses NOT EXISTS and a visitor-id semi-join (never NOT IN or a
/// self-join), the Overview loads the visitor cohort rows once, and sibling propagation is unchanged.
/// </summary>
public sealed class GetAnalyticsOverviewQueryShapeTests : DatabaseTestFixture
{
    private static readonly DateTime Now = new(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);
    private readonly SqlCaptureInterceptor _sql;

    public GetAnalyticsOverviewQueryShapeTests() : this(new SqlCaptureInterceptor())
    {
    }

    private GetAnalyticsOverviewQueryShapeTests(SqlCaptureInterceptor sql) : base([sql])
    {
        _sql = sql;
    }

    private static PageView Hit(string sessionId, DateTime createdUtc, bool isInternal = false) => new()
    {
        Id = Guid.NewGuid(),
        SessionId = sessionId,
        IpAddress = "198.51.100.10",
        Path = "/",
        QueryString = string.Empty,
        Url = "/",
        UserAgent = "Mozilla/5.0",
        IsInternal = isInternal,
        CreatedUtc = createdUtc
    };

    private static AnalyticsSession Session(string sessionId, string? visitorId, DateTime firstSeenUtc) => new()
    {
        Id = Guid.NewGuid(),
        SessionId = sessionId,
        VisitorId = visitorId,
        FirstSeenUtc = firstSeenUtc,
        LandingPath = "/",
        Channel = "direct",
        DeviceClass = "desktop",
        AppVersion = "3.121.0",
        CreatedUtc = firstSeenUtc
    };

    private Task<Result<GetAnalyticsOverview.Response>> Run(int days = 7) =>
        GetAnalyticsOverview.HandleAsync(new GetAnalyticsOverview.QueryRequest(days), DbContext, Now, CancellationToken.None);

    private async Task<HashSet<string>> InternalIdsAsync() =>
        (await InternalTrafficFilter.AllInternalSessionIds(DbContext).ToListAsync()).ToHashSet();

    [Fact]
    public async Task Overview_LoadsCohortRowsOnce()
    {
        DbContext.AnalyticsSessions.Add(Session("a", "v1", Now.AddDays(-1)));
        DbContext.PageViews.Add(Hit("a", Now.AddDays(-1)));
        await DbContext.SaveChangesAsync();
        int before = _sql.Commands.Count;

        (await Run(7)).IsSuccess.Should().BeTrue();

        List<string> cohortCommands = _sql.Commands.Skip(before)
            .Where(text => text.Contains("FROM \"AnalyticsSessions\"", StringComparison.Ordinal)
                && text.Contains("\"FirstSeenUtc\"", StringComparison.Ordinal)
                && text.Contains("\"UtmCampaign\"", StringComparison.Ordinal)
                && text.Contains("\"Channel\"", StringComparison.Ordinal)
                && text.Contains("\"VisitorId\"", StringComparison.Ordinal)
                && text.Contains("\"UserId\"", StringComparison.Ordinal))
            .ToList();
        cohortCommands.Should().HaveCount(1);
    }

    [Fact]
    public async Task Overview_GeneratedSql_UsesNoNotIn()
    {
        DbContext.AnalyticsSessions.AddRange(Session("a", "v1", Now.AddDays(-1)), Session("b", "v1", Now.AddDays(-2)));
        DbContext.PageViews.AddRange(Hit("a", Now.AddDays(-1), isInternal: true), Hit("b", Now.AddDays(-2)), Hit("c", Now.AddDays(-2)));
        await DbContext.SaveChangesAsync();
        int before = _sql.Commands.Count;

        (await Run(7)).IsSuccess.Should().BeTrue();

        List<string> commands = _sql.Commands.Skip(before).ToList();
        commands.Should().NotBeEmpty();
        // Covers ExcludeInternalSessions (page views), the cohort filter, and the release markers query.
        // The client-errors work-queue query is out of scope for #471 and still uses NOT IN.
        commands.Where(text => !text.Contains("ClientErrors", StringComparison.Ordinal))
            .Should().OnlyContain(text => !text.Contains("NOT IN", StringComparison.OrdinalIgnoreCase));
        commands.Count(text => text.Contains("NOT EXISTS", StringComparison.OrdinalIgnoreCase)).Should().BeGreaterThanOrEqualTo(3);
    }

    [Fact]
    public async Task Propagation_NullVisitorInternalSession_DoesNotTaintAnotherNullVisitorSession()
    {
        DbContext.AnalyticsSessions.AddRange(Session("a", null, Now), Session("b", null, Now));
        DbContext.PageViews.AddRange(Hit("a", Now, isInternal: true), Hit("b", Now));
        await DbContext.SaveChangesAsync();

        HashSet<string> ids = await InternalIdsAsync();

        ids.Should().BeEquivalentTo(["a"]);
    }

    [Fact]
    public async Task Propagation_SiblingWithSameVisitorId_IsExcluded()
    {
        DbContext.AnalyticsSessions.AddRange(Session("a", "v1", Now), Session("b", "v1", Now));
        DbContext.PageViews.AddRange(Hit("a", Now, isInternal: true), Hit("b", Now));
        await DbContext.SaveChangesAsync();

        HashSet<string> ids = await InternalIdsAsync();

        ids.Should().BeEquivalentTo(["a", "b"]);
    }

    [Fact]
    public async Task Propagation_SessionWithoutAnalyticsSessionRow_IsExcludedByOwnEvidence()
    {
        DbContext.PageViews.Add(Hit("orphan", Now, isInternal: true));
        await DbContext.SaveChangesAsync();

        HashSet<string> ids = await InternalIdsAsync();

        ids.Should().BeEquivalentTo(["orphan"]);
    }

    [Fact]
    public async Task Propagation_DifferentVisitorId_IsNotExcluded()
    {
        DbContext.AnalyticsSessions.AddRange(Session("a", "v1", Now), Session("b", "v2", Now));
        DbContext.PageViews.AddRange(Hit("a", Now, isInternal: true), Hit("b", Now));
        await DbContext.SaveChangesAsync();

        HashSet<string> ids = await InternalIdsAsync();

        ids.Should().BeEquivalentTo(["a"]);
    }

    [Fact]
    public async Task Overview_VisitorWithInternalHit_IsNotCountedAsVisitorOrHumanSession()
    {
        DbContext.AnalyticsSessions.AddRange(
            Session("a", "v1", Now.AddDays(-2)),
            Session("b", "v1", Now.AddDays(-1)),
            Session("c", "v2", Now.AddDays(-1)));
        DbContext.PageViews.AddRange(
            Hit("a", Now.AddDays(-2), isInternal: true),
            Hit("b", Now.AddDays(-1)),
            Hit("c", Now.AddDays(-1)));
        await DbContext.SaveChangesAsync();

        Result<GetAnalyticsOverview.Response> result = await Run(7);

        result.Value.Current.HumanSessions.Should().Be(1);
        result.Value.Current.NewVisitors.Should().Be(1);
        result.Value.Current.ReturningVisitors.Should().Be(0);
    }
}
