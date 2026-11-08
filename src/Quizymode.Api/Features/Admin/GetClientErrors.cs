using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Groups front-end error reports by fingerprint for the admin Client errors page (OBS-001).
/// Bot and internal traffic is excluded by default.
/// </summary>
public static partial class GetClientErrors
{
    /// <summary>Most recent reports aggregated per request; older ones in the window are reported as truncated.</summary>
    public const int MaxRows = 10_000;

    public const int MaxGroups = 100;

    private const int TopValues = 5;

    public sealed record QueryRequest(
        int Days = 7,
        string? AppVersion = null,
        bool IncludeBots = false,
        bool IncludeInternal = false);

    /// <param name="NewGroups">Groups whose first report ever (within retention) falls inside the window.</param>
    /// <param name="Truncated">True when the window held more than <see cref="MaxRows"/> reports and only the latest were aggregated.</param>
    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int TotalReports,
        int TotalGroups,
        int NewGroups,
        int BotReports,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        bool Truncated,
        List<string> AppVersions,
        List<GroupResponse> Groups);

    public sealed record ValueCount(string Value, int Count);

    public sealed record GroupResponse(
        string Fingerprint,
        string ErrorName,
        string Message,
        string Source,
        int Count,
        int Sessions,
        DateTime FirstSeenUtc,
        DateTime LastSeenUtc,
        bool IsNew,
        string? LatestAppVersion,
        List<ValueCount> TopPaths,
        List<ValueCount> Browsers,
        List<ValueCount> Devices,
        string? SampleStack,
        string? SampleComponentStack,
        string SampleSessionId);

    /// <summary>The fields of one report that the aggregation needs.</summary>
    public sealed record Row(
        string Fingerprint,
        string Source,
        string ErrorName,
        string Message,
        string? Stack,
        string? ComponentStack,
        string Path,
        string? AppVersion,
        string SessionId,
        string? UserAgent,
        string DeviceClass,
        DateTime OccurredUtc);

    [GeneratedRegex("^[0-9A-Za-z.+-]+$")]
    private static partial Regex VersionPattern();

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/client-errors", Handler)
                .WithTags("Admin")
                .WithSummary("Get front-end errors grouped by fingerprint (Admin only)")
                .WithDescription("Groups SPA error reports in the selected window by fingerprint with count, affected sessions, first and last seen, latest app version, top paths, browser and device mix, and a sample stack. Optional appVersion filter. Bot reports are excluded unless includeBots=true, and internal sessions unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 7,
            string? appVersion = null,
            bool includeBots = false,
            bool includeInternal = false,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            Result<Response> result = await HandleAsync(
                new QueryRequest(days, appVersion, includeBots, includeInternal), db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > 365)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.ClientErrors.InvalidDays", "Days must be between 1 and 365."));
        }

        string? appVersion = string.IsNullOrWhiteSpace(request.AppVersion) ? null : request.AppVersion.Trim();
        if (appVersion is not null && (appVersion.Length > 32 || !VersionPattern().IsMatch(appVersion)))
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.ClientErrors.InvalidAppVersion", "AppVersion may contain only letters, digits, and . + - (32 characters or fewer)."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<ClientError> windowQuery = db.ClientErrors
            .AsNoTracking()
            .Where(clientError => clientError.OccurredUtc >= windowStartUtc && clientError.OccurredUtc <= windowEndUtc);

        List<string> appVersions = await windowQuery
            .Where(clientError => clientError.AppVersion != null)
            .Select(clientError => clientError.AppVersion!)
            .Distinct()
            .ToListAsync(cancellationToken);
        appVersions = appVersions.OrderByDescending(version => version, StringComparer.Ordinal).ToList();

        if (appVersion is not null)
        {
            windowQuery = windowQuery.Where(clientError => clientError.AppVersion == appVersion);
        }

        int botReports = await windowQuery.CountAsync(clientError => clientError.IsBot, cancellationToken);

        IQueryable<string> internalSessionIds = InternalTrafficFilter.InternalClientErrorSessionIds(db, windowQuery);
        int internalSessions = await internalSessionIds.CountAsync(cancellationToken);

        IQueryable<ClientError> query = request.IncludeBots
            ? windowQuery
            : windowQuery.Where(clientError => !clientError.IsBot);

        if (!request.IncludeInternal)
        {
            query = query.Where(clientError => !internalSessionIds.Contains(clientError.SessionId));
        }

        List<Row> rows = await query
            .OrderByDescending(clientError => clientError.OccurredUtc)
            .Take(MaxRows + 1)
            .Select(clientError => new Row(
                clientError.Fingerprint,
                clientError.Source,
                clientError.ErrorName,
                clientError.Message,
                clientError.Stack,
                clientError.ComponentStack,
                clientError.Path,
                clientError.AppVersion,
                clientError.SessionId,
                clientError.UserAgent,
                clientError.DeviceClass,
                clientError.OccurredUtc))
            .ToListAsync(cancellationToken);

        bool truncated = rows.Count > MaxRows;
        if (truncated)
        {
            rows = rows.Take(MaxRows).ToList();
        }

        List<string> fingerprints = rows.Select(row => row.Fingerprint).Distinct(StringComparer.Ordinal).ToList();
        Dictionary<string, DateTime> firstSeenEver = fingerprints.Count == 0
            ? new Dictionary<string, DateTime>(StringComparer.Ordinal)
            : (await db.ClientErrors
                .AsNoTracking()
                .Where(clientError => fingerprints.Contains(clientError.Fingerprint))
                .GroupBy(clientError => clientError.Fingerprint)
                .Select(group => new { Fingerprint = group.Key, FirstSeenUtc = group.Min(clientError => clientError.OccurredUtc) })
                .ToListAsync(cancellationToken))
                .ToDictionary(item => item.Fingerprint, item => item.FirstSeenUtc, StringComparer.Ordinal);

        List<GroupResponse> groups = Aggregate(rows, firstSeenEver, windowStartUtc);

        return Result.Success(new Response(
            windowStartUtc,
            windowEndUtc,
            TotalReports: rows.Count,
            TotalGroups: groups.Count,
            NewGroups: groups.Count(group => group.IsNew),
            botReports,
            BotsExcluded: !request.IncludeBots,
            internalSessions,
            InternalExcluded: !request.IncludeInternal,
            truncated,
            appVersions,
            groups.Take(MaxGroups).ToList()));
    }

    /// <summary>Human, non-internal front-end error totals for one window.</summary>
    internal sealed record WindowCounts(int Reports, int Sessions, int SignedInUsers, int NewGroups);

    /// <summary>
    /// Counts for the half-open window <c>[startUtc, endExclusiveUtc)</c> with bots and internal sessions excluded,
    /// for the daily digest (#509). A group is new when no report with its fingerprint exists before the window start.
    /// </summary>
    internal static async Task<WindowCounts> CountForWindowAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        IQueryable<ClientError> windowQuery = db.ClientErrors
            .AsNoTracking()
            .Where(clientError => clientError.OccurredUtc >= startUtc && clientError.OccurredUtc < endExclusiveUtc);
        IQueryable<string> internalSessionIds = InternalTrafficFilter.InternalClientErrorSessionIds(db, windowQuery);

        var rows = await windowQuery
            .Where(clientError => !clientError.IsBot && !internalSessionIds.Contains(clientError.SessionId))
            .OrderByDescending(clientError => clientError.OccurredUtc)
            .Take(MaxRows)
            .Select(clientError => new { clientError.Fingerprint, clientError.SessionId, clientError.UserId })
            .ToListAsync(cancellationToken);

        List<string> fingerprints = rows.Select(row => row.Fingerprint).Distinct(StringComparer.Ordinal).ToList();
        int knownBefore = fingerprints.Count == 0
            ? 0
            : await db.ClientErrors
                .AsNoTracking()
                .Where(clientError => fingerprints.Contains(clientError.Fingerprint) && clientError.OccurredUtc < startUtc)
                .Select(clientError => clientError.Fingerprint)
                .Distinct()
                .CountAsync(cancellationToken);

        return new WindowCounts(
            rows.Count,
            rows.Select(row => row.SessionId).Distinct(StringComparer.Ordinal).Count(),
            rows.Where(row => row.UserId.HasValue).Select(row => row.UserId!.Value).Distinct().Count(),
            fingerprints.Count - knownBefore);
    }

    /// <summary>
    /// Groups reports by fingerprint, most frequent first (ties: most recent first). First seen is the
    /// earliest report ever for the fingerprint when known, otherwise the earliest in <paramref name="rows"/>.
    /// The sample (stack, component stack, session) is the most recent report of the group.
    /// </summary>
    internal static List<GroupResponse> Aggregate(
        IReadOnlyCollection<Row> rows,
        IReadOnlyDictionary<string, DateTime> firstSeenEver,
        DateTime windowStartUtc)
    {
        return rows
            .GroupBy(row => row.Fingerprint, StringComparer.Ordinal)
            .Select(group =>
            {
                List<Row> ordered = group.OrderByDescending(row => row.OccurredUtc).ToList();
                Row latest = ordered[0];
                DateTime firstInRows = ordered[^1].OccurredUtc;
                DateTime firstSeen = firstSeenEver.TryGetValue(group.Key, out DateTime known) && known < firstInRows
                    ? known
                    : firstInRows;

                return new GroupResponse(
                    group.Key,
                    latest.ErrorName,
                    latest.Message,
                    latest.Source,
                    Count: ordered.Count,
                    Sessions: ordered.Select(row => row.SessionId).Distinct(StringComparer.Ordinal).Count(),
                    FirstSeenUtc: firstSeen,
                    LastSeenUtc: latest.OccurredUtc,
                    IsNew: firstSeen >= windowStartUtc,
                    LatestAppVersion: ordered.FirstOrDefault(row => row.AppVersion is not null)?.AppVersion,
                    TopPaths: Top(ordered.Select(row => row.Path)),
                    Browsers: Top(ordered.Select(row => UserAgentClassifier.BrowserFamily(row.UserAgent))),
                    Devices: Top(ordered.Select(row => row.DeviceClass)),
                    SampleStack: latest.Stack,
                    SampleComponentStack: latest.ComponentStack,
                    SampleSessionId: latest.SessionId);
            })
            .OrderByDescending(group => group.Count)
            .ThenByDescending(group => group.LastSeenUtc)
            .ToList();
    }

    private static List<ValueCount> Top(IEnumerable<string> values) =>
        values
            .GroupBy(value => value, StringComparer.Ordinal)
            .Select(group => new ValueCount(group.Key, group.Count()))
            .OrderByDescending(item => item.Count)
            .ThenBy(item => item.Value, StringComparer.Ordinal)
            .Take(TopValues)
            .ToList();
}
