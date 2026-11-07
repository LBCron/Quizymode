import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SEO } from "@/components/SEO";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { reviewQueueApi } from "@/api/learningLoop";
import type { QuizRunState } from "@/features/items/quiz/quizRun";
import { FixedSetQuiz } from "../FixedSetQuiz";
import { BossFightHeader } from "../BossFightHeader";
import { BOSS_FIGHT_MIN_DUE, BossFightOutcome, type BossFollowUp } from "../BossFightOutcome";
import { useReviewAnswers } from "../useReviewAnswers";

export const REVIEW_QUEUE_QUERY_KEY = ["review-queue"] as const;

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** How long the Hit! / Missed flash stays next to the boss HP. */
const BOSS_FLASH_MS = 800;

/**
 * REVIEW-001 (#117): up to 20 due questions the signed-in learner missed before. Each first answer is saved as it is
 * chosen: correct moves the question to a longer interval (1, 3, 7, 14, 30 days, then done), wrong brings it back tomorrow.
 * With 5 or more due the learner can start a boss fight (#358): the same quiz and saves, with HP that drops on correct
 * first answers.
 */
const ReviewQueuePage = () => {
  const { userId } = useAuth();
  const { tally, recordAnswer, settlePending, resetTally } = useReviewAnswers();

  // The roster is frozen for the visit: no refetch while answering, or answered items would vanish mid-run.
  const query = useQuery({
    queryKey: [...REVIEW_QUEUE_QUERY_KEY, "session", userId],
    queryFn: () => reviewQueueApi.get(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // A new visit always loads the current queue; answered items from an earlier visit are not due any more.
    refetchOnMount: "always",
    gcTime: 0,
    retry: 1,
  });

  // Boss fight state. HP and the outcome follow only the first quiz run seen, so Play again does not change them.
  const [bossActive, setBossActive] = useState(false);
  const [answeredAny, setAnsweredAny] = useState(false);
  const [hits, setHits] = useState(0);
  const [flash, setFlash] = useState<{ id: number; kind: "hit" | "miss" } | null>(null);
  const [bossMessage, setBossMessage] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const [outcome, setOutcome] = useState<{ defeated: boolean; hp: number } | null>(null);
  const [followUp, setFollowUp] = useState<BossFollowUp | null>(null);
  const [rematching, setRematching] = useState(false);
  const lockedRunId = useRef<string | null>(null);
  const hitsRef = useRef(0);
  const flashCount = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), BOSS_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flash]);

  // A new id per message makes the live region re-announce a repeated one.
  const announceBoss = (text: string) => setBossMessage((current) => ({ id: current.id + 1, text }));

  const startBoss = () => {
    lockedRunId.current = null;
    hitsRef.current = 0;
    setHits(0);
    setFlash(null);
    announceBoss("");
    setOutcome(null);
    setFollowUp(null);
    setAnsweredAny(false);
    resetTally();
    setBossActive(true);
  };

  const data = query.data;
  const maxHp: number = data?.items.length ?? 0;

  const handleAnswer = (itemId: string, isCorrect: boolean, run: QuizRunState) => {
    void recordAnswer(itemId, isCorrect);
    setAnsweredAny(true);
    if (!bossActive) return;
    lockedRunId.current ??= run.runId;
    if (run.runId !== lockedRunId.current) return;
    if (isCorrect) hitsRef.current += 1;
    setHits(hitsRef.current);
    flashCount.current += 1;
    setFlash({ id: flashCount.current, kind: isCorrect ? "hit" : "miss" });
    announceBoss(`${isCorrect ? "Hit!" : "Missed."} Boss HP ${maxHp - hitsRef.current} of ${maxHp}.`);
  };

  const handleComplete = (run: QuizRunState) => {
    if (!bossActive || run.runId !== lockedRunId.current) return;
    // Questions skipped for an unavailable picture (#403) cannot be hit, so the boss has fewer HP to lose.
    const scoredMax: number = Math.max(0, maxHp - run.skipped.length);
    const hp: number = Math.max(0, scoredMax - hitsRef.current);
    const defeated: boolean = scoredMax > 0 && hp === 0;
    setOutcome({ defeated, hp });
    announceBoss(defeated ? "Boss defeated!" : scoredMax === 0 ? "No questions were scored." : `The boss escaped with ${hp} HP.`);
    setFollowUp({ status: "loading" });
    void (async () => {
      // Wait for the answers still being saved, so the summary reflects them.
      await settlePending();
      try {
        const summary = await reviewQueueApi.getSummary();
        if (mounted.current) setFollowUp({ status: "ready", ...summary });
      } catch {
        if (mounted.current) setFollowUp({ status: "error" });
      }
    })();
  };

  const handleRematch = async () => {
    setRematching(true);
    // Reset first so no frame shows the new questions under the old outcome.
    startBoss();
    try {
      const result = await query.refetch();
      if (!mounted.current) return;
      // A failed refetch keeps the old data; never restart the boss over the finished quiz.
      if (result.isError || !result.data || result.data.items.length === 0 || result.data.dueCount < BOSS_FIGHT_MIN_DUE) setBossActive(false);
    } finally {
      if (mounted.current) setRematching(false);
    }
  };

  return (
    <>
      <SEO title="Review | Quizymode" description="Review the questions you missed." noindex />
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Review</h1>
          <p className="mt-1 text-sm text-gray-600">
            Questions you missed come back the next day. Get one right and it waits longer before returning: 3, 7, 14, then 30 days.
          </p>
        </header>

        {query.isLoading && <LoadingSpinner />}

        {query.isError && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Your review questions could not be loaded.{" "}
            <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">
              Try again
            </button>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-surface p-4 text-sm text-gray-700">
            <p className="font-semibold text-gray-900">Nothing to review right now.</p>
            {data.nextDueAt ? (
              <p className="mt-1">
                {data.totalCount} {data.totalCount === 1 ? "question is" : "questions are"} scheduled. The next one is due{" "}
                {dateFormatter.format(new Date(data.nextDueAt))}.
              </p>
            ) : (
              <p className="mt-1">Questions you miss in a quiz while signed in show up here the next day.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/daily" className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700">
                Play the daily quiz
              </Link>
              <Link to="/categories" className="rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50">
                Browse categories
              </Link>
            </div>
          </div>
        )}

        {data && data.items.length > 0 && (
          <>
            {bossActive ? (
              outcome ? (
                <BossFightOutcome
                  defeated={outcome.defeated}
                  hp={outcome.hp}
                  followUp={followUp}
                  rematching={rematching}
                  onRematch={() => void handleRematch()}
                />
              ) : (
                <BossFightHeader
                  hp={maxHp - hits}
                  maxHp={maxHp}
                  dueCount={data.dueCount}
                  hitCount={hits}
                  flash={flash?.kind ?? null}
                />
              )
            ) : (
              <>
                {data.dueCount >= BOSS_FIGHT_MIN_DUE && !answeredAny && (
                  <div className="mb-3 flex flex-col gap-2 rounded-lg border border-gray-200 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-700">{data.dueCount} due. Ready for a boss fight?</p>
                    <button
                      type="button"
                      onClick={startBoss}
                      className="min-h-[44px] w-full rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-ink hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto"
                    >
                      Boss fight
                    </button>
                  </div>
                )}
                {data.dueCount > data.items.length && (
                  <p className="mb-3 text-sm text-gray-600">
                    Showing {data.items.length} of {data.dueCount} due questions. The rest stay due for your next review.
                  </p>
                )}
              </>
            )}
            <div role="status" aria-live="polite" className="sr-only">
              <span key={bossMessage.id}>{bossMessage.text}</span>
            </div>
            <div aria-live="polite" className="mb-3 text-sm text-gray-700">
              {tally.forward + tally.reset + tally.graduated > 0 && (
                <p>
                  {tally.forward} moved to a longer interval · {tally.reset} back tomorrow
                  {tally.graduated > 0 && ` · ${tally.graduated} done`}
                </p>
              )}
              {tally.failed > 0 && (
                <p role="alert" className="text-red-700">
                  {tally.failed} {tally.failed === 1 ? "answer was" : "answers were"} not saved; {tally.failed === 1 ? "it stays" : "they stay"} due.
                </p>
              )}
            </div>
            <FixedSetQuiz
              key={query.dataUpdatedAt}
              items={data.items}
              identityKey={`user:${userId ?? "unknown"}`}
              analytics={{ contextType: "review" }}
              browsePath="/categories"
              browseLabel="Browse categories"
              onAnswer={(item, isCorrect, run) => handleAnswer(item.id, isCorrect, run)}
              onComplete={handleComplete}
            />
          </>
        )}
      </div>
    </>
  );
};

export default ReviewQueuePage;
