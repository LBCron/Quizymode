import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { createAnalyticsId } from "@/features/analytics/analyticsEvents";
import { celebratePerfectScore } from "@/features/items/quiz/celebrate";
import type { ItemResponse } from "@/types/api";
import { GAME_MIN_ITEMS, SWIPE_BLITZ_ROUND_MS, SWIPE_REVEAL_MS } from "../gameRoster";
import { SWIPE_BLITZ_ID } from "../gameRegistry";
import { buildGamePath, gameScopeKey } from "../gameScope";
import { trackGameCompleted, trackGameStarted } from "../gameAnalytics";
import { swipeBlitzBestKey, writeBestIfHigher } from "../gameBest";
import { useGameRoster } from "../useGameRoster";
import { GamesEmptyState } from "../GamesEmptyState";
import { GameFinishCard } from "../GameFinishCard";
import { GameMisses, type GameMiss } from "../GameMisses";
import { SwipeCard } from "../swipeBlitz/SwipeCard";
import {
  createSwipeBlitzRun,
  formatCountdown,
  getRemainingMs,
  reduceSwipeBlitzRun,
  type SwipeBlitzRunState,
  type SwipeChoice,
} from "../swipeBlitz/swipeBlitzRun";
import type { SwipeDirection } from "../swipeBlitz/swipeGesture";

const TICK_MS = 100;
const LOW_TIME_MS = 10_000;
const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

interface FinishResult {
  runId: string;
  best: number;
  isNewBest: boolean;
}

/** Arrow keys are game controls, but not while typing, composing or with a modifier (AC 3.20.11). */
function isArrowTargetIgnored(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.repeat) return true;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return true;
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target instanceof Element && target.closest('[role="dialog"]')) return true;
  const tag: string = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

const SwipeBlitzPage = () => {
  const { scope, runIdentityKey, topicBar, topicPrompt, pool, isPending, error, refetch, availableModes, handleModeChange, quizPath, excludedPictures } = useGameRoster();
  const scopeKey: string = gameScopeKey(scope);
  const runKey = `${runIdentityKey}|${scopeKey}`;

  const [runBox, setRunBox] = useState<{ runKey: string; state: SwipeBlitzRunState } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [announcement, setAnnouncement] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const wrongButtonRef = useRef<HTMLButtonElement>(null);
  const rightButtonRef = useRef<HTMLButtonElement>(null);
  /** Where focus goes after a decision: the card, or (keyboard activation) stays on the pressed button. */
  const focusTarget = useRef<"card" | "button">("card");
  const finishHandledRunIds = useRef(new Set<string>());
  const lowTimeAnnouncedRunIds = useRef(new Set<string>());

  const run: SwipeBlitzRunState | null = runBox && runBox.runKey === runKey ? runBox.state : null;
  const itemsById = useMemo(() => new Map<string, ItemResponse>(pool.map((item) => [item.id, item])), [pool]);

  // A new id per event makes the live region re-announce a repeated message.
  const announce = (text: string) => setAnnouncement((current) => ({ id: current.id + 1, text }));

  const startRun = () => {
    focusTarget.current = "card";
    setRunBox({ runKey, state: createSwipeBlitzRun(pool, createAnalyticsId()) });
    setNowMs(Date.now());
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
  const status = run?.status;
  const hasReveal: boolean = !!run?.reveal;
  const sequence: number | undefined = run?.sequence;

  const finishRun = (finished: SwipeBlitzRunState) => {
    if (finishHandledRunIds.current.has(finished.runId)) return;
    finishHandledRunIds.current.add(finished.runId);
    trackGameCompleted(SWIPE_BLITZ_ID, scope, finished.runId, finished.score, finished.decisions);
    const result = writeBestIfHigher(swipeBlitzBestKey(scopeKey), finished.score);
    setFinishResult({ runId: finished.runId, best: result.best, isNewBest: result.isNewBest });
    announce(`Time's up. Score ${finished.score}.${result.isNewBest ? " New best!" : ""}`);
    if (result.isNewBest) void celebratePerfectScore(finished.runId);
  };

  const commit = (previous: SwipeBlitzRunState, next: SwipeBlitzRunState, now: number) => {
    setNowMs(now);
    setRunBox({ runKey, state: next });
    if (previous.startedAtMs === null && next.startedAtMs !== null) {
      trackGameStarted(SWIPE_BLITZ_ID, scope, next.runId, next.poolIds.length);
    }
    if (next.status === "finished") finishRun(next);
  };

  const decide = (choice: SwipeChoice) => {
    if (!run || run.status === "finished") return;
    const now: number = Date.now();
    const next: SwipeBlitzRunState = reduceSwipeBlitzRun(run, { type: "decide", choice, nowMs: now });
    if (next === run) return;
    commit(run, next, now);
    if (next.status === "finished") return;
    announce(next.reveal ? "Missed. Answer shown." : `Score ${next.score}.`);
  };

  // Time runs on the wall clock, also while the tab is hidden; this ends the round once it has passed.
  const checkTime = () => {
    if (!run || run.status !== "playing") return;
    const now: number = Date.now();
    setNowMs(now);
    const next: SwipeBlitzRunState = reduceSwipeBlitzRun(run, { type: "time-up", nowMs: now });
    if (next !== run) commit(run, next, now);
    else if (
      getRemainingMs(run, now) <= LOW_TIME_MS &&
      !lowTimeAnnouncedRunIds.current.has(run.runId)
    ) {
      lowTimeAnnouncedRunIds.current.add(run.runId);
      announce("10 seconds left.");
    }
  };

  // The clock ticks only while playing; re-created with each state so it always sees the latest run.
  useEffect(() => {
    if (status !== "playing") return;
    const id = window.setInterval(checkTime, TICK_MS);
    return () => window.clearInterval(id);
    // checkTime reads only `run`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Back in a visible tab: recheck the deadline immediately.
  useEffect(() => {
    if (status !== "playing") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") checkTime();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // checkTime reads only `run`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // A miss shows the answer for a second, then the next card.
  useEffect(() => {
    if (!hasReveal) return;
    const id = window.setTimeout(() => {
      setRunBox((current) =>
        current ? { ...current, state: reduceSwipeBlitzRun(current.state, { type: "end-reveal" }) } : current,
      );
    }, SWIPE_REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [hasReveal, runId, sequence]);

  // Focus the card at run start, after each non-miss decision and when a reveal ends; never during a reveal.
  useEffect(() => {
    if (!runId || status === "finished" || hasReveal) return;
    if (focusTarget.current === "card") cardRef.current?.focus({ preventScroll: true });
  }, [runId, sequence, hasReveal, status]);

  // Arrow keys decide. Detached once the round is over so they scroll the Misses list again.
  useEffect(() => {
    if (!run || status === "finished") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isArrowTargetIgnored(event)) return;
      event.preventDefault();
      const active = document.activeElement;
      const onButton: boolean = active === wrongButtonRef.current || active === rightButtonRef.current;
      focusTarget.current = onButton ? "button" : "card";
      decide(event.key === "ArrowRight" ? "correct" : "wrong");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // decide reads only `run`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, status]);

  const handleButton = (choice: SwipeChoice) => (event: MouseEvent<HTMLButtonElement>) => {
    if (!run || run.status === "finished" || run.reveal) return;
    // detail 0 = keyboard activation (Enter/Space): keep focus on the button so the next press lands there.
    focusTarget.current = event.detail === 0 ? "button" : "card";
    decide(choice);
  };

  const handleSwipe = (direction: SwipeDirection) => {
    focusTarget.current = "card";
    decide(direction === "right" ? "correct" : "wrong");
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
    body = <GamesEmptyState quizPath={quizPath} excludedPictures={excludedPictures} poolEmpty={pool.length === 0} />;
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
          heading="Time's up!"
          bigValue={
            <>
              <span className="sr-only">Score </span>
              {run.score}
            </>
          }
          statLine={`${run.score} of ${run.decisions} right`}
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
    const remainingMs: number = getRemainingMs(run, nowMs);
    const low: boolean = run.startedAtMs !== null && remainingMs <= LOW_TIME_MS;
    const item: ItemResponse | undefined = itemsById.get(run.card.itemId);
    const locked: boolean = !!run.reveal;
    const buttonBase = `flex min-h-[56px] items-center justify-center gap-2 rounded-lg border-2 text-base font-semibold ${RING} ${
      locked ? "cursor-not-allowed opacity-50" : ""
    }`;
    body = (
      <section className="mx-auto max-w-2xl rounded-lg bg-surface p-4 shadow sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">
            Swipe Blitz
          </h1>
          <p className="text-sm text-gray-700 tabular-nums sm:text-base">
            <span aria-label={`Score ${run.score}`}>Score {run.score}</span> ·{" "}
            <span aria-hidden="true" className={low ? "font-semibold text-red-700" : undefined}>
              {formatCountdown(remainingMs)}
            </span>
          </p>
        </div>
        <div aria-hidden="true" className="mt-2 h-1.5 rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full ${low ? "bg-red-600" : "bg-indigo-600"}`}
            style={{ width: `${(remainingMs / SWIPE_BLITZ_ROUND_MS) * 100}%` }}
          />
        </div>
        <div className="mt-4">
          {item && (
            <SwipeCard
              cardRef={cardRef}
              question={item.question}
              shownAnswer={run.card.shownAnswer}
              revealAnswer={run.reveal ? item.correctAnswer : null}
              onSwipe={handleSwipe}
            />
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            ref={wrongButtonRef}
            type="button"
            aria-disabled={locked}
            aria-keyshortcuts="ArrowLeft"
            onClick={handleButton("wrong")}
            className={`${buttonBase} border-red-300 bg-red-50 text-red-800 hover:bg-red-100`}
          >
            <ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
            Wrong
          </button>
          <button
            ref={rightButtonRef}
            type="button"
            aria-disabled={locked}
            aria-keyshortcuts="ArrowRight"
            onClick={handleButton("correct")}
            className={`${buttonBase} border-green-300 bg-green-50 text-green-800 hover:bg-green-100`}
          >
            Right
            <ArrowRightIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-3 min-h-5 text-center text-sm text-gray-500">
          {run.status === "ready" ? "Clock starts on your first pick." : ""}
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

export default SwipeBlitzPage;
