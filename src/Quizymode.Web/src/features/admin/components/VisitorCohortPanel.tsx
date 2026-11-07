import type { VisitorCohortSummary } from "@/api/admin";

interface VisitorCohortPanelProps {
  visitors: VisitorCohortSummary;
  /** Show the 7-day return table by channel and campaign. */
  showReturnTable?: boolean;
}

const formatNumber = (value: number | null) => (value === null ? "—" : `${value}`);

const headerCell =
  "px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

/** New vs returning visitors, 7-day return rate, and visits to signup (ANALYTICS-003). */
const VisitorCohortPanel = ({ visitors, showReturnTable = true }: VisitorCohortPanelProps) => {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-surface shadow-sm"
      aria-labelledby="visitor-cohort-heading"
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 id="visitor-cohort-heading" className="text-lg font-semibold text-gray-900">
          New vs Returning Visitors
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          A returning visitor had a session before the one being counted. Sessions without a
          visitor id (Global Privacy Control, blocked storage, or older history) are counted
          separately.
        </p>
      </div>

      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            New visitors
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">{visitors.newVisitors}</dd>
          <dd className="text-xs text-slate-500">{visitors.newVisitorSessions} first sessions</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Returning visitors
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {visitors.returningVisitors}
          </dd>
          <dd className="text-xs text-slate-500">
            {visitors.returningVisitorSessions} returning sessions
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Signups with visit history
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {visitors.signupsWithVisitorHistory}
          </dd>
          <dd className="text-xs text-slate-500">
            Median {formatNumber(visitors.medianPreSignupSessions)} sessions before signup (avg{" "}
            {formatNumber(visitors.avgPreSignupSessions)})
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Days from first visit to signup
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {formatNumber(visitors.medianDaysToSignup)}
          </dd>
          <dd className="text-xs text-slate-500">
            Median (avg {formatNumber(visitors.avgDaysToSignup)}); {visitors.unidentifiedSessions}{" "}
            sessions without a visitor id
          </dd>
        </div>
      </dl>

      {showReturnTable && (
        <div className="border-t border-slate-200">
          <h3 className="px-5 pt-4 text-sm font-semibold text-slate-900">
            First-time visitors who returned within 7 days
          </h3>
          {visitors.returnWithin7Days.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">
              No first-time visitors in this window.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-2 min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={headerCell}>Channel</th>
                    <th className={headerCell}>Campaign</th>
                    <th className={headerCell}>First-time visitors</th>
                    <th className={headerCell}>Returned in 7 days</th>
                    <th className={headerCell}>Return rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-surface">
                  {visitors.returnWithin7Days.map((row) => (
                    <tr key={`${row.channel}:${row.utmCampaign ?? ""}`}>
                      <td className="px-5 py-3 text-sm font-medium capitalize text-slate-900">
                        {row.channel}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        {row.utmCampaign ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">{row.firstTimeVisitors}</td>
                      <td className="px-5 py-3 text-sm text-slate-700">
                        {row.returnedWithin7Days}
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                        {row.returnRatePercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default VisitorCohortPanel;
