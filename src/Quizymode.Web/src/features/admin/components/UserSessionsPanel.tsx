import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import SessionRow from "./SessionRow";

interface UserSessionsPanelProps {
  userId: string;
  days: number;
  includeInternal: boolean;
  formatDateTime: (value?: string | null) => string;
}

const TH = "px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

const UserSessionsPanel = ({ userId, days, includeInternal, formatDateTime }: UserSessionsPanelProps) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "user-sessions", userId, days, includeInternal],
    queryFn: () =>
      adminApi.getPageViewSessions(days, "all", undefined, false, "recent", 1, 10, 1, includeInternal, userId),
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h3 className="text-lg font-semibold text-gray-900">Sessions</h3>
        <p className="mt-1 text-sm text-gray-600">
          This user&apos;s most recent sessions in the selected history window. Open a row to see
          the journey.
        </p>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorMessage message="Failed to load sessions" onRetry={() => refetch()} />}

      {data && data.sessions.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-slate-500">
          No sessions recorded for this user in the window.
        </div>
      )}

      {data && data.sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Started</th>
                <th className={TH}>Visitor</th>
                <th className={TH}>Entry → Exit</th>
                <th className={TH}>Pages</th>
                <th className={TH}>Duration</th>
                <th className={TH}>IP / Client</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-surface">
              {data.sessions.map((session) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  formatDateTime={formatDateTime}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default UserSessionsPanel;
