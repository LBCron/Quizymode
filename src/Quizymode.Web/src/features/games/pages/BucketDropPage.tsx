import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { CheckCircleIcon, HeartIcon as HeartOutlineIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { HeartIcon as HeartSolidIcon } from "@heroicons/react/24/solid";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { createAnalyticsId } from "@/features/analytics/analyticsEvents";
import { celebratePerfectScore } from "@/features/items/quiz/celebrate";
import type { ItemResponse } from "@/types/api";
import { BUCKET_DROP_FEEDBACK_MS, BUCKET_DROP_LIVES, GAME_MIN_ITEMS, buildBucketDropPool } from "../gameRoster";
import { BUCKET_DROP_ID } from "../gameRegistry";
import { buildGamePath, gameScopeKey } from "../gameScope";
import { trackGameCompleted, trackGameStarted } from "../gameAnalytics";
import { bucketDropBestKey, writeBestIfHigher } from "../gameBest";
import { useGameRoster } from "../useGameRoster";
import { GamesEmptyState } from "../GamesEmptyState";
import { GameFinishCard } from "../GameFinishCard";
import { isGameKeyIgnored } from "../gameKeys";
import { GameMisses, type GameMiss } from "../GameMisses";
import { FallingCard } from "../bucketDrop/FallingCard";
import { prefersReducedMotion } from "../bucketDrop/reducedMotion";
import { classifyBucketSwipe } from "../bucketDrop/bucketGesture";
import {
  createBucketDropRun,
  getFallMs,
  reduceBucketDropRun,
  type BucketDropRunState,
} from "../bucketDrop/bucketDropRun";

interface FinishResult {
  runId: string;
  best: number;
  isNewBest: boolean;
}

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

function livesLeftText(lives: number): string {
  if (lives <= 0) return "No lives left";
  return `${lives} ${lives === 1 ? "life" : "lives"} left`;
}

const BucketDropPage = () => {
  const { scope, runIdentityKey, topicBar, topicPrompt, pool: gamePool, isPending, error, refetch, availableModes, handleModeChange, quizPath, excludedPictures } = useGameRoster();
  const scopeKey: string = gameScopeKey(scope);
  const runKey = `${runIdentityKey}|${scopeKey}`;
  const pool = useMemo<ItemResponse[]>(() => buildBucketDropPool(gamePool), [gamePool]);

  const [runBox, setRunBox] = useState<{ runKey: string; state: BucketDropRunState } | null>(null);
  const [announcement, setAnnouncement] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [reducedMotion] = useState<boolean>(() => prefersReducedMotion());
  const cardRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const finishHandledRunIds = useRef(new Set<string>());

  const run: BucketDropRunState | null = runBox && runBox.runKey === runKey ? runBox.state : null;
  const itemsById = useMemo(() => new Map<string, ItemResponse>(pool.map((item) => [item.id, item])), [pool]);

  // The latest state is also kept in a ref, updated synchronously, for handlers that can fire before a render.
  const runRef = useRef<BucketDropRunState | null>(null);
  const commit = (state: BucketDropRunState) => {
    runRef.current = state;
    setRunBox({ runKey, state });
  };

  // A new id per event makes the live region re-announce a repeated message.
  const announce = (text: string) => setAnnouncement((current) => ({ id: current.id + 1, text }));

  const startRun = () => {
    commit(createBucketDropRun(pool, createAnalyticsId()));
    announce("");
    setFinishResult(null);
  };

  // Create the first run (and one for a new scope) once the roster is known.
  useEffect(() => {
    if (run || isPending || error || pool.length < GAME_MIN_ITEMS) return;
    startRun();
    // startRun only reads values already in this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, isPending, error, pool, scopeKey, runKey]);

  const runId: string | undefined = run?.runId;
  const sequence: number | undefined = run?.sequence;
  const status = run?.status;

  /** Reports and stores the result the moment the last life goes, not when the feedback ends. */
  const settle = (previous: BucketDropRunState, next: BucketDropRunState) => {
    commit(next);
    if (previous.status === "ready") trackGameStarted(BUCKET_DROP_ID, scope, next.runId, next.poolIds.length);
    const result = next.lastResult;
    if (result?.isCorrect) {
      announce(`Correct. Score ${next.score}.`);
      return;
    }
    announce(`${result?.pickedIndex === null ? "Too slow" : "Wrong"}. ${livesLeftText(next.lives)}.`);
    if (next.lives <= 0 && !finishHandledRunIds.current.has(next.runId)) {
      finishHandledRunIds.current.add(next.runId);
      trackGameCompleted(BUCKET_DROP_ID, scope, next.runId, next.score, next.answered);
      const best = writeBestIfHigher(bucketDropBestKey(scopeKey), next.score);
      setFinishResult({ runId: next.runId, best: best.best, isNewBest: best.isNewBest });
    }
  };

  // Reduce against the latest committed state, so a tap or key in the same tick as a landing cannot overwrite it.
  const handlePick = (index: number) => {
    const current = runRef.current;
    if (!run || !current) return;
    const next: BucketDropRunState = reduceBucketDropRun(current, { type: "pick", index });
    if (next !== current) settle(current, next);
  };

  const handleLand = () => {
    const current = runRef.current;
    if (!run || !current || current.status !== "playing") return;
    const next: BucketDropRunState = reduceBucketDropRun(current, { type: "land" });
    if (next !== current) settle(current, next);
  };

  // After the feedback the next card starts to fall, or the game ends.
  useEffect(() => {
    if (!run || status !== "feedback") return;
    const id = window.setTimeout(() => {
      const next: BucketDropRunState = reduceBucketDropRun(run, { type: "next" });
      commit(next);
      if (next.status === "finished") {
        const result: FinishResult | null = finishResult?.runId === next.runId ? finishResult : null;
        announce(`Game over. Score ${next.score}.${result?.isNewBest ? " New best!" : ""}`);
        if (result?.isNewBest) void celebratePerfectScore(next.runId);
      }
    }, BUCKET_DROP_FEEDBACK_MS);
    return () => window.clearTimeout(id);
    // run is the feedback state for this runId and sequence; the others are read when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, runId, sequence]);

  // The question card takes focus at run start and with each new drop; never during feedback.
  useEffect(() => {
    if (runId && status !== "finished" && status !== "feedback") cardRef.current?.focus({ preventScroll: true });
  }, [runId, sequence, status]);

  // Keys 1-3 pick a bucket. Detached once the game is over so they stop being captured.
  useEffect(() => {
    if (!run || status === "finished") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "1" && event.key !== "2" && event.key !== "3") return;
      if (isGameKeyIgnored(event)) return;
      event.preventDefault();
      handlePick(Number(event.key) - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // handlePick reads only `run`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, status]);

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const origin = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!origin || !touch) return;
    const bucket = classifyBucketSwipe(touch.clientX - origin.x, touch.clientY - origin.y);
    if (bucket) handlePick(bucket - 1);
  };

  const scopeBar = (
    <ScopeSecondaryBar
      scopeType={scope.kind === "collection" ? "collection" : "category"}
      activeMode="games"
      availableModes={availableModes}
      onModeChange={handleModeChange}
    />
  );
  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      <span key={announcement.id}>{announcement.text}</span>
    </div>
  );

  let body;
  if (topicPrompt) {
    body = topicPrompt;
  } else if (error) {
    body = (
      <div role="alert" className="mx-auto mt-4 max-w-4xl">
        <ErrorMessage message="We couldn't load this game." onRetry={refetch} />
      </div>
    );
  } else if (!isPending && pool.length < GAME_MIN_ITEMS) {
    body = <GamesEmptyState quizPath={quizPath} excludedPictures={excludedPictures} poolEmpty={gamePool.length === 0} />;
  } else if (!run) {
    body = <LoadingSpinner />;
  } else if (run.status === "finished") {
    const result: FinishResult | null = finishResult?.runId === run.runId ? finishResult : null;
    const misses: GameMiss[] = run.missedItemIds.flatMap((id) => {
      const item: ItemResponse | undefined = itemsById.get(id);
      return item ? [{ id, question: item.question, answer: item.correctAnswer }] : [];
    });
    body = result && (
      <div className="mt-4">
        <GameFinishCard
          heading="Game over"
          bigValue={
            <>
              <span className="sr-only">Score </span>
              {run.score}
            </>
          }
          statLine={`${run.score} of ${run.answered} right`}
          bestLine={result.best > 0 ? `Best ${result.best}` : null}
          isNewBest={result.isNewBest}
          hubPath={buildGamePath(scope)}
          onPlayAgain={startRun}
        >
          <GameMisses runId={run.runId} misses={misses} />
        </GameFinishCard>
      </div>
    );
  } else {
    const item = run.items[run.itemId];
    const answered: boolean = run.status === "feedback";
    const result = run.lastResult;
    body = (
      <section className="mx-auto max-w-2xl rounded-lg bg-surface p-4 shadow sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">
            Bucket Drop
          </h1>
          <div className="flex items-center gap-3">
            <span role="img" aria-label={`${run.lives} of ${BUCKET_DROP_LIVES} lives left`} className="flex gap-0.5">
              {Array.from({ length: BUCKET_DROP_LIVES }, (_, index) =>
                index < run.lives ? (
                  <HeartSolidIcon key={index} className="h-6 w-6 text-red-600" aria-hidden="true" />
                ) : (
                  <HeartOutlineIcon key={index} className="h-6 w-6 text-gray-300" aria-hidden="true" />
                ),
              )}
            </span>
            <span className="text-sm font-semibold text-gray-800 tabular-nums sm:text-base">Score {run.score}</span>
          </div>
        </div>
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => {
            touchStart.current = null;
          }}
          className="relative mt-4 h-72 touch-none select-none overflow-hidden rounded-lg border-2 border-gray-200 bg-gray-50 sm:h-80"
        >
          <FallingCard
            key={run.sequence}
            question={item.question}
            revealAnswer={answered && result?.isCorrect === false ? item.correctAnswer : null}
            caught={answered && result?.isCorrect === true}
            running={run.status === "playing"}
            fallMs={getFallMs(run.score)}
            reducedMotion={reducedMotion}
            onLand={handleLand}
            cardRef={cardRef}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
          {run.buckets.map((bucket, index) => {
            const isPicked: boolean = answered && result?.pickedIndex === index;
            const isCorrectBucket: boolean = answered && bucket === item.correctAnswer;
            let style = "border-gray-300 bg-surface hover:bg-gray-50";
            let suffix = "";
            let icon = null;
            if (isPicked && isCorrectBucket) {
              style = "border-green-500 bg-green-100 text-green-900 motion-safe:animate-correct-pulse";
              suffix = " Correct";
              icon = <CheckCircleIcon className="h-5 w-5 text-green-600" aria-hidden="true" />;
            } else if (isPicked) {
              style = "border-red-500 bg-red-100 text-red-900";
              suffix = " Wrong";
              icon = <XCircleIcon className="h-5 w-5 text-red-600" aria-hidden="true" />;
            } else if (isCorrectBucket) {
              style = "border-green-500 bg-green-100 text-green-900";
              suffix = " Right answer";
              icon = <CheckCircleIcon className="h-5 w-5 text-green-600" aria-hidden="true" />;
            } else if (answered) {
              style = "border-gray-300 bg-surface opacity-60";
            }
            return (
              <button
                key={`${run.sequence}-${index}`}
                type="button"
                title={bucket}
                aria-keyshortcuts={String(index + 1)}
                aria-disabled={answered || undefined}
                onClick={() => {
                  if (!answered) handlePick(index);
                }}
                className={`relative min-h-[64px] rounded-lg border-2 px-2 py-2 text-sm font-semibold [overflow-wrap:anywhere] sm:min-h-[72px] sm:text-base ${style} ${
                  answered ? "cursor-default" : ""
                } ${RING}`}
              >
                <span className="sr-only">{index + 1}. </span>
                <span aria-hidden="true" className="mb-1 block text-xs font-normal text-gray-500">
                  {index + 1}
                </span>
                <span className="line-clamp-3 block">
                  <ForeignPhraseText text={bucket} />
                </span>
                {suffix && <span className="sr-only">{suffix}</span>}
                {icon && <span className="absolute right-1 top-1">{icon}</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 min-h-5 text-center text-sm text-gray-500">
          {run.status === "ready" ? "Tap a bucket, or press 1, 2, 3." : ""}
        </p>
      </section>
    );
  }

  return (
    <div className="py-3 sm:py-4">
      {scopeBar}
      {topicBar}
      {liveRegion}
      <div className={run && run.status !== "finished" && !error ? "mt-4" : undefined}>{body}</div>
    </div>
  );
};

export default BucketDropPage;
