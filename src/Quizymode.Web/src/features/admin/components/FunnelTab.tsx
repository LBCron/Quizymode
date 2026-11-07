import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";

const STEP_LABELS: Record<string, string> = {
  quick_quiz_started: "Quick quiz started",
  quiz_completed: "Quiz completed",
  signup_prompt_viewed: "Signup prompt viewed",
  signup_prompt_clicked: "Signup prompt clicked",
  signup_form_started: "Signup form started",
  signup_submitted: "Signup submitted",
  signup_confirmation_shown: "Confirmation shown",
  signup_confirmed: "Signup confirmed",
  sign_in_completed: "Sign-in completed",
  guest_state_imported: "Guest progress imported",
};

interface FunnelTabProps {
  days: number;
  includeBots: boolean;
  includeInternal?: boolean;
}

const formatPercent = (value: number | null) => (value === null ? "—" : `${value}%`);

const FunnelTab = ({ days, includeBots, includeInternal = false }: FunnelTabProps) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "conversion-funnel", days, includeBots, includeInternal],
    queryFn: () => adminApi.getConversionFunnel(days, includeBots, includeInternal),
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <ErrorMessage message="Failed to load the conversion funnel" onRetry={() => refetch()} />
    );
  }

  if (!data) {
    return null;
  }

  const maxSessions = Math.max(1, ...data.steps.map((step) => step.sessions));

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Conversion Funnel</h2>
        <p className="mt-1 text-sm text-gray-600">
          Unique sessions that recorded each event. Steps are counted independently, so a
          later step can exceed an earlier one (for example sign-ins by returning users).{" "}
          {data.sessionsWithEvents} session{data.sessionsWithEvents === 1 ? "" : "s"} recorded
          at least one event.
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

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step
              </th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Sessions
              </th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                From previous
              </th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                From first step
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-surface">
            {data.steps.map((step) => (
              <tr key={step.eventName}>
                <td className="px-5 py-4 text-sm text-slate-900">
                  <div className="font-medium">{STEP_LABELS[step.eventName] ?? step.eventName}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">{step.eventName}</div>
                </td>
                <td className="px-5 py-4 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">{step.sessions}</div>
                  <div
                    className="mt-2 h-2 rounded-full bg-indigo-500"
                    style={{ width: `${Math.max(2, (step.sessions / maxSessions) * 100)}%` }}
                    aria-hidden="true"
                  />
                  <div className="mt-1 text-xs text-slate-500">{step.events} events</div>
                </td>
                <td className="px-5 py-4 text-sm text-slate-700">
                  {formatPercent(step.conversionFromPreviousPercent)}
                </td>
                <td className="px-5 py-4 text-sm text-slate-700">
                  {formatPercent(step.conversionFromFirstPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default FunnelTab;
