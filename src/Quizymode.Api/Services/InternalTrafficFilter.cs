using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Services;

/// <summary>
/// Session-level exclusion of internal traffic (admins, users flagged internal, and browsers
/// carrying the internal marker) for every admin analytics report.
/// </summary>
/// <remarks>
/// A session is internal when <em>any</em> of its hits is internal, so an anonymous visit that
/// later signs in as an internal user is excluded in full. The user flag is joined at query time
/// rather than copied onto hits, which makes flagging a user retroactive without rewriting rows.
/// Internal status also propagates between sessions that share the same non-null
/// <see cref="AnalyticsSession.VisitorId"/> (TRAFFIC-122): if one of a visitor's sessions is internal
/// by its own evidence, every other session sharing that visitor id is treated as internal too. Two
/// sessions with a null <c>VisitorId</c> never match each other this way.
/// </remarks>
internal static class InternalTrafficFilter
{
    /// <summary>
    /// Session ids, among the sessions present in <paramref name="scope"/>, that are internal either
    /// by their own evidence (anywhere in the table, not only inside the scope's time window) or by
    /// sharing a non-null visitor id with another session that is internal by its own evidence.
    /// </summary>
    public static IQueryable<string> InternalSessionIds(ApplicationDbContext db, IQueryable<PageView> scope)
    {
        IQueryable<string> scopeSessionIds = scope.Select(pageView => pageView.SessionId);
        IQueryable<string> internalSessionIds = AllInternalSessionIds(db);

        return internalSessionIds.Where(sessionId => scopeSessionIds.Contains(sessionId)).Distinct();
    }

    /// <summary>Every session id, anywhere in the table, that is internal by own evidence or sibling propagation.</summary>
    public static IQueryable<string> AllInternalSessionIds(ApplicationDbContext db)
    {
        IQueryable<string> ownEvidenceSessionIds = OwnEvidenceInternalSessionIds(db);

        // Semi-join through the internal visitor ids instead of a self-join on VisitorId.
        IQueryable<string> internalVisitorIds = db.AnalyticsSessions
            .Where(session => session.VisitorId != null && ownEvidenceSessionIds.Contains(session.SessionId))
            .Select(session => session.VisitorId!);

        IQueryable<string> siblingSessionIds = db.AnalyticsSessions
            .Where(session => session.VisitorId != null && internalVisitorIds.Any(visitorId => visitorId == session.VisitorId))
            .Select(session => session.SessionId);

        return ownEvidenceSessionIds.Concat(siblingSessionIds).Distinct();
    }

    /// <summary>
    /// Session ids, among the sessions with events in <paramref name="eventScope"/>, that are internal: any of
    /// their events was internal at write time, their page-view session (same client session id) is
    /// internal, or any of their events belongs to a user flagged internal now (so flagging is retroactive).
    /// </summary>
    public static IQueryable<string> InternalEventSessionIds(ApplicationDbContext db, IQueryable<AnalyticsEvent> eventScope)
    {
        IQueryable<string> scopeSessionIds = eventScope.Select(analyticsEvent => analyticsEvent.SessionId);

        return InternalSessionIds(db, db.PageViews.Where(pageView => scopeSessionIds.Contains(pageView.SessionId)))
            .Union(eventScope
                .Where(analyticsEvent =>
                    analyticsEvent.IsInternal ||
                    (analyticsEvent.UserId != null &&
                        db.Users.Any(user => user.Id == analyticsEvent.UserId && user.IsInternal)))
                .Select(analyticsEvent => analyticsEvent.SessionId));
    }

    /// <summary>
    /// Session ids, among the sessions with front-end errors in <paramref name="errorScope"/>, that are internal:
    /// any of their error reports was internal at write time, their page-view session is internal, or a report
    /// belongs to a user flagged internal now (so flagging is retroactive).
    /// </summary>
    public static IQueryable<string> InternalClientErrorSessionIds(ApplicationDbContext db, IQueryable<ClientError> errorScope)
    {
        IQueryable<string> scopeSessionIds = errorScope.Select(clientError => clientError.SessionId);

        return InternalSessionIds(db, db.PageViews.Where(pageView => scopeSessionIds.Contains(pageView.SessionId)))
            .Union(errorScope
                .Where(clientError =>
                    clientError.IsInternal ||
                    (clientError.UserId != null &&
                        db.Users.Any(user => user.Id == clientError.UserId && user.IsInternal)))
                .Select(clientError => clientError.SessionId));
    }

    /// <summary>Removes every hit that belongs to an internal session.</summary>
    public static IQueryable<PageView> ExcludeInternalSessions(ApplicationDbContext db, IQueryable<PageView> query)
    {
        IQueryable<string> internalSessionIds = InternalSessionIds(db, query);

        // The extra non-null predicate (SessionId is required) stops EF from rewriting Any(x == y) back into NOT IN.
        return query.Where(pageView => !internalSessionIds.Any(sessionId => sessionId == pageView.SessionId && pageView.SessionId != null));
    }

    /// <summary>Sessions internal by their own hits: an internal hit, or a hit tied to a user currently flagged internal.</summary>
    private static IQueryable<string> OwnEvidenceInternalSessionIds(ApplicationDbContext db)
    {
        return db.PageViews
            .Where(pageView =>
                pageView.IsInternal ||
                (pageView.UserId != null && db.Users.Any(user => user.Id == pageView.UserId && user.IsInternal)))
            .Select(pageView => pageView.SessionId)
            .Distinct();
    }
}
