import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { studySessionsApi } from "@/api/studySessions";
import { SignupPrompt } from "@/features/auth/components/SignupPrompt";
import { useGuestHistory } from "@/features/guestHistory/useGuestHistory";
import {
  GUEST_HISTORY_MAX_SUMMARIES,
  GUEST_HISTORY_RETENTION_DAYS,
} from "@/features/guestHistory/guestHistoryStorage";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { STUDY_ACTIVITY_QUERY_KEY, STUDY_SUMMARY_QUERY_KEY } from "./queryKeys";
import { HEATMAP_DAYS, aggregateGuestActivity } from "./activityCalendar";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-surface p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-2xl font-bold text-gray-900">{value}</dd>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function percent(value: number | null): string {
  return value === null ? "None yet" : `${value}%`;
}

function streakHint(current: number): string {
  return current > 0 ? "Keep it going: study again before the UTC day ends." : "Complete a quiz or Learn session to start a streak.";
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SEO title="My progress | Quizymode" description="Your study streak, activity calendar and totals." noindex />
      <div className="mx-auto max-w-4xl min-w-0 px-3 py-4 sm:px-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">My progress</h1>
        </header>
        {children}
      </div>
    </>
  );
}

function EmptyActions() {
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-sm">
      <Link to="/daily" className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700">
        Play the daily quiz
      </Link>
      <Link to="/categories" className="rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50">
        Browse categories
      </Link>
    </div>
  );
}

function GuestProgress() {
  const { summaries } = useGuestHistory();
  const guest = aggregateGuestActivity(summaries);

  return (
    <Page>
      <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="guest-scope-note">
        This browser only. This calendar is built from quiz results saved in this browser (your last{" "}
        {GUEST_HISTORY_MAX_SUMMARIES} results for up to {GUEST_HISTORY_RETENTION_DAYS} days). It is not in an account and
        is not shared with other devices.
      </p>
      <SignupPrompt reason="track-progress" className="mb-4" />
      <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Current streak" value={days(guest.currentStreak)} hint={streakHint(guest.currentStreak)} />
        <StatCard label="Longest streak" value={days(guest.longestStreak)} />
        <StatCard label="Quizzes in this browser" value={String(guest.totalSessions)} />
      </dl>
      <section aria-labelledby="progress-activity-heading" className="rounded-lg border border-gray-200 bg-surface p-4">
        <h2 id="progress-activity-heading" className="mb-2 text-lg font-semibold text-gray-900">
          Activity, this browser only
        </h2>
        <ActivityHeatmap activity={guest.activity} today={guest.today} />
        {guest.totalSessions === 0 && <EmptyActions />}
      </section>
    </Page>
  );
}

function SignedInProgress() {
  const { userId } = useAuth();
  const summaryQuery = useQuery({
    queryKey: [...STUDY_SUMMARY_QUERY_KEY, userId],
    queryFn: () => studySessionsApi.getSummary(),
    retry: 1,
  });
  const activityQuery = useQuery({
    queryKey: [...STUDY_ACTIVITY_QUERY_KEY, HEATMAP_DAYS, userId],
    queryFn: () => studySessionsApi.getActivity(HEATMAP_DAYS),
    retry: 1,
  });

  const summary = summaryQuery.data;
  const activity = activityQuery.data;

  return (
    <Page>
      {(summaryQuery.isLoading || activityQuery.isLoading) && <LoadingSpinner />}

      {(summaryQuery.isError || activityQuery.isError) && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Your progress could not be loaded.{" "}
          <button
            type="button"
            onClick={() => {
              void summaryQuery.refetch();
              void activityQuery.refetch();
            }}
            className="font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}

      {activity && (
        <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Study streaks">
          <StatCard label="Current streak" value={days(activity.currentStreak)} hint={streakHint(activity.currentStreak)} />
          <StatCard label="Longest streak" value={days(activity.longestStreak)} />
        </dl>
      )}

      {summary && (
        <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Study totals">
          <StatCard label="Sessions" value={String(summary.totalSessions)} />
          <StatCard label="Questions" value={String(summary.totalQuestions)} />
          <StatCard label="Accuracy" value={percent(summary.accuracyPercent)} />
          <StatCard
            label="Last 30 days"
            value={`${summary.last30DaysSessions} ${summary.last30DaysSessions === 1 ? "session" : "sessions"}`}
            hint={summary.last30DaysAccuracyPercent === null ? undefined : `${summary.last30DaysAccuracyPercent}% accuracy`}
          />
        </dl>
      )}

      {activity && (
        <section aria-labelledby="progress-activity-heading" className="rounded-lg border border-gray-200 bg-surface p-4">
          <h2 id="progress-activity-heading" className="mb-2 text-lg font-semibold text-gray-900">
            Activity
          </h2>
          <ActivityHeatmap activity={activity.activity} today={activity.today} showDailyMarker />
          {summary?.totalSessions === 0 && <EmptyActions />}
        </section>
      )}

      {(activity || summary) && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-gray-600">
          <li>Days and streaks use UTC days and count completed quiz and Learn sessions.</li>
          <li>Review-queue answers and flashcard study are not counted yet, so a streak can undercount your real studying.</li>
          <li>Sessions are kept for 365 days.</li>
          {summary && summary.importedSessions > 0 && (
            <li>
              {summary.importedSessions} {summary.importedSessions === 1 ? "session was" : "sessions were"} imported from this
              browser. Imported runs are unverified, but they do count toward your calendar and streaks.
            </li>
          )}
        </ul>
      )}
    </Page>
  );
}

const ProgressPage = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingSpinner />;
  return isAuthenticated ? <SignedInProgress /> : <GuestProgress />;
};

export default ProgressPage;
