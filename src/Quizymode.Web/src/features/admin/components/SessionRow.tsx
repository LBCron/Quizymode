import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminApi,
  type PageViewSessionResponse,
  type SessionActivity,
} from "@/api/admin";
import { toSafeRelativeHref } from "./sessionFilter";
import {
  OUTCOME_BADGE_CLASSES,
  OUTCOME_LABELS,
  describeClient,
  formatArea,
  formatDuration,
  shortenUserAgent,
} from "./sessionFormatting";

interface SessionRowProps {
  session: PageViewSessionResponse;
  formatDateTime: (value: string) => string;
  /** When set, the expanded view offers "Filter to this session". */
  onFilterToSession?: (sessionId: string) => void;
  /** When set, a known visitor with other sessions offers "N sessions from this visitor". */
  onFilterToVisitor?: (visitorId: string) => void;
}

const ACTIVITY_LABELS: Record<SessionActivity["kind"], string> = {
  game: "Game",
  quiz: "Quiz",
  flashcards: "Flashcards",
};

const VISITOR_TYPE_LABELS = {
  new: "New visitor",
  returning: "Returning visitor",
  unknown: "Visitor unavailable",
} as const;

function formatActivityContext(activity: SessionActivity): string {
  if (!activity.contextType && !activity.contextId) {
    return "";
  }
  return [activity.contextType, activity.contextId].filter(Boolean).join(": ");
}

const SessionRow = ({
  session,
  formatDateTime,
  onFilterToSession,
  onFilterToVisitor,
}: SessionRowProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(session.sessionId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const gamesPlayed = session.gamesPlayed ?? 0;
  const quizRuns = session.quizRuns ?? 0;
  const visitorType = session.visitorType ?? "unknown";

  // The journey is only fetched once a row is actually opened, so the list
  // endpoint stays light no matter how many sessions are on screen.
  const {
    data: detail,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin", "page-view-session-detail", session.sessionId],
    // An internal row is only listed when internal traffic was requested, so the
    // detail lookup must opt in too or the API hides it.
    queryFn: () =>
      adminApi.getPageViewSessionDetail(session.sessionId, session.isInternal),
    enabled: isExpanded,
  });

  return (
    <>
      <tr className="align-top hover:bg-slate-50">
        <td className="px-5 py-4 text-sm text-slate-700">
          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            className="flex items-center gap-2 text-left font-medium text-indigo-ink hover:text-indigo-ink"
          >
            <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
            {formatDateTime(session.startedUtc)}
          </button>
        </td>
        <td className="px-5 py-4 text-sm">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
              OUTCOME_BADGE_CLASSES[session.outcome]
            }`}
          >
            {OUTCOME_LABELS[session.outcome]}
          </span>
          {session.isInternal && (
            <span className="ml-1.5 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              Internal
            </span>
          )}
          {session.userEmail && (
            <div className="mt-2 text-xs text-slate-500">{session.userEmail}</div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            {VISITOR_TYPE_LABELS[visitorType]}
            {session.channel ? ` · ${session.channel}` : ""}
          </div>
          {(gamesPlayed > 0 || quizRuns > 0) && (
            <div className="mt-1 text-xs text-slate-500">
              {gamesPlayed > 0 &&
                `${gamesPlayed} game${gamesPlayed === 1 ? "" : "s"} (${session.gamesCompleted ?? 0} completed)`}
              {gamesPlayed > 0 && quizRuns > 0 && " · "}
              {quizRuns > 0 &&
                `${quizRuns} quiz run${quizRuns === 1 ? "" : "s"} (${session.quizzesCompleted ?? 0} completed)`}
            </div>
          )}
        </td>
        <td className="px-5 py-4 text-sm text-slate-900">
          <div className="max-w-xs break-all font-medium">{session.entryPath}</div>
          {!session.isBounce && (
            <div className="mt-1 max-w-xs break-all text-xs text-slate-500">
              → {session.exitPath}
            </div>
          )}
        </td>
        <td className="px-5 py-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">{session.pageHits}</div>
          <div className="mt-1 text-xs text-slate-500">
            {session.isBounce
              ? "bounced"
              : `${session.distinctPages} distinct`}
          </div>
        </td>
        <td className="px-5 py-4 text-sm text-slate-700">
          {formatDuration(session.durationSeconds)}
        </td>
        <td className="px-5 py-4 text-sm text-slate-700">
          <div className="font-mono text-xs text-slate-800">
            {session.ipAddress}
          </div>
          {(session.city || session.region || session.country) && (
            <div className="mt-1 text-xs font-medium text-indigo-ink">
              {[session.city, session.region, session.country].filter(Boolean).join(", ")}
              <span className="ml-1 font-normal text-slate-400">(approximate)</span>
            </div>
          )}
          <div
            className="mt-2 text-xs text-slate-500"
            title={session.userAgent ?? undefined}
          >
            {describeClient(session.userAgent, session.isBot)}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-5 py-4">
            {isLoading && (
              <div className="text-sm text-slate-500">Loading journey…</div>
            )}

            {error && (
              <div className="text-sm text-rose-600">
                Failed to load this session's journey.
              </div>
            )}

            {detail && (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span className="font-mono">{detail.sessionId}</span>
                  <button
                    type="button"
                    onClick={copySessionId}
                    className="font-medium text-indigo-ink hover:text-indigo-ink"
                  >
                    {copied ? "Copied" : "Copy session id"}
                  </button>
                  {onFilterToSession && (
                    <button
                      type="button"
                      onClick={() => onFilterToSession(session.sessionId)}
                      className="font-medium text-indigo-ink hover:text-indigo-ink"
                    >
                      Filter to this session
                    </button>
                  )}
                  {detail.visitorId ? (
                    onFilterToVisitor && (detail.sessionsFromVisitor ?? 0) > 1 ? (
                      <button
                        type="button"
                        onClick={() => onFilterToVisitor(detail.visitorId as string)}
                        className="font-medium text-indigo-ink hover:text-indigo-ink"
                      >
                        {detail.sessionsFromVisitor} sessions from this visitor
                      </button>
                    ) : (
                      <span>{detail.sessionsFromVisitor ?? 0} session from this visitor</span>
                    )
                  ) : (
                    <span className="italic text-slate-400">Visitor history unavailable</span>
                  )}
                  {detail.userAgent && (
                    <span className="break-all">
                      {shortenUserAgent(detail.userAgent)}
                    </span>
                  )}
                </div>

                <p className="mb-2 text-xs text-slate-500">
                  Links open in a new tab. Use &quot;Mark this browser internal&quot; first so
                  your own checks stay out of the reports.
                </p>

                <ol className="space-y-2">
                  {detail.steps.map((step) => (
                    <li
                      key={step.stepNumber}
                      className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel text-xs font-semibold text-on-panel">
                          {step.stepNumber}
                        </span>
                        <div className="min-w-0">
                          <div className="break-all text-sm font-medium text-slate-900">
                            <span className="mr-2 inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-ink">
                              {formatArea(step.area)}
                            </span>
                            {(() => {
                              const href = toSafeRelativeHref(step.path, step.queryString);
                              return href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-ink underline hover:text-indigo-ink"
                                >
                                  {step.url}
                                </a>
                              ) : (
                                step.url
                              );
                            })()}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {formatDateTime(step.createdUtc)}
                            {step.isAuthenticated && (
                              <span className="ml-2 font-medium text-emerald-700">
                                signed in
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-xs text-slate-600 sm:text-right">
                        {step.dwellSeconds === null ? (
                          // No exit event is recorded, so the final step's dwell
                          // time is genuinely unknown rather than zero.
                          <span className="italic text-slate-400">
                            last page — dwell unknown
                          </span>
                        ) : (
                          <>stayed {formatDuration(step.dwellSeconds)}</>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-slate-900">Activities</h4>
                  {(detail.activities ?? []).length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      No games, quizzes or flashcards in this session.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {(detail.activities ?? []).map((activity) => (
                        <li
                          key={activity.runId}
                          className="rounded-xl border border-slate-200 bg-surface px-4 py-2 text-xs text-slate-700"
                        >
                          <span className="font-semibold text-slate-900">
                            {ACTIVITY_LABELS[activity.kind]}
                          </span>
                          {formatActivityContext(activity) && (
                            <span className="ml-2">{formatActivityContext(activity)}</span>
                          )}
                          <span className="ml-2 text-slate-500">
                            started {formatDateTime(activity.startedUtc)}
                          </span>
                          <span className="ml-2">
                            {activity.completedUtc
                              ? activity.score !== null && activity.total !== null
                                ? `completed, score ${activity.score}/${activity.total}`
                                : "completed"
                              : "not completed"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

export default SessionRow;
