import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { dailyQuizApi } from "@/api/learningLoop";
import { saveStudySession } from "@/features/studySessions/recordStudySession";
import { summarizeQuizRun, type QuizRunState } from "@/features/items/quiz/quizRun";
import { buildDailyShare } from "@/features/items/quiz/resultShare";
import { FixedSetQuiz } from "../FixedSetQuiz";
import { computeStreak, readDailyCompletions, recordLocalDailyCompletion } from "../localLearningState";

export const DAILY_QUIZ_QUERY_KEY = ["daily-quiz"] as const;

type CountState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "counted"; streak: number }
  | { status: "practice" }
  | { status: "failed" };

function streakLabel(streak: number): string {
  return `${streak}-day streak`;
}

/**
 * DAILY-001 (#119): today's global five-question quiz. The first completed run of the UTC day counts toward the streak
 * (server-side when signed in, in this browser otherwise); later runs are practice and never change the stored score.
 */
const DailyQuizPage = () => {
  const { isAuthenticated, isLoading: isAuthLoading, userId } = useAuth();
  const queryClient = useQueryClient();
  const [countState, setCountState] = useState<CountState>({ status: "idle" });
  const [started, setStarted] = useState(false);
  const identityKey = isAuthenticated ? `user:${userId ?? "unknown"}` : "guest";

  const query = useQuery({
    queryKey: [...DAILY_QUIZ_QUERY_KEY, identityKey],
    queryFn: () => dailyQuizApi.get(),
    enabled: !isAuthLoading,
    retry: 1,
    staleTime: 60 * 1000,
  });

  const data = query.data;
  const localCompletions = readDailyCompletions();
  const localToday = data ? localCompletions.find((entry) => entry.date === data.date) : undefined;
  const todaysResult = isAuthenticated ? data?.completion ?? null : localToday ?? null;
  const streak = isAuthenticated
    ? data?.streak ?? 0
    : data
      ? computeStreak(localCompletions.map((entry) => entry.date), data.date)
      : 0;

  const handleComplete = async (run: QuizRunState) => {
    if (!data) return;
    // Keep the results on screen once today's result exists (it would otherwise swap to the "done" card).
    setStarted(true);
    const summary = summarizeQuizRun(run);
    if (todaysResult || countState.status === "counted") {
      setCountState({ status: "practice" });
      return;
    }

    if (!isAuthenticated) {
      const next = recordLocalDailyCompletion({
        date: data.date,
        correct: summary.correct,
        total: summary.total,
        ...(summary.skipped > 0 ? { skipped: summary.skipped } : {}),
      });
      setCountState({ status: "counted", streak: computeStreak(next.map((entry) => entry.date), data.date) });
      return;
    }

    setCountState({ status: "saving" });
    try {
      // Total is the whole roster; skipped questions (unavailable picture) are not scored and keep the streak (#403).
      const response = await dailyQuizApi.complete(data.date, summary.correct, summary.total, summary.skipped);
      setCountState(response.created ? { status: "counted", streak: response.streak } : { status: "practice" });
      if (response.created && summary.scoredTotal > 0) {
        // History plus review queue: misses from the counted run are due tomorrow (#117).
        void saveStudySession({
          runId: run.runId,
          completedAt: run.completedAt ?? new Date().toISOString(),
          correct: summary.correct,
          total: summary.scoredTotal,
          source: null,
          missedItemIds: summary.missedItemIds,
        }).then(() => queryClient.invalidateQueries({ queryKey: ["review-queue"] }));
      }
    } catch {
      setCountState({ status: "failed" });
    }
    void queryClient.invalidateQueries({ queryKey: DAILY_QUIZ_QUERY_KEY });
  };

  return (
    <>
      <SEO
        title="Daily Quiz | Quizymode"
        description="Five new questions every day. Keep your streak going with Quizymode's free daily quiz."
        canonical="https://www.quizymode.com/daily"
      />
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Daily quiz</h1>
          <p className="mt-1 text-sm text-gray-600">
            The same five questions for everyone today. A new set starts at midnight UTC.
            {data && <span className="ml-1 font-medium text-gray-800">({data.date})</span>}
          </p>
          {data && streak > 0 && (
            <p className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
              🔥 {streakLabel(streak)}
            </p>
          )}
          {!isAuthenticated && !isAuthLoading && (
            <p className="mt-2 text-xs text-gray-500">
              Your streak is saved in this browser only. <Link to="/signup" className="font-semibold text-indigo-ink underline">Sign up</Link> to keep it on every device.
            </p>
          )}
        </header>

        {(isAuthLoading || query.isLoading) && <LoadingSpinner />}

        {query.isError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Today's quiz could not be loaded.{" "}
            <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">
              Try again
            </button>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-surface p-4 text-sm text-gray-700">
            There is no daily quiz today. <Link to="/categories" className="font-semibold text-indigo-ink underline">Browse categories</Link> instead.
          </div>
        )}

        {data && data.items.length > 0 && todaysResult && !started && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="font-semibold text-emerald-900">
              {todaysResult.total - (todaysResult.skipped ?? 0) === 0
                ? "Done for today. No questions were scored"
                : `Done for today: ${todaysResult.correct} / ${todaysResult.total - (todaysResult.skipped ?? 0)}`}
            </p>
            {(todaysResult.skipped ?? 0) > 0 && (
              <p className="mt-1 text-sm text-emerald-800">
                {todaysResult.skipped === 1
                  ? "1 question skipped because the picture was unavailable. Not scored."
                  : `${todaysResult.skipped} questions skipped because the picture was unavailable. Not scored.`}
              </p>
            )}
            <p className="mt-1 text-sm text-emerald-800">Come back tomorrow for a new set. You can practice today's questions again; it won't change your score.</p>
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="mt-3 rounded-md border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              Practice again
            </button>
          </div>
        )}

        {data && data.items.length > 0 && (!todaysResult || started) && (
          <>
            <div aria-live="polite" className="mb-3 text-sm">
              {countState.status === "saving" && <p className="text-gray-600">Saving your result…</p>}
              {countState.status === "counted" && (
                <p className="font-semibold text-emerald-800">Counted for today · {streakLabel(countState.streak)}</p>
              )}
              {countState.status === "practice" && <p className="text-gray-700">Practice run: today's result was already counted.</p>}
              {countState.status === "failed" && (
                <p role="alert" className="text-red-700">Your result could not be saved. Your score below is still correct.</p>
              )}
            </div>
            <FixedSetQuiz
              key={`${data.date}:${identityKey}`}
              items={data.items}
              identityKey={identityKey}
              analytics={{ contextType: "daily", contextId: data.date }}
              browsePath="/categories"
              browseLabel="Browse categories"
              onComplete={(run) => void handleComplete(run)}
              share={(run) =>
                buildDailyShare({
                  date: data.date,
                  results: run.itemIds.map((id) => (run.skipped.includes(id) ? null : run.outcomes[id]?.isCorrect === true)),
                  origin: window.location.origin,
                })
              }
            />
          </>
        )}
      </div>
    </>
  );
};

export default DailyQuizPage;
