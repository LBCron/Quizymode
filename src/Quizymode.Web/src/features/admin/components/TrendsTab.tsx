import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi, type PageViewRollupDimensionRow } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { formatArea } from "./sessionFormatting";

const TREND_RANGES: Array<{ label: string; days: number }> = [
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1y", days: 365 },
  { label: "2y", days: 730 },
];

/**
 * Long-range traffic from daily rollups (ANALYTICS-011). Raw page hits are only kept for the
 * retention period, so ranges past it are answered from aggregates. Rollups always exclude bots and
 * internal traffic, so the page-level toggles and time range do not apply here.
 */
const TrendsTab = () => {
  const [days, setDays] = useState(365);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "page-view-rollups", days],
    queryFn: () => adminApi.getPageViewRollups(days),
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Long-range trends</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              Daily rollups of page hits, kept after raw hits are deleted
              {data ? ` (raw hits are kept ${data.retentionDays} days)` : ""}. Bots
              and internal traffic are always excluded, and the page-level time range
              and toggles do not apply. Complete UTC days only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Trend range">
            {TREND_RANGES.map((option) => (
              <button
                key={option.days}
                type="button"
                onClick={() => setDays(option.days)}
                aria-pressed={days === option.days}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  days === option.days
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {isLoading && <LoadingSpinner />}

      {error && (
        <ErrorMessage message="Failed to load traffic trends" onRetry={() => refetch()} />
      )}

      {data && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card label="Session-days" value={data.totalSessionDays} detail="Distinct sessions per day, summed" />
            <Card label="Page hits" value={data.totalHits} detail={`${data.daily.length} days with traffic`} />
            <Card label="Question views" value={data.totalItemSteps} detail="Quiz and Flashcards item steps" />
            <Card
              label="Latest rolled-up day"
              value={data.latestRolledDay ?? "None yet"}
              detail="Rollups run daily for the previous UTC day"
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900">Daily sessions</h3>
            {data.daily.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No rolled-up traffic in this range yet.</p>
            ) : (
              <DailyBars daily={data.daily} />
            )}
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">By feature area</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead>
                    <tr>
                      <th className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Area</th>
                      <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Session-days</th>
                      <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Hits</th>
                      <th className="py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Item steps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.areas.map((row) => (
                      <tr key={row.area}>
                        <td className="py-2 pr-4 text-sm font-medium text-slate-900">{formatArea(row.area)}</td>
                        <td className="py-2 text-right text-sm text-slate-700">{row.sessionDays}</td>
                        <td className="py-2 text-right text-sm text-slate-700">{row.hits}</td>
                        <td className="py-2 text-right text-sm text-slate-700">{row.itemSteps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <DimensionList title="Channel" rows={data.channels} />
              <DimensionList title="Device" rows={data.deviceClasses} />
              <DimensionList title="Outcome" rows={data.outcomes} />
              <DimensionList title="New vs returning" rows={data.visitorTypes} />
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const Card = ({ label, value, detail }: { label: string; value: number | string; detail: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
    <div className="text-sm font-medium text-slate-500">{label}</div>
    <div className="mt-3 break-words text-2xl font-semibold text-slate-900">{value}</div>
    <div className="mt-2 text-sm text-slate-600">{detail}</div>
  </div>
);

const DailyBars = ({ daily }: { daily: Array<{ day: string; sessions: number }> }) => {
  const max = Math.max(...daily.map((row) => row.sessions), 1);

  return (
    <div className="mt-4 overflow-x-auto">
      <div className="flex h-32 min-w-full items-end gap-px" aria-label="Daily sessions chart" role="img">
        {daily.map((row) => (
          <div
            key={row.day}
            title={`${row.day}: ${row.sessions} sessions`}
            className="min-w-[2px] flex-1 rounded-t bg-indigo-500"
            style={{ height: `${Math.max((row.sessions / max) * 100, 2)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{daily[0].day}</span>
        <span>{daily[daily.length - 1].day}</span>
      </div>
    </div>
  );
};

const DimensionList = ({ title, rows }: { title: string; rows: PageViewRollupDimensionRow[] }) => (
  <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
    <h3 className="text-base font-semibold text-gray-900">{title}</h3>
    {rows.length === 0 ? (
      <p className="mt-2 text-sm text-slate-500">No data.</p>
    ) : (
      <ul className="mt-2 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.value} className="flex justify-between gap-3">
            <span className="text-slate-700">{row.value}</span>
            <span className="font-medium text-slate-900">{row.sessionDays}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default TrendsTab;
