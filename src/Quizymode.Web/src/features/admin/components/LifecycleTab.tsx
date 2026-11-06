import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";

const TH = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-4 py-3 text-sm text-slate-700";

const WEEK_OPTIONS = [4, 8, 12, 25];

/** "active / eligible (pct%)", or an em dash while nobody has reached that mark yet. */
const ratio = (part: number, eligible: number) =>
  eligible === 0 ? "—" : `${part} / ${eligible} (${Math.round((part * 100) / eligible)}%)`;

const LifecycleTab = () => {
  const [weeks, setWeeks] = useState(12);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "lifecycle-report", weeks],
    queryFn: () => adminApi.getLifecycleReport(weeks),
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorMessage message="Failed to load the lifecycle report" onRetry={() => refetch()} />;
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Signup cohorts</h2>
          <p className="mt-1 text-sm text-gray-600">
            Registered users by signup week (internal users excluded). Activated means a completed
            quiz within 7 days. Week N counts users with a page view 7N to 7N+7 days after signup;
            only users whose window has ended are counted as eligible.
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Cohort weeks">
            {WEEK_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setWeeks(option)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  weeks === option
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {option}w
              </button>
            ))}
          </div>
        </div>
        {data.cohorts.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            No signups in this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Week of</th>
                  <th className={TH}>Signups</th>
                  <th className={TH}>Activated (7d)</th>
                  <th className={TH}>Week 1</th>
                  <th className={TH}>Week 2</th>
                  <th className={TH}>Week 4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {data.cohorts.map((cohort) => (
                  <tr key={cohort.weekStartUtc}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {cohort.weekStartUtc.slice(0, 10)}
                    </td>
                    <td className={TD}>{cohort.signups}</td>
                    <td className={TD}>{ratio(cohort.activated7Days, cohort.activatedEligible)}</td>
                    <td className={TD}>{ratio(cohort.activeWeek1, cohort.eligibleWeek1)}</td>
                    <td className={TD}>{ratio(cohort.activeWeek2, cohort.eligibleWeek2)}</td>
                    <td className={TD}>{ratio(cohort.activeWeek4, cohort.eligibleWeek4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Signup source</h2>
          <p className="mt-1 text-sm text-gray-600">
            First-touch channel and campaign of the visitor who signed up, with how many activated
            and came back in week 1.
          </p>
        </div>
        {data.sources.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No signups to attribute.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Channel</th>
                  <th className={TH}>Campaign</th>
                  <th className={TH}>Signups</th>
                  <th className={TH}>Activated (7d)</th>
                  <th className={TH}>Week 1</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {data.sources.map((source) => (
                  <tr key={`${source.channel}:${source.campaign ?? ""}`}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{source.channel}</td>
                    <td className={TD}>{source.campaign ?? "—"}</td>
                    <td className={TD}>{source.signups}</td>
                    <td className={TD}>{ratio(source.activated7Days, source.activatedEligible)}</td>
                    <td className={TD}>{ratio(source.activeWeek1, source.eligibleWeek1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default LifecycleTab;
