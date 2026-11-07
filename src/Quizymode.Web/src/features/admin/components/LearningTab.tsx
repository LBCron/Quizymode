import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";

interface LearningTabProps {
  days: number;
  includeBots: boolean;
  includeInternal?: boolean;
}

const CHANNEL_OPTIONS = [
  { value: "", label: "All channels" },
  { value: "paid", label: "Paid" },
  { value: "email", label: "Email" },
  { value: "campaign", label: "Campaign" },
  { value: "search", label: "Search" },
  { value: "social", label: "Social" },
  { value: "referral", label: "Referral" },
  { value: "direct", label: "Direct" },
  { value: "unknown", label: "Unknown" },
];

const VISITOR_OPTIONS = [
  { value: "", label: "All visitors" },
  { value: "new", label: "New visitors" },
  { value: "returning", label: "Returning visitors" },
];

const formatPercent = (value: number | null) => (value === null ? "—" : `${value}%`);

/** Display names for context types whose raw value reads badly in the table. */
const CONTEXT_TYPE_LABELS: Record<string, string> = { topic: "Topic" };

const scopeLabel = (contextType: string | null, contextId: string | null) => {
  if (!contextType) return "All";
  const label = CONTEXT_TYPE_LABELS[contextType] ?? contextType;
  return contextId ? `${label}: ${contextId}` : label;
};

const LearningTab = ({ days, includeBots, includeInternal = false }: LearningTabProps) => {
  const [channel, setChannel] = useState("");
  const [visitorType, setVisitorType] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "learning-report", days, includeBots, includeInternal, channel, visitorType],
    queryFn: () =>
      adminApi.getLearningReport(
        days,
        includeBots,
        includeInternal,
        channel || undefined,
        visitorType || undefined
      ),
  });

  const filters = (
    <div className="flex flex-wrap items-end gap-4">
      <label className="text-sm text-slate-700">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Channel
        </span>
        <select
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
          className="mt-1 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm"
        >
          {CHANNEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm text-slate-700">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Visitor type
        </span>
        <select
          value={visitorType}
          onChange={(event) => setVisitorType(event.target.value)}
          className="mt-1 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm"
        >
          {VISITOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {filters}
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {filters}
        <ErrorMessage message="Failed to load the learning report" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const maxDropOffShare = Math.max(1, ...data.quizDropOff.map((point) => point.sharePercent));

  return (
    <div className="space-y-6">
      {filters}
      <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Study Engagement</h2>
          <p className="mt-1 text-sm text-gray-600">
            Quiz and Flashcards runs started and completed, by mode and scope, for the selected
            window.
          </p>
          {data.botsExcluded && data.botSessions > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {data.botSessions} bot session{data.botSessions === 1 ? " was" : "s were"} excluded.
            </p>
          )}
          {data.internalExcluded && data.internalSessions > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {data.internalSessions} internal session{data.internalSessions === 1 ? " was" : "s were"}{" "}
              excluded: admins, users flagged internal, and browsers marked as internal.
            </p>
          )}
        </div>

        {data.scopes.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No study activity recorded in this window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mode
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Scope
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Runs started
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Runs completed
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Completion %
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Avg score %
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Avg items reached
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-surface">
                {data.scopes.map((scope) => (
                  <tr key={`${scope.mode}:${scope.contextType ?? ""}:${scope.contextId ?? ""}`}>
                    <td className="px-5 py-4 text-sm font-medium capitalize text-slate-900">
                      {scope.mode}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {scopeLabel(scope.contextType, scope.contextId)}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      {scope.runsStarted}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {scope.runsCompleted ?? "—"}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {formatPercent(scope.completionRatePercent)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {formatPercent(scope.averageScorePercent)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-700">
                      {scope.averageItemsReached}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Quiz Drop-off</h2>
          <p className="mt-1 text-sm text-gray-600">
            Share of started quiz runs that reached each question position, and how many stopped
            there without finishing. {data.quizRunsAbandonedBeforeFirstAnswer} run
            {data.quizRunsAbandonedBeforeFirstAnswer === 1 ? "" : "s"} started and never answered a
            question.
          </p>
        </div>

        {data.quizDropOff.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No quiz runs recorded in this window.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {data.quizDropOff.map((point) => (
              <li key={point.position} className="px-5 py-4">
                <div className="flex items-center justify-between text-sm text-slate-700">
                  <span className="font-medium">Question {point.position}</span>
                  <span>
                    {point.runsReached} reached ({point.sharePercent}%)
                    {point.runsAbandonedHere > 0 && (
                      <span className="ml-2 text-amber-700">
                        {point.runsAbandonedHere} stopped here
                      </span>
                    )}
                  </span>
                </div>
                <div
                  className="mt-2 h-2 rounded-full bg-indigo-500"
                  style={{ width: `${Math.max(2, (point.sharePercent / maxDropOffShare) * 100)}%` }}
                  aria-hidden="true"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default LearningTab;
