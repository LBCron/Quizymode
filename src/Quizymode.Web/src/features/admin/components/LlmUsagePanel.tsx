import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { adminLlmProvidersApi } from "@/api/adminLlmProviders";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

/** AC 5.12.14: vendor calls, tokens, estimated cost, and top users for a selectable window. */

const USAGE_WINDOWS: Array<{ days: number; label: string }> = [
  { days: 1, label: "Last day" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

const TH = "py-2 pr-4 text-left text-xs font-normal uppercase tracking-wide text-gray-500";
const TH_NUM = "py-2 pr-4 text-right text-xs font-normal uppercase tracking-wide text-gray-500";

function successRate(successes: number, attempts: number): string {
  return attempts > 0 ? `${Math.round((successes / attempts) * 100)}%` : "—";
}

const LlmUsagePanel = () => {
  const [days, setDays] = React.useState(30);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "llm-providers", "usage", days],
    queryFn: () => adminLlmProvidersApi.getUsage(days),
    placeholderData: keepPreviousData,
  });

  return (
    <section aria-labelledby="llm-usage-heading" className="rounded-lg bg-surface p-5 shadow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="llm-usage-heading" className="text-base font-semibold text-gray-900">
          Usage
        </h2>
        <div>
          <label htmlFor="llm-usage-days" className="mr-2 text-sm text-gray-600">
            Usage window
          </label>
          <select
            id="llm-usage-days"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-sm"
          >
            {USAGE_WINDOWS.map((window) => (
              <option key={window.days} value={window.days}>
                {window.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Vendor calls and token use for the selected window. Costs are estimates from configured prices; models without a
        price show n/a.
      </p>
      {isLoading ? (
        <LoadingSpinner />
      ) : error || !data ? (
        <div className="mt-3">
          <ErrorMessage message="Failed to load usage" onRetry={() => void refetch()} />
        </div>
      ) : data.rows.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">No vendor calls in this window.</p>
      ) : (
        <>
          <h3 className="mt-4 text-sm font-semibold text-gray-900">By vendor and model</h3>
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Usage by vendor and model, scrollable">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Usage by vendor and model</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Vendor
                  </th>
                  <th scope="col" className={TH}>
                    Model
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Attempts
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Success rate
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Tokens in / out
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Avg duration
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Est. cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={`${row.vendor}-${row.model}`} className="border-t border-gray-100">
                    <td className="py-1.5 pr-4 whitespace-nowrap">{row.vendor}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{row.model}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">{row.attempts.toLocaleString()}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                      {successRate(row.successes, row.attempts)}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                      {row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                      {row.avgDurationMs.toLocaleString()} ms
                    </td>
                    {row.estimatedCostUsd === null || row.estimatedCostUsd === undefined ? (
                      <td
                        className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap text-gray-500"
                        title="No price configured for this model"
                      >
                        n/a
                      </td>
                    ) : (
                      <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                        ${row.estimatedCostUsd.toFixed(4)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-gray-900">Top users</h3>
          <p className="text-xs text-gray-500">Top 20 users by charged sections in this window.</p>
          {data.topUsers.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600">No charged sections in this window.</p>
          ) : (
            <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Top users, scrollable">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Top users by charged sections</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      User ID
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Charged sections
                    </th>
                    <th scope="col" className={TH_NUM}>
                      Tokens in / out
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.topUsers.map((user) => (
                    <tr key={user.userId} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4 font-mono text-xs break-all">{user.userId}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                        {user.chargedSections.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">
                        {user.inputTokens.toLocaleString()} / {user.outputTokens.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default LlmUsagePanel;
