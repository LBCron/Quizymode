import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import { starterApi } from "@/api/starter";
import { useAuth } from "@/contexts/AuthContext";
import { HOME_SAMPLE_COLLECTION_ID, HOME_SAMPLE_COLLECTION_NAME } from "@/features/home/homePageData";
import { createAnalyticsId, trackEventOnce } from "@/features/analytics/analyticsEvents";
import { recordGuestCompletion } from "@/features/guestHistory/guestHistoryStorage";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";
import { summarizeQuizRun, type QuizCompletionSnapshot, type QuizRunState } from "@/features/items/quiz/quizRun";
import { buildGlobalShare } from "@/features/items/quiz/resultShare";
import { FixedSetQuiz } from "@/features/learningLoop/FixedSetQuiz";
import { buildCollectionStudyPath } from "@/utils/collectionPath";
import { composeStarterRun, STARTER_RUN_SIZE } from "./composeStarterRun";
import { readStarterSeen, markStarterSeen } from "./starterSeen";
import { StarterEndCards } from "./StarterEndCards";

export const STARTER_POOL_QUERY_KEY = ["starter-pool"] as const;
const STILL_LOADING_MS = 4000;
const GIVE_UP_MS = 8000;

/** Run history keeps no browsable source (the five questions are a random mix, AC 3.0.29): a non-GUID collection id has none. */
const STARTER_HISTORY_SCOPE = { kind: "collection", collectionId: "starter" } as const;

/**
 * /start (#462, AC 3.0.2): a five-question quiz composed in the browser from the seed-managed starter pool, with a short
 * "did you know" card after each answer and explore-next cards at the end. Any problem with the pool (request failure,
 * invalid body, fewer than five usable questions, or more than 8 seconds) sends the visitor to the legacy quick quiz.
 */
const StarterQuizPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: isAuthLoading, userId } = useAuth();
  const identityKey = isAuthenticated ? `user:${userId ?? "unknown"}` : "guest";
  const [nonce, setNonce] = useState<string>(() => createAnalyticsId());
  const [stillLoading, setStillLoading] = useState(false);
  const fallenBack = useRef(false);

  const query = useQuery({
    queryKey: STARTER_POOL_QUERY_KEY,
    queryFn: () => starterApi.getPool(),
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });

  // Reads the seen list when the run is composed, so a new run avoids what the last one showed.
  const run = useMemo(
    () => (query.data ? composeStarterRun(query.data.items, readStarterSeen(), nonce) : null),
    [query.data, nonce],
  );

  const fallbackNeeded = query.isError || (run !== null && run.length < STARTER_RUN_SIZE);
  useEffect(() => {
    if (!fallbackNeeded || fallenBack.current) return;
    fallenBack.current = true;
    navigate(buildCollectionStudyPath("quiz", HOME_SAMPLE_COLLECTION_ID, HOME_SAMPLE_COLLECTION_NAME), { replace: true });
  }, [fallbackNeeded, navigate]);

  const waiting = !run && !fallbackNeeded;
  useEffect(() => {
    if (!waiting) return;
    const slow = window.setTimeout(() => setStillLoading(true), STILL_LOADING_MS);
    const giveUp = window.setTimeout(() => {
      if (fallenBack.current) return;
      fallenBack.current = true;
      navigate(buildCollectionStudyPath("quiz", HOME_SAMPLE_COLLECTION_ID, HOME_SAMPLE_COLLECTION_NAME), { replace: true });
    }, GIVE_UP_MS);
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(giveUp);
    };
  }, [waiting, navigate]);

  const wowLines = useMemo(
    () => Object.fromEntries((run ?? []).map((entry) => [entry.item.id, entry.wowLine])),
    [run],
  );

  const handleComplete = (finished: QuizRunState) => {
    const summary = summarizeQuizRun(finished);
    if (summary.scoredTotal === 0) return;
    const snapshot: QuizCompletionSnapshot = {
      runId: finished.runId,
      scope: STARTER_HISTORY_SCOPE,
      completedAt: finished.completedAt ?? new Date().toISOString(),
      correct: summary.correct,
      total: summary.scoredTotal,
      missedItemIds: summary.missedItemIds,
    };
    // Same rules as the main quiz (AC 3.6.13/3.6.14), with no practice link because the mix is random.
    recordGuestCompletion(snapshot, {
      isAuthenticated,
      isAuthLoading,
      runIdentityKey: finished.identityKey,
      currentIdentityKey: identityKey,
    });
    if (isAuthenticated && !isAuthLoading && finished.identityKey === identityKey) {
      void recordAuthenticatedCompletion(snapshot).then(() => queryClient.invalidateQueries({ queryKey: ["review-queue"] }));
    }
  };

  const handleRestart = (finished: QuizRunState) => {
    trackEventOnce(finished.runId, {
      name: "starter_next_clicked",
      runId: finished.runId,
      position: 4,
      contextType: "home",
      contextId: "starter",
    });
    setNonce(createAnalyticsId());
  };

  return (
    <>
      <SEO
        title="Play a 5-question quiz"
        description="Five quick questions, from flags to space to AI. Then pick what to explore next."
        canonical="https://www.quizymode.com/start"
        noindex
      />
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
        {run && run.length >= STARTER_RUN_SIZE && !isAuthLoading ? (
          <FixedSetQuiz
            key={`${nonce}:${identityKey}`}
            items={run.map((entry) => entry.item)}
            identityKey={identityKey}
            analytics={{ contextType: "home", contextId: "starter" }}
            browsePath="/categories"
            browseLabel="Explore all topics"
            feedback="wow"
            wowLines={wowLines}
            onQuestionShown={(item) => markStarterSeen([item.id])}
            onComplete={handleComplete}
            onRestart={handleRestart}
            endExtras={(finished) => <StarterEndCards run={run} runId={finished.runId} />}
            share={(finished) => {
              const summary = summarizeQuizRun(finished);
              return buildGlobalShare({ correct: summary.correct, total: summary.scoredTotal, origin: window.location.origin });
            }}
          />
        ) : (
          <div role="status" className="mx-auto max-w-2xl">
            <span className="sr-only">Loading your quiz</span>
            <div aria-hidden="true" className="h-64 animate-pulse rounded-lg bg-white p-4 shadow" />
            <p className="mt-3 text-center text-sm text-gray-600">Getting your five questions ready...</p>
            {stillLoading && <p className="mt-1 text-center text-sm text-gray-600">Still loading. One moment.</p>}
          </div>
        )}
      </div>
    </>
  );
};

export default StarterQuizPage;
