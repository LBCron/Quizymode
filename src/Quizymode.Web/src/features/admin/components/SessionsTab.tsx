import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminApi,
  type SessionOutcomeFilter,
  type SessionSortBy,
} from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import DepthHistogram from "./DepthHistogram";
import LandingPagesTable from "./LandingPagesTable";
import SessionRow from "./SessionRow";
import VisitorCohortPanel from "./VisitorCohortPanel";
import { OUTCOME_LABELS, formatDuration } from "./sessionFormatting";
import { MAX_SESSION_ID_LENGTH, parseSessionIdParam } from "./sessionFilter";

const OUTCOME_OPTIONS: Array<{ label: string; value: SessionOutcomeFilter }> = [
  { label: "All sessions", value: "all" },
  { label: "Anonymous", value: "anonymous" },
  { label: "Converted", value: "converted" },
  { label: "Authenticated", value: "authenticated" },
];

const SORT_OPTIONS: Array<{ label: string; value: SessionSortBy }> = [
  { label: "Most recent", value: "recent" },
  { label: "Most pages", value: "pages" },
  { label: "Longest", value: "duration" },
];

const PAGE_SIZE = 25;
const LANDING_PAGES_LIMIT = 10;

interface SessionsTabProps {
  days: number;
  includeBots: boolean;
  includeInternal?: boolean;
  formatDateTime: (value: string) => string;
  /** Session id filter (from the URL); undefined means no filter. */
  sessionId?: string;
  /** Visitor id filter (from the URL); undefined means no filter. */
  visitorId?: string;
  onSessionIdChange?: (sessionId: string | undefined) => void;
  onVisitorIdChange?: (visitorId: string | undefined) => void;
}

const SessionsTab = ({
  days,
  includeBots,
  includeInternal = false,
  formatDateTime,
  sessionId,
  visitorId,
  onSessionIdChange,
  onVisitorIdChange,
}: SessionsTabProps) => {
  const [sessionInput, setSessionInput] = useState(sessionId ?? "");
  const [sessionInputError, setSessionInputError] = useState<string | null>(null);
  const [syncedSessionId, setSyncedSessionId] = useState(sessionId);
  // Keep the input in step with the URL (back/forward, chip removal, deep links).
  if (syncedSessionId !== sessionId) {
    setSyncedSessionId(sessionId);
    setSessionInput(sessionId ?? "");
    setSessionInputError(null);
  }

  const [outcome, setOutcome] = useState<SessionOutcomeFilter>("all");
  const [sortBy, setSortBy] = useState<SessionSortBy>("recent");
  const [engagedOnly, setEngagedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const minPages = engagedOnly ? 2 : undefined;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [
      "admin",
      "page-view-sessions",
      days,
      outcome,
      minPages,
      includeBots,
      sortBy,
      page,
      includeInternal,
      sessionId,
      visitorId,
    ],
    queryFn: () =>
      adminApi.getPageViewSessions(
        days,
        outcome,
        minPages,
        includeBots,
        sortBy,
        page,
        PAGE_SIZE,
        LANDING_PAGES_LIMIT,
        includeInternal,
        undefined,
        sessionId,
        visitorId
      ),
  });

  const applySessionFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = sessionInput.trim();
    if (trimmed === "") {
      setSessionInputError(null);
      onSessionIdChange?.(undefined);
      setPage(1);
      return;
    }
    const parsed = parseSessionIdParam(trimmed);
    if (!parsed) {
      setSessionInputError(`Session id must be 1-${MAX_SESSION_ID_LENGTH} characters.`);
      return;
    }
    setSessionInputError(null);
    onSessionIdChange?.(parsed);
    setPage(1);
  };

  const clearSessionFilter = () => {
    setSessionInput("");
    setSessionInputError(null);
    onSessionIdChange?.(undefined);
    setPage(1);
  };

  const filterToSession = (id: string) => {
    setSessionInput(id);
    setSessionInputError(null);
    onSessionIdChange?.(id);
    setPage(1);
  };

  const filterToVisitor = (id: string) => {
    onVisitorIdChange?.(id);
    setPage(1);
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <ErrorMessage
        message="Failed to load session analytics"
        onRetry={() => refetch()}
      />
    );
  }

  if (!data) {
    return null;
  }

  const { summary } = data;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Bounce rate"
          value={`${summary.bounceRatePercent}%`}
          detail={`${summary.bouncedSessions} of ${summary.totalSessions} sessions saw one page`}
          emphasis={summary.bounceRatePercent >= 70 ? "warn" : "neutral"}
        />
        <MetricCard
          label="Engaged sessions"
          value={summary.engagedSessions}
          detail="Visited 2+ distinct pages"
        />
        <MetricCard
          label="Avg pages / session"
          value={summary.avgPagesPerSession}
          detail={`${summary.totalPageHits} hits across ${summary.totalSessions} sessions`}
        />
        <MetricCard
          label="Median time on site"
          value={formatDuration(summary.medianDurationSecondsEngaged)}
          detail="Non-bounce sessions only"
        />
        <MetricCard
          label="Conversions"
          value={
            summary.byOutcome.find((stat) => stat.outcome === "converted")
              ?.sessions ?? 0
          }
          detail="Started anonymous, then signed in"
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          label="Sessions with study activity"
          value={summary.studySessions ?? 0}
          detail="Viewed at least one Quiz or Flashcards question"
        />
        <MetricCard
          label="Avg questions / study session"
          value={summary.avgItemStepsPerStudySession ?? 0}
          detail="Quiz and Flashcards item steps per study session"
        />
      </section>

      {summary.botsExcluded && summary.botSessions > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-medium">{summary.botSessions}</span> bot session
          {summary.botSessions === 1 ? " was" : "s were"} excluded from these
          numbers. Crawlers almost always view a single page, so leaving them in
          inflates the bounce rate. Toggle{" "}
          <span className="font-medium">Include bots</span> above to compare.
        </div>
      )}

      {summary.internalExcluded && summary.internalSessions > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-medium">{summary.internalSessions}</span> internal
          session{summary.internalSessions === 1 ? " was" : "s were"} excluded:
          admins, users flagged internal, and browsers marked as internal. Toggle{" "}
          <span className="font-medium">Include internal traffic</span> above to
          compare.
        </div>
      )}

      {data.visitors && (
        <VisitorCohortPanel visitors={data.visitors} showReturnTable={false} />
      )}

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            Engagement by Visitor Type
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Each session is classified by its first page hit, so the three groups
            do not overlap.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr>
                  <th className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Visitor
                  </th>
                  <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Sessions
                  </th>
                  <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Bounced
                  </th>
                  <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Engaged
                  </th>
                  <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Avg pages
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.byOutcome.map((stat) => (
                  <tr key={stat.outcome}>
                    <td className="py-3 pr-4 text-sm font-medium text-slate-900">
                      {OUTCOME_LABELS[stat.outcome]}
                    </td>
                    <td className="py-3 text-right text-sm text-slate-700">
                      {stat.sessions}
                    </td>
                    <td className="py-3 text-right text-sm text-slate-700">
                      {stat.bouncedSessions} ({stat.bounceRatePercent}%)
                    </td>
                    <td className="py-3 text-right text-sm text-slate-700">
                      {stat.engagedSessions}
                    </td>
                    <td className="py-3 text-right text-sm text-slate-700">
                      {stat.avgPagesPerSession}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Session Depth</h2>
          <p className="mt-1 text-sm text-gray-600">
            How many pages visitors saw before leaving.
          </p>
          <DepthHistogram
            buckets={data.depthBuckets}
            totalSessions={summary.totalSessions}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Landing Pages</h2>
        <p className="mt-1 text-sm text-gray-600">
          Where sessions started, grouped by feature area and content scope, and
          how often visitors left without going anywhere else.
        </p>
        <LandingPagesTable landingPages={data.landingPages} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Sessions</h2>
            <p className="mt-1 text-sm text-gray-600">
              Expand a row to replay that visitor's path through the app.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              aria-label="Visitor type"
              value={outcome}
              onChange={(event) => {
                setOutcome(event.target.value as SessionOutcomeFilter);
                setPage(1);
              }}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              {OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Sort sessions"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as SessionSortBy);
                setPage(1);
              }}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={engagedOnly}
                onChange={(event) => {
                  setEngagedOnly(event.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              Hide bounces
            </label>
          </div>
        </div>

        <div className="border-b border-slate-200 px-5 py-3">
          <form
            onSubmit={applySessionFilter}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              aria-label="Session id"
              placeholder="Filter by session id"
              value={sessionInput}
              maxLength={MAX_SESSION_ID_LENGTH + 1}
              onChange={(event) => setSessionInput(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 sm:max-w-md"
            />
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={clearSessionFilter}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
          </form>
          {sessionInputError && (
            <p role="alert" className="mt-1 text-xs text-rose-600">
              {sessionInputError}
            </p>
          )}
          {(sessionId || visitorId) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {sessionId && (
                <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800">
                  Session: <span className="font-mono">{sessionId}</span>
                  <button
                    type="button"
                    aria-label="Remove session filter"
                    onClick={clearSessionFilter}
                  >
                    ×
                  </button>
                </span>
              )}
              {visitorId && (
                <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800">
                  Visitor: <span className="font-mono">{visitorId}</span>
                  <button
                    type="button"
                    aria-label="Remove visitor filter"
                    onClick={() => {
                      onVisitorIdChange?.(undefined);
                      setPage(1);
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {isFetching && (
          <div className="px-5 pt-3 text-xs text-slate-500">Refreshing…</div>
        )}

        {data.sessions.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Started
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Visitor
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Entry → Exit
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Pages
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Duration
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      IP / Client
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {data.sessions.map((session) => (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      formatDateTime={formatDateTime}
                      onFilterToSession={onSessionIdChange ? filterToSession : undefined}
                      onFilterToVisitor={onVisitorIdChange ? filterToVisitor : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                Page {data.page} of {Math.max(data.totalPages, 1)} with{" "}
                {data.totalCount} matching sessions
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={data.page <= 1}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPage((current) =>
                      data.totalPages > 0
                        ? Math.min(data.totalPages, current + 1)
                        : 1
                    )
                  }
                  disabled={data.totalPages === 0 || data.page >= data.totalPages}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No sessions matched the current filters.
          </div>
        )}
      </section>
    </div>
  );
};

interface MetricCardProps {
  label: string;
  value: number | string;
  detail: string;
  emphasis?: "neutral" | "warn";
}

const MetricCard = ({
  label,
  value,
  detail,
  emphasis = "neutral",
}: MetricCardProps) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="text-sm font-medium text-slate-500">{label}</div>
    <div
      className={`mt-3 text-3xl font-semibold ${
        emphasis === "warn" ? "text-rose-600" : "text-slate-900"
      }`}
    >
      {value}
    </div>
    <div className="mt-2 text-sm text-slate-600">{detail}</div>
  </div>
);

export default SessionsTab;
