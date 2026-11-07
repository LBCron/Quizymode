import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import {
  adminApi,
  type ClientErrorGroup,
  type ClientErrorValueCount,
} from "@/api/admin";
import { useAuth } from "@/contexts/AuthContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

const WINDOW_OPTIONS = [
  { label: "Last 24 hours", value: 1 },
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

const SOURCE_LABELS: Record<string, string> = {
  boundary: "Render",
  window: "Runtime",
  promise: "Promise",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function describeMix(values: ClientErrorValueCount[]): string {
  return values.length === 0 ? "—" : values.map((item) => `${item.value} (${item.count})`).join(", ");
}

const AdminClientErrorsPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const [days, setDays] = useState(7);
  const [appVersion, setAppVersion] = useState("");
  const [includeBots, setIncludeBots] = useState(false);
  const [includeInternal, setIncludeInternal] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "client-errors", days, appVersion, includeBots, includeInternal],
    queryFn: () => adminApi.getClientErrors(days, appVersion, includeBots, includeInternal),
    enabled: isAuthenticated && isAdmin,
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <h1 className="mb-2 text-3xl font-bold text-gray-900">Client errors</h1>
      <p className="mb-6 text-sm text-gray-600">
        Front-end crashes reported by visitors' browsers, grouped by fingerprint (error name,
        normalized message, and top stack frame). Bot and internal traffic is excluded unless you
        include it. Reports are kept for 90 days.
      </p>

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg bg-surface p-4 shadow">
        <label className="flex flex-col text-sm text-gray-700">
          Time window
          <select
            className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm text-gray-700">
          App version
          <select
            className="mt-1 rounded-md border border-gray-300 px-3 py-2"
            value={appVersion}
            onChange={(event) => setAppVersion(event.target.value)}
          >
            <option value="">All versions</option>
            {(data?.appVersions ?? []).map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeBots}
            onChange={(event) => setIncludeBots(event.target.checked)}
          />
          Include bots
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeInternal}
            onChange={(event) => setIncludeInternal(event.target.checked)}
          />
          Include internal traffic
        </label>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage message="Failed to load client errors" onRetry={() => refetch()} />}

      {data && (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <SummaryCard label="Reports" value={data.totalReports} />
            <SummaryCard label="Error groups" value={data.totalGroups} />
            <SummaryCard label="New groups" value={data.newGroups} detail="First seen in this window" />
          </div>

          <p className="mb-4 text-xs text-gray-500">
            {data.botsExcluded && data.botReports > 0 && `${data.botReports} bot report(s) excluded. `}
            {data.internalExcluded &&
              data.internalSessions > 0 &&
              `${data.internalSessions} internal session(s) excluded. `}
            {data.truncated && "Only the most recent 10,000 reports in this window were grouped."}
          </p>

          {data.groups.length === 0 ? (
            <div className="rounded-lg bg-surface p-6 text-sm text-gray-600 shadow">
              No client errors in this window.
            </div>
          ) : (
            <ul className="space-y-4">
              {data.groups.map((group) => (
                <ClientErrorGroupCard key={group.fingerprint} group={group} includeInternal={includeInternal} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

const SummaryCard = ({ label, value, detail }: { label: string; value: number; detail?: string }) => (
  <div className="rounded-lg bg-surface p-5 shadow">
    <p className="text-sm font-medium text-gray-500">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-gray-900">{value.toLocaleString()}</p>
    {detail && <p className="mt-1 text-xs text-gray-500">{detail}</p>}
  </div>
);

const ClientErrorGroupCard = ({
  group,
  includeInternal,
}: {
  group: ClientErrorGroup;
  includeInternal: boolean;
}) => {
  const [showJourney, setShowJourney] = useState(false);

  const journey = useQuery({
    queryKey: ["admin", "page-view-session-detail", group.sampleSessionId, includeInternal],
    queryFn: () => adminApi.getPageViewSessionDetail(group.sampleSessionId, includeInternal),
    enabled: showJourney,
    retry: false,
  });

  return (
    <li className="rounded-lg bg-surface p-5 shadow" data-testid="client-error-group">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold text-gray-900">
            {group.errorName}: {group.message}
          </h2>
          <p className="mt-1 font-mono text-xs text-gray-500">{group.fingerprint}</p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {SOURCE_LABELS[group.source] ?? group.source}
          </span>
          {group.isNew && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700">New</span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Reports" value={group.count.toLocaleString()} />
        <Fact label="Affected sessions" value={group.sessions.toLocaleString()} />
        <Fact label="First seen" value={formatDateTime(group.firstSeenUtc)} />
        <Fact label="Last seen" value={formatDateTime(group.lastSeenUtc)} />
        <Fact label="Latest app version" value={group.latestAppVersion ?? "—"} />
        <Fact label="Top paths" value={describeMix(group.topPaths)} />
        <Fact label="Browsers" value={describeMix(group.browsers)} />
        <Fact label="Devices" value={describeMix(group.devices)} />
      </dl>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-indigo-ink">Sample stack</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-gray-100 p-3 text-xs text-gray-800">
          {group.sampleStack ?? "No stack was reported."}
        </pre>
        {group.sampleComponentStack && (
          <>
            <p className="mt-3 text-xs font-medium text-gray-600">Component stack</p>
            <pre className="mt-1 max-h-60 overflow-auto rounded bg-gray-100 p-3 text-xs text-gray-800">
              {group.sampleComponentStack}
            </pre>
          </>
        )}
      </details>

      <div className="mt-3 text-sm">
        <button
          type="button"
          className="font-medium text-indigo-ink hover:text-indigo-ink"
          aria-expanded={showJourney}
          onClick={() => setShowJourney((current) => !current)}
        >
          {showJourney ? "Hide" : "Show"} sample session journey
        </button>
        <span className="ml-2 font-mono text-xs text-gray-500">{group.sampleSessionId}</span>
        {showJourney && (
          <div className="mt-2">
            {journey.isLoading && <p className="text-xs text-gray-500">Loading journey…</p>}
            {journey.error && (
              <p className="text-xs text-gray-500">No page hits were recorded for this session.</p>
            )}
            {journey.data && (
              <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-700">
                {journey.data.steps.map((step) => (
                  <li key={step.stepNumber}>
                    <span className="break-all">{step.path}</span>{" "}
                    <span className="text-gray-500">{formatDateTime(step.createdUtc)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </li>
  );
};

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-xs text-gray-500">{label}</dt>
    <dd className="break-words text-gray-900">{value}</dd>
  </div>
);

export default AdminClientErrorsPage;
