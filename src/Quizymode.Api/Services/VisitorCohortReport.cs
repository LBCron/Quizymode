using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Services;

/// <summary>
/// Returning-visitor metrics (ANALYTICS-003) built from <see cref="AnalyticsSession"/> rows, shared by
/// the Sessions and Acquisition admin reports so they can never disagree for the same window and
/// exclusions.
/// </summary>
public static class VisitorCohortReport
{
    /// <param name="NewVisitorSessions">Window sessions with a visitor id whose visitor had no earlier session.</param>
    /// <param name="ReturningVisitorSessions">Window sessions whose visitor had an earlier session (possibly before the window).</param>
    /// <param name="UnidentifiedSessions">Window sessions with no visitor id (Global Privacy Control, storage unavailable, or history); counted as neither.</param>
    /// <param name="NewVisitors">Distinct visitors whose first-ever session is in the window.</param>
    /// <param name="ReturningVisitors">Distinct visitors with a window session whose first-ever session predates the window.</param>
    /// <param name="ReturnWithin7Days">First-time visitors in the window, grouped by their first session's channel and campaign.</param>
    /// <param name="SignupsWithVisitorHistory">Accounts created in the window that are linked to a visitor id.</param>
    /// <param name="AvgPreSignupSessions">Average sessions before the signup session; null when no signups qualify.</param>
    /// <param name="MedianPreSignupSessions">Median sessions before the signup session; null when no signups qualify.</param>
    /// <param name="AvgDaysToSignup">Average UTC calendar days from first visit to account creation; null when no signups qualify.</param>
    /// <param name="MedianDaysToSignup">Median UTC calendar days from first visit to account creation; null when no signups qualify.</param>
    public sealed record Response(
        int NewVisitorSessions,
        int ReturningVisitorSessions,
        int UnidentifiedSessions,
        int NewVisitors,
        int ReturningVisitors,
        List<ReturnRateRow> ReturnWithin7Days,
        int SignupsWithVisitorHistory,
        double? AvgPreSignupSessions,
        double? MedianPreSignupSessions,
        double? AvgDaysToSignup,
        double? MedianDaysToSignup);

    /// <param name="FirstTimeVisitors">Visitors whose first-ever session is in the window with this channel and campaign.</param>
    /// <param name="Channel">Channel of the visitor's first session.</param>
    /// <param name="UtmCampaign">Campaign of the visitor's first session, when tagged.</param>
    /// <param name="ReturnedWithin7Days">Those with another session that started within 7 days after the first one.</param>
    /// <param name="ReturnRatePercent">ReturnedWithin7Days as a percentage of FirstTimeVisitors.</param>
    public sealed record ReturnRateRow(
        string Channel,
        string? UtmCampaign,
        int FirstTimeVisitors,
        int ReturnedWithin7Days,
        double ReturnRatePercent);

    internal sealed record CohortRow(string SessionId, string? VisitorId, DateTime FirstSeenUtc, Guid? UserId, string Channel, string? UtmCampaign);

    public static async Task<Response> BuildAsync(
        ApplicationDbContext db,
        DateTime windowStartUtc,
        DateTime windowEndUtc,
        bool includeBots,
        bool includeInternal,
        CancellationToken cancellationToken)
    {
        List<CohortRow> allRows = await LoadRowsAsync(db, includeBots, includeInternal, cancellationToken);
        return await BuildAsync(db, allRows, windowStartUtc, windowEndUtc, cancellationToken);
    }

    /// <summary>
    /// Loads every session row (all time, scoped by exclusions only) so several windows can be built from one load.
    /// </summary>
    internal static async Task<List<CohortRow>> LoadRowsAsync(
        ApplicationDbContext db,
        bool includeBots,
        bool includeInternal,
        CancellationToken cancellationToken)
    {
        IQueryable<AnalyticsSession> scopeQuery = db.AnalyticsSessions.AsNoTracking();

        if (!includeBots)
        {
            scopeQuery = scopeQuery.Where(session =>
                !db.PageViews.Any(pageView => pageView.SessionId == session.SessionId && pageView.IsBot));
        }

        if (!includeInternal)
        {
            // Includes visitor-id propagation: one internal session makes all of that visitor's sessions internal.
            IQueryable<string> internalSessionIds = InternalTrafficFilter.AllInternalSessionIds(db);
            // Non-null predicate: see InternalTrafficFilter.ExcludeInternalSessions.
            scopeQuery = scopeQuery.Where(session => !internalSessionIds.Any(sessionId => sessionId == session.SessionId && session.SessionId != null));
        }

        // Scoped by exclusions only, not by the window: new/returning and the 7-day cohort need a
        // visitor's full history, which can predate the window.
        return await scopeQuery
            .Select(session => new CohortRow(
                session.SessionId,
                session.VisitorId,
                session.FirstSeenUtc,
                session.UserId,
                session.Channel,
                session.UtmCampaign))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Builds one window from already-loaded rows. The only database access is the per-window Users signup query.
    /// </summary>
    internal static async Task<Response> BuildAsync(
        ApplicationDbContext db,
        List<CohortRow> allRows,
        DateTime windowStartUtc,
        DateTime windowEndUtc,
        CancellationToken cancellationToken)
    {
        bool InWindow(DateTime time) => time >= windowStartUtc && time <= windowEndUtc;

        List<CohortRow> windowRows = allRows.Where(row => InWindow(row.FirstSeenUtc)).ToList();

        Dictionary<string, List<CohortRow>> sessionsByVisitor = allRows
            .Where(row => row.VisitorId is not null)
            .GroupBy(row => row.VisitorId!, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.OrderBy(row => row.FirstSeenUtc).ThenBy(row => row.SessionId, StringComparer.Ordinal).ToList(),
                StringComparer.Ordinal);

        // --- New vs returning ---
        int unidentifiedSessions = windowRows.Count(row => row.VisitorId is null);
        int newVisitorSessions = 0;
        int returningVisitorSessions = 0;
        foreach (CohortRow row in windowRows.Where(row => row.VisitorId is not null))
        {
            CohortRow first = sessionsByVisitor[row.VisitorId!][0];
            if (first.SessionId == row.SessionId)
            {
                newVisitorSessions++;
            }
            else
            {
                returningVisitorSessions++;
            }
        }

        HashSet<string> windowVisitors = windowRows
            .Where(row => row.VisitorId is not null)
            .Select(row => row.VisitorId!)
            .ToHashSet(StringComparer.Ordinal);
        int newVisitors = windowVisitors.Count(visitorId => InWindow(sessionsByVisitor[visitorId][0].FirstSeenUtc));
        int returningVisitors = windowVisitors.Count - newVisitors;

        // --- 7-day return rate by first session's channel and campaign ---
        List<ReturnRateRow> returnWithin7Days = sessionsByVisitor.Values
            .Where(sessions => InWindow(sessions[0].FirstSeenUtc))
            .GroupBy(sessions => (sessions[0].Channel, sessions[0].UtmCampaign))
            .Select(group =>
            {
                int cohortSize = group.Count();
                int returned = group.Count(sessions =>
                {
                    DateTime firstSeen = sessions[0].FirstSeenUtc;
                    return sessions.Skip(1).Any(row => row.FirstSeenUtc > firstSeen && row.FirstSeenUtc <= firstSeen.AddDays(7));
                });

                return new ReturnRateRow(group.Key.Channel, group.Key.UtmCampaign, cohortSize, returned, Percent(returned, cohortSize));
            })
            .OrderByDescending(row => row.FirstTimeVisitors)
            .ThenBy(row => row.Channel, StringComparer.Ordinal)
            .ThenBy(row => row.UtmCampaign, StringComparer.Ordinal)
            .ToList();

        // --- Sessions and days from first visit to signup ---
        // Signup is the account's creation time. Pre-signup sessions are that visitor's sessions that
        // started before signup and never linked to the account (the signup session itself links).
        Dictionary<Guid, List<string>> visitorsByUser = allRows
            .Where(row => row.UserId is not null && row.VisitorId is not null)
            .GroupBy(row => row.UserId!.Value)
            .ToDictionary(group => group.Key, group => group.Select(row => row.VisitorId!).Distinct(StringComparer.Ordinal).ToList());

        List<Guid> linkedUserIds = visitorsByUser.Keys.ToList();
        List<(Guid Id, DateTime CreatedAt)> signups = (await db.Users
                .AsNoTracking()
                .Where(user => linkedUserIds.Contains(user.Id) && user.CreatedAt >= windowStartUtc && user.CreatedAt <= windowEndUtc)
                .Select(user => new { user.Id, user.CreatedAt })
                .ToListAsync(cancellationToken))
            .Select(user => (user.Id, user.CreatedAt))
            .ToList();

        List<int> preSignupSessionSamples = [];
        List<int> daysToSignupSamples = [];
        foreach ((Guid userId, DateTime createdAt) in signups)
        {
            List<CohortRow> visitorSessions = visitorsByUser[userId]
                .SelectMany(visitorId => sessionsByVisitor[visitorId])
                .Where(row => row.FirstSeenUtc <= createdAt)
                .ToList();

            if (visitorSessions.Count == 0)
            {
                continue;
            }

            DateTime firstVisit = visitorSessions.Min(row => row.FirstSeenUtc);
            preSignupSessionSamples.Add(visitorSessions.Count(row => row.UserId is null));
            daysToSignupSamples.Add((createdAt.Date - firstVisit.Date).Days);
        }

        return new Response(
            newVisitorSessions,
            returningVisitorSessions,
            unidentifiedSessions,
            newVisitors,
            returningVisitors,
            returnWithin7Days,
            preSignupSessionSamples.Count,
            Average(preSignupSessionSamples),
            Median(preSignupSessionSamples),
            Average(daysToSignupSamples),
            Median(daysToSignupSamples));
    }

    private static double Percent(int part, int total)
    {
        return total == 0 ? 0 : Math.Round(part * 100.0 / total, 1);
    }

    private static double? Average(List<int> values)
    {
        return values.Count == 0 ? null : Math.Round(values.Average(), 1);
    }

    private static double? Median(List<int> values)
    {
        if (values.Count == 0)
        {
            return null;
        }

        List<int> sorted = values.OrderBy(value => value).ToList();
        int middle = sorted.Count / 2;
        return sorted.Count % 2 == 1
            ? sorted[middle]
            : Math.Round((sorted[middle - 1] + sorted[middle]) / 2.0, 1);
    }
}
