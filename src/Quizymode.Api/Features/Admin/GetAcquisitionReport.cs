using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Rolls sessions up by acquisition channel, nested by UTM source/campaign, plus device-class and
/// country breakdowns, so admins can see which traffic sources engage and convert, not just how
/// many sessions they drove (TRAFFIC-122). Bounce, engaged, and converted numbers are computed from
/// each session's <see cref="PageView"/> hits via the shared <see cref="SessionClassifier"/> — the
/// exact same classification <c>GetPageViewSessions</c> uses — so totals here always match the
/// Sessions tab for the same window and exclusions.
/// </summary>
public static class GetAcquisitionReport
{
    /// <summary>Materializing more sessions than this in memory is refused; narrow the window instead.</summary>
    private const int MaxSessionsAnalyzed = 50_000;

    public sealed record QueryRequest(
        int Days = 7,
        bool IncludeBots = false,
        bool IncludeInternal = false,
        string? DeviceClass = null,
        string? Country = null);

    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int TotalSessions,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        List<ChannelRowResponse> Channels,
        List<DeviceBreakdownResponse> DeviceBreakdown,
        List<CountryBreakdownResponse> CountryBreakdown,
        VisitorCohortReport.Response Visitors);

    public sealed record ChannelRowResponse(
        string Channel,
        int Sessions,
        double BounceRatePercent,
        double EngagedRatePercent,
        int ConvertedCount,
        double ConversionRatePercent,
        List<SourceCampaignRowResponse> SourceBreakdown);

    public sealed record SourceCampaignRowResponse(
        string? UtmSource,
        string? UtmCampaign,
        int Sessions,
        double BounceRatePercent,
        double EngagedRatePercent,
        int ConvertedCount,
        double ConversionRatePercent);

    public sealed record DeviceBreakdownResponse(string DeviceClass, int Sessions);

    public sealed record CountryBreakdownResponse(string? Country, int Sessions);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/acquisition", Handler)
                .WithTags("Admin")
                .WithSummary("Get the acquisition channel report (Admin only)")
                .WithDescription("Rolls sessions up by acquisition channel, with a nested source/campaign breakdown, plus device-class and country breakdowns. Engaged, bounce, and converted numbers match GET /admin/page-view-sessions for the same window and exclusions. deviceClass and country filters narrow the whole report, not just their own breakdown. Bot sessions are excluded unless includeBots=true, and internal sessions unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
            bool includeBots = false,
            bool includeInternal = false,
            string? deviceClass = null,
            string? country = null,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            QueryRequest request = new(days, includeBots, includeInternal, deviceClass, country);
            Result<Response> result = await HandleAsync(request, db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.AcquisitionReport.InvalidDays", $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Engagement data is kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<PageView> windowQuery = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= windowStartUtc && pageView.CreatedUtc <= windowEndUtc);

        // Bot sessions are reported even when excluded, mirroring GetPageViewSessions.
        int botSessions = await windowQuery
            .Where(pageView => pageView.IsBot)
            .Select(pageView => pageView.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        HashSet<string> internalSessionIds = (await InternalTrafficFilter.InternalSessionIds(db, windowQuery)
            .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        IQueryable<PageView> baseQuery = request.IncludeBots
            ? windowQuery
            : windowQuery.Where(pageView => !pageView.IsBot);

        if (!request.IncludeInternal)
        {
            baseQuery = InternalTrafficFilter.ExcludeInternalSessions(db, baseQuery);
        }

        int sessionCount = await baseQuery
            .Select(pageView => pageView.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        if (sessionCount > MaxSessionsAnalyzed)
        {
            return Result.Failure<Response>(
                Error.Validation(
                    "Admin.AcquisitionReport.WindowTooLarge",
                    $"The selected window contains {sessionCount} sessions, which exceeds the {MaxSessionsAnalyzed} session analysis limit. Select a shorter time range."));
        }

        // Shared with GetPageViewSessions so bounce/engaged/converted numbers can never disagree
        // between the two reports for the same window and exclusions.
        List<SessionClassifier.ClassifiedSession> sessions = await SessionClassifier.ClassifyAsync(baseQuery, cancellationToken);

        List<string> sessionIds = sessions.Select(session => session.SessionId).ToList();
        Dictionary<string, AnalyticsSession> attribution = await db.AnalyticsSessions
            .AsNoTracking()
            .Where(session => sessionIds.Contains(session.SessionId))
            .ToDictionaryAsync(session => session.SessionId, cancellationToken);

        List<AcquisitionRow> rows = sessions
            .Select(session =>
            {
                attribution.TryGetValue(session.SessionId, out AnalyticsSession? snapshot);
                return new AcquisitionRow(
                    session,
                    Channel: snapshot?.Channel ?? "unknown",
                    DeviceClass: snapshot?.DeviceClass ?? "unknown",
                    Country: snapshot?.Country,
                    UtmSource: snapshot?.UtmSource,
                    UtmCampaign: snapshot?.UtmCampaign);
            })
            .ToList();

        // deviceClass and country narrow the whole report, not only their own breakdown card.
        string? deviceClassFilter = NormalizeFilter(request.DeviceClass);
        string? countryFilter = NormalizeFilter(request.Country);

        if (deviceClassFilter is not null)
        {
            rows = rows
                .Where(row => string.Equals(row.DeviceClass, deviceClassFilter, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        if (countryFilter is not null)
        {
            rows = rows
                .Where(row => string.Equals(row.Country, countryFilter, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        List<ChannelRowResponse> channels = BuildChannelRows(rows);

        List<DeviceBreakdownResponse> deviceBreakdown = rows
            .GroupBy(row => row.DeviceClass)
            .Select(group => new DeviceBreakdownResponse(group.Key, group.Count()))
            .OrderByDescending(row => row.Sessions)
            .ThenBy(row => row.DeviceClass, StringComparer.Ordinal)
            .ToList();

        List<CountryBreakdownResponse> countryBreakdown = rows
            .GroupBy(row => row.Country)
            .Select(group => new CountryBreakdownResponse(group.Key, group.Count()))
            .OrderByDescending(row => row.Sessions)
            .ThenBy(row => row.Country, StringComparer.Ordinal)
            .ToList();

        VisitorCohortReport.Response visitors = await VisitorCohortReport.BuildAsync(
            db, windowStartUtc, windowEndUtc, request.IncludeBots, request.IncludeInternal, cancellationToken);

        return Result.Success(new Response(
            windowStartUtc,
            windowEndUtc,
            rows.Count,
            botSessions,
            BotsExcluded: !request.IncludeBots,
            internalSessionIds.Count,
            InternalExcluded: !request.IncludeInternal,
            channels,
            deviceBreakdown,
            countryBreakdown,
            visitors));
    }

    private static List<ChannelRowResponse> BuildChannelRows(List<AcquisitionRow> rows)
    {
        return rows
            .GroupBy(row => row.Channel)
            .Select(group =>
            {
                List<AcquisitionRow> channelRows = group.ToList();
                int sessions = channelRows.Count;
                int bounced = channelRows.Count(row => row.Session.IsBounce);
                int engaged = channelRows.Count(row => row.Session.IsEngaged);
                int converted = channelRows.Count(row => row.Session.Outcome == SessionClassifier.OutcomeConverted);

                List<SourceCampaignRowResponse> sourceBreakdown = channelRows
                    .GroupBy(row => (row.UtmSource, row.UtmCampaign))
                    .Select(sourceGroup =>
                    {
                        List<AcquisitionRow> sourceRows = sourceGroup.ToList();
                        int sourceSessions = sourceRows.Count;
                        int sourceBounced = sourceRows.Count(row => row.Session.IsBounce);
                        int sourceEngaged = sourceRows.Count(row => row.Session.IsEngaged);
                        int sourceConverted = sourceRows.Count(row => row.Session.Outcome == SessionClassifier.OutcomeConverted);

                        return new SourceCampaignRowResponse(
                            sourceGroup.Key.UtmSource,
                            sourceGroup.Key.UtmCampaign,
                            sourceSessions,
                            Percent(sourceBounced, sourceSessions),
                            Percent(sourceEngaged, sourceSessions),
                            sourceConverted,
                            Percent(sourceConverted, sourceSessions));
                    })
                    .OrderByDescending(row => row.Sessions)
                    .ThenBy(row => row.UtmSource, StringComparer.Ordinal)
                    .ThenBy(row => row.UtmCampaign, StringComparer.Ordinal)
                    .ToList();

                return new ChannelRowResponse(
                    group.Key,
                    sessions,
                    Percent(bounced, sessions),
                    Percent(engaged, sessions),
                    converted,
                    Percent(converted, sessions),
                    sourceBreakdown);
            })
            .OrderByDescending(row => row.Sessions)
            .ThenBy(row => row.Channel, StringComparer.Ordinal)
            .ToList();
    }

    private static string? NormalizeFilter(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static double Percent(int part, int total)
    {
        return total == 0 ? 0 : Math.Round(part * 100.0 / total, 1);
    }

    private sealed record AcquisitionRow(
        SessionClassifier.ClassifiedSession Session,
        string Channel,
        string DeviceClass,
        string? Country,
        string? UtmSource,
        string? UtmCampaign);
}
