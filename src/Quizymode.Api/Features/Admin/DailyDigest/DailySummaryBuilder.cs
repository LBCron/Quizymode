using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>
/// Explicit-bounds session and visitor numbers shared by the admin Overview and the daily digest (#509), so the two
/// can never disagree for the same window. All windows are half-open: <c>start &lt;= time &lt; endExclusive</c>.
/// Bots and internal sessions are always excluded.
/// </summary>
internal static partial class DailySummaryBuilder
{
    /// <summary>Counts derived from the classified sessions of one window.</summary>
    internal sealed record SessionStats(
        int HumanSessions,
        int EngagedSessions,
        int StudySessions,
        int ConvertedSessions,
        int AnonymousSessions,
        int AuthenticatedSessions,
        int ActiveAccounts);

    /// <summary>Human, non-internal sessions with at least one hit in the window, classified once.</summary>
    internal static async Task<List<SessionClassifier.ClassifiedSession>> ClassifyWindowAsync(
        ApplicationDbContext db,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken)
    {
        IQueryable<PageView> scope = db.PageViews
            .AsNoTracking()
            .Where(pageView => pageView.CreatedUtc >= startUtc && pageView.CreatedUtc < endExclusiveUtc && !pageView.IsBot);
        scope = InternalTrafficFilter.ExcludeInternalSessions(db, scope);

        return await SessionClassifier.ClassifyAsync(scope, cancellationToken);
    }

    internal static SessionStats Summarize(List<SessionClassifier.ClassifiedSession> sessions)
    {
        return new SessionStats(
            sessions.Count,
            sessions.Count(session => session.IsEngaged),
            sessions.Count(session => session.HasStudyActivity),
            sessions.Count(session => session.Outcome == SessionClassifier.OutcomeConverted),
            sessions.Count(session => session.Outcome == SessionClassifier.OutcomeAnonymous),
            sessions.Count(session => session.Outcome == SessionClassifier.OutcomeAuthenticated),
            sessions.Where(session => session.UserId.HasValue).Select(session => session.UserId!.Value).Distinct().Count());
    }

    /// <summary>
    /// New and returning visitors for a half-open window from cohort rows loaded once for all windows.
    /// <see cref="VisitorCohortReport"/> uses an inclusive end, so the exclusive end is converted by one tick.
    /// </summary>
    internal static Task<VisitorCohortReport.Response> BuildVisitorsAsync(
        ApplicationDbContext db,
        List<VisitorCohortReport.CohortRow> cohortRows,
        DateTime startUtc,
        DateTime endExclusiveUtc,
        CancellationToken cancellationToken) =>
        VisitorCohortReport.BuildAsync(db, cohortRows, startUtc, endExclusiveUtc.AddTicks(-1), cancellationToken);
}
