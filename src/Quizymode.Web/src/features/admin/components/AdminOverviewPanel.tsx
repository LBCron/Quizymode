import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  adminApi,
  type AnalyticsOverviewDailyPoint,
  type AnalyticsOverviewKpis,
  type AnalyticsOverviewResponse,
} from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { formatAge, formatChange, layoutReleaseLabels, secondsSince } from "./overviewFormatting";

type OverviewDays = 7 | 30 | 90;
const RANGES: OverviewDays[] = [7, 30, 90];

const KPI_DEFS: Array<{ key: keyof AnalyticsOverviewKpis; label: string }> = [
  { key: "humanSessions", label: "Human sessions" },
  { key: "engagedSessions", label: "Engaged sessions" },
  { key: "studySessions", label: "Study sessions" },
  { key: "convertedSessions", label: "Converted sessions" },
  { key: "newSignups", label: "New signups" },
  { key: "activeRegisteredUsers", label: "Active registered users" },
  { key: "newVisitors", label: "New visitors" },
  { key: "returningVisitors", label: "Returning visitors" },
];

const CHART_WIDTH = 640;
const CHART_HEIGHT = 180;
const PAD_LEFT = 32;
const PAD_RIGHT = 8;
const PAD_TOP = 14;
const LABEL_ROW_HEIGHT = 10;
const PAD_BOTTOM = 22;

function buildPath(
  daily: AnalyticsOverviewDailyPoint[],
  pick: (point: AnalyticsOverviewDailyPoint) => number,
  max: number,
  padTop: number
): string {
  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = CHART_HEIGHT - padTop - PAD_BOTTOM;
  return daily
    .map((point, index) => {
      const x = PAD_LEFT + (daily.length === 1 ? 0 : (index / (daily.length - 1)) * plotWidth);
      const y = padTop + plotHeight - (max === 0 ? 0 : (pick(point) / max) * plotHeight);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Plain-SVG daily chart (no chart dependency) with release markers on the day a version first appeared. */
const DailyChart = ({ data }: { data: AnalyticsOverviewResponse }) => {
  const { daily, releaseMarkers } = data;
  const max = Math.max(...daily.map((point) => point.humanSessions), 1);
  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const dayIndex = new Map(daily.map((point, index) => [point.day, index]));
  const xForDay = (day: string): number | undefined => {
    const index = dayIndex.get(day);
    if (index === undefined) {
      return undefined;
    }
    return PAD_LEFT + (daily.length === 1 ? 0 : (index / (daily.length - 1)) * plotWidth);
  };
  const placedMarkers = releaseMarkers.flatMap((marker) => {
    const x = xForDay(marker.day);
    return x === undefined ? [] : [{ ...marker, x }];
  });
  const labels = layoutReleaseLabels(placedMarkers, CHART_WIDTH - PAD_RIGHT);
  const rows = labels.reduce((most, label) => Math.max(most, label.row + 1), 1);
  const padTop = PAD_TOP + (rows - 1) * LABEL_ROW_HEIGHT;
  const markerSummary = placedMarkers.map((marker) => `v${marker.version} (${marker.day})`).join(", ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={
          markerSummary
            ? `Daily human and study sessions with release markers: ${markerSummary}`
            : "Daily human and study sessions"
        }
        className="w-full"
      >
        <line x1={PAD_LEFT} x2={CHART_WIDTH - PAD_RIGHT} y1={CHART_HEIGHT - PAD_BOTTOM} y2={CHART_HEIGHT - PAD_BOTTOM} stroke="#cbd5e1" />
        <text x={PAD_LEFT - 4} y={padTop + 4} textAnchor="end" fontSize="10" fill="#64748b">
          {max}
        </text>
        <text x={PAD_LEFT - 4} y={CHART_HEIGHT - PAD_BOTTOM} textAnchor="end" fontSize="10" fill="#64748b">
          0
        </text>
        {placedMarkers.map((marker) => (
          <line
            key={marker.version}
            data-testid="release-marker"
            x1={marker.x}
            x2={marker.x}
            y1={padTop}
            y2={CHART_HEIGHT - PAD_BOTTOM}
            stroke="#f59e0b"
            strokeDasharray="3 3"
          />
        ))}
        {labels.map((label) => (
          <text
            key={label.text}
            data-testid="release-marker-label"
            x={label.anchor === "start" ? label.x + 2 : label.x - 2}
            y={padTop - 3 - label.row * LABEL_ROW_HEIGHT}
            textAnchor={label.anchor}
            fontSize="9"
            fill="#b45309"
          >
            {label.text}
          </text>
        ))}
        <path d={buildPath(daily, (point) => point.humanSessions, max, padTop)} fill="none" stroke="#4f46e5" strokeWidth="2" />
        <path d={buildPath(daily, (point) => point.studySessions, max, padTop)} fill="none" stroke="#059669" strokeWidth="2" />
        <text x={PAD_LEFT} y={CHART_HEIGHT - 6} fontSize="10" fill="#64748b">
          {daily[0]?.day}
        </text>
        <text x={CHART_WIDTH - PAD_RIGHT} y={CHART_HEIGHT - 6} textAnchor="end" fontSize="10" fill="#64748b">
          {daily[daily.length - 1]?.day}
        </text>
      </svg>
      <div className="flex flex-wrap gap-4 pt-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />
          Human sessions
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
          Study sessions
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-0.5 bg-amber-500" />
          First day a release appeared
        </span>
      </div>
    </div>
  );
};

const AdminOverviewPanel = () => {
  const [days, setDays] = useState<OverviewDays>(7);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "analytics-overview", days],
    queryFn: () => adminApi.getAnalyticsOverview(days),
  });

  return (
    <section className="mb-8 space-y-4" aria-label="Analytics overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Overview</h2>
        <div className="flex gap-2" role="group" aria-label="Overview range">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={days === option}
              onClick={() => setDays(option)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                days === option ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {option}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && (
        <ErrorMessage message="Failed to load the analytics overview." onRetry={() => void refetch()} />
      )}

      {data && (
        <>
          {data.current.humanSessions === 0 && data.previous.humanSessions === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              No traffic recorded in this range yet.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {KPI_DEFS.map(({ key, label }) => {
              const value = data.current[key];
              const previous = data.previous[key];
              const change = value !== null && previous !== null ? formatChange(value, previous) : null;
              return (
                <div key={key} className="rounded-lg bg-surface p-4 shadow" data-testid={`kpi-${key}`}>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{value ?? "—"}</p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {change === null ? "no change data" : `${change} vs previous ${data.days}d`}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg bg-surface p-4 shadow">
            <DailyChart data={data} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <WorkQueueLink to="/admin/review-board" label="Items awaiting review" count={data.workQueue.itemsAwaitingReview} />
            <WorkQueueLink
              to="/admin/review-board?tab=pictures"
              label="Pictures awaiting review"
              count={data.workQueue.picturesAwaitingReview ?? 0}
              sublabel={
                (data.workQueue.picturesAwaitingReview ?? 0) > 0 && data.workQueue.oldestPictureSubmittedAt
                  ? `Oldest submitted ${formatAge(secondsSince(data.workQueue.oldestPictureSubmittedAt))} ago`
                  : undefined
              }
            />
            <WorkQueueLink to="/admin/keyword-review" label="Pending private keywords" count={data.workQueue.pendingPrivateKeywords} />
            <WorkQueueLink to="/admin/ideas" label="Ideas awaiting moderation" count={data.workQueue.ideasAwaitingModeration} />
            <WorkQueueLink to="/admin/client-errors" label="New front-end error groups" count={data.workQueue.newClientErrorGroups} />
          </div>
        </>
      )}
    </section>
  );
};

const WorkQueueLink = ({
  to,
  label,
  count,
  sublabel,
}: {
  to: string;
  label: string;
  count: number;
  sublabel?: string;
}) => (
  <Link
    to={to}
    className="flex items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow hover:shadow-lg transition-shadow"
  >
    <span>
      <span className="block text-sm font-medium text-gray-900">{label}</span>
      {sublabel ? <span className="block text-xs text-gray-500">{sublabel}</span> : null}
    </span>
    <span className="text-xl font-semibold text-indigo-ink">{count}</span>
  </Link>
);

export default AdminOverviewPanel;
