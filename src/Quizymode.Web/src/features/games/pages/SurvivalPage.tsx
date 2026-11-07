import { useEffect, useMemo, useRef, useState } from "react";
import { HeartIcon as HeartOutlineIcon } from "@heroicons/react/24/outline";
import { HeartIcon as HeartSolidIcon } from "@heroicons/react/24/solid";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { createAnalyticsId } from "@/features/analytics/analyticsEvents";
import { celebratePerfectScore } from "@/features/items/quiz/celebrate";
import type { ItemResponse } from "@/types/api";
import { GAME_MIN_ITEMS, SURVIVAL_CORRECT_ADVANCE_MS, SURVIVAL_HEARTS } from "../gameRoster";
import { SURVIVAL_ID } from "../gameRegistry";
import { buildGamePath, gameScopeKey } from "../gameScope";
import { trackGameCompleted, trackGameStarted } from "../gameAnalytics";
import { survivalBestKey, writeBestIfHigher } from "../gameBest";
import {
  compareSurvivalToGhost,
  describeSurvivalGhost,
  ghostProgressAt,
  readGhost,
  survivalGhostKey,
  writeSurvivalGhostIfBetter,
  type GhostLine,
} from "../ghostRun";
import { GhostTrack } from "../GhostTrack";
import { useGameRoster } from "../useGameRoster";
import { GamesEmptyState } from "../GamesEmptyState";
import { GameFinishCard } from "../GameFinishCard";
import { GameMisses, type GameMiss } from "../GameMisses";
import { SurvivalQuestion } from "../survival/SurvivalQuestion";
import { createSurvivalRun, reduceSurvivalRun, type SurvivalRunState } from "../survival/survivalRun";

/** The Next button ignores clicks this long after it appears, so a double tap on an option cannot skip feedback. */
const NEXT_GUARD_MS = 300;

interface FinishResult {
  runId: string;
  best: number;
  isNewBest: boolean;
  ghostLine: GhostLine;
}

/** How often the ghost marker steps while a ghost exists. */
const GHOST_TICK_MS = 250;

function heartsLeftText(hearts: number): string {
  if (hearts <= 0) return "No hearts left";
  return `${hearts} ${hearts === 1 ? "heart" : "hearts"} left`;
}

const SurvivalPage = () => {
  const { scope, runIdentityKey, topicBar, topicPrompt, pool, isPending, error, refetch, availableModes, handleModeChange, quizPath, excludedPictures } = useGameRoster();
  const scopeKey: string = gameScopeKey(scope);
  const runKey = `${runIdentityKey}|${scopeKey}`;

  const [runBox, setRunBox] = useState<{ runKey: string; state: SurvivalRunState } | null>(null);
  const [announcement, setAnnouncement] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const nextShownAt = useRef(0);
  const finishHandledRunIds = useRef(new Set<string>());
  const [ghostMarks, setGhostMarks] = useState<number[] | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const run: SurvivalRunState | null = runBox && runBox.runKey === runKey ? runBox.state : null;
  const itemsById = useMemo(() => new Map<string, ItemResponse>(pool.map((item) => [item.id, item])), [pool]);

  // A new id per event makes the live region re-announce a repeated message.
  const announce = (text: string) => setAnnouncement((current) => ({ id: current.id + 1, text }));

  const startRun = () => {
    setRunBox({ runKey, state: createSurvivalRun(pool, createAnalyticsId()) });
    setGhostMarks(readGhost(survivalGhostKey(scopeKey)));
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
  const lastWasCorrect: boolean | null = run?.lastAnswer ? run.lastAnswer.isCorrect : null;

  const handleAnswer = (option: string) => {
    if (!run) return;
    const now: number = Date.now();
    const next: SurvivalRunState = reduceSurvivalRun(run, { type: "answer", option, nowMs: now });
    if (next === run) return;
    setNowMs(now);
    setRunBox({ runKey, state: next });
    if (run.status === "ready") trackGameStarted(SURVIVAL_ID, scope, next.runId, next.poolIds.length);
    if (next.lastAnswer?.isCorrect) {
      announce(`Correct. Streak ${next.streak}.`);
      return;
    }
    announce(`Wrong. ${heartsLeftText(next.hearts)}.`);
    if (next.hearts <= 0 && !finishHandledRunIds.current.has(next.runId)) {
      // The third heart is lost: report and store the best streak now, not when See results is pressed.
      finishHandledRunIds.current.add(next.runId);
      trackGameCompleted(SURVIVAL_ID, scope, next.runId, next.correct, next.answered);
      const result = writeBestIfHigher(survivalBestKey(scopeKey), next.longestStreak);
      const endMs: number = Math.max(0, now - (next.startedAtMs ?? now));
      const ghostLine: GhostLine = describeSurvivalGhost(
        ghostMarks ? compareSurvivalToGhost(ghostMarks, next.correct, endMs) : null,
        endMs,
      );
      writeSurvivalGhostIfBetter(survivalGhostKey(scopeKey), next.correctMarksMs);
      setFinishResult({ runId: next.runId, best: result.best, isNewBest: result.isNewBest, ghostLine });
    }
  };

  const handleNext = () => {
    if (!run || run.status !== "feedback") return;
    if (Date.now() - nextShownAt.current < NEXT_GUARD_MS) return;
    const next: SurvivalRunState = reduceSurvivalRun(run, { type: "next" });
    setRunBox({ runKey, state: next });
    if (next.status === "finished") {
      const result: FinishResult | null = finishResult?.runId === next.runId ? finishResult : null;
      announce(
        `Game over. Streak ${next.longestStreak}.${result?.isNewBest ? " New best!" : ""}${result ? ` ${result.ghostLine.text}` : ""}`,
      );
      if (result?.isNewBest) void celebratePerfectScore(next.runId);
    }
  };

  // The ghost marker steps while there is a ghost to race and the run is under way.
  const startedAtMs: number | null = run?.startedAtMs ?? null;
  const ghostRunning: boolean = ghostMarks !== null && startedAtMs !== null && (status === "playing" || status === "feedback");
  useEffect(() => {
    if (!ghostRunning) return;
    const id = window.setInterval(() => setNowMs(Date.now()), GHOST_TICK_MS);
    return () => window.clearInterval(id);
  }, [ghostRunning, runId]);

  // A correct answer moves on by itself.
  useEffect(() => {
    if (status !== "feedback" || lastWasCorrect !== true) return;
    const id = window.setTimeout(() => {
      setRunBox((current) =>
        current ? { ...current, state: reduceSurvivalRun(current.state, { type: "next" }) } : current,
      );
    }, SURVIVAL_CORRECT_ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [status, lastWasCorrect, runId, sequence]);

  // A wrong answer waits for Next / See results, which takes focus so the revealed answer can be read first.
  useEffect(() => {
    if (status === "feedback" && lastWasCorrect === false) {
      nextShownAt.current = Date.now();
      nextRef.current?.focus();
    }
  }, [status, lastWasCorrect, runId, sequence]);

  // The question takes focus on each new question.
  useEffect(() => {
    if (runId && status !== "finished" && status !== "feedback") questionRef.current?.focus({ preventScroll: true });
  }, [runId, sequence, status]);

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
          heading="Game over"
          bigValue={`Streak ${run.longestStreak}`}
          statLine={`${run.correct} of ${run.answered} right`}
          bestLine={result.best > 0 ? `Best streak ${result.best}` : null}
          isNewBest={result.isNewBest}
          ghostLine={result.ghostLine}
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
    const ghostCount: number =
      ghostMarks && run.startedAtMs !== null ? ghostProgressAt(ghostMarks, Math.max(0, nowMs - run.startedAtMs)) : 0;
    const showNext: boolean = answered && run.lastAnswer?.isCorrect === false;
    body = (
      <section className="mx-auto max-w-2xl rounded-lg bg-surface p-4 shadow sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">
            Survival
          </h1>
          <div className="flex items-center gap-3">
            <span
              role="img"
              aria-label={`${run.hearts} of ${SURVIVAL_HEARTS} hearts left`}
              className="flex gap-0.5"
            >
              {Array.from({ length: SURVIVAL_HEARTS }, (_, index) =>
                index < run.hearts ? (
                  <HeartSolidIcon key={index} className="h-6 w-6 text-red-600" aria-hidden="true" />
                ) : (
                  <HeartOutlineIcon key={index} className="h-6 w-6 text-gray-300" aria-hidden="true" />
                ),
              )}
            </span>
            <span className="text-sm font-semibold text-gray-800 tabular-nums sm:text-base">Streak {run.streak}</span>
          </div>
        </div>
        {ghostMarks && (
          <GhostTrack
            yours={run.correct}
            ghost={ghostCount}
            scale={Math.max(ghostMarks.length, run.correct, 1)}
            label={`Ghost: ${ghostCount}`}
          />
        )}
        <SurvivalQuestion
          question={item.question}
          options={run.options}
          correctAnswer={item.correctAnswer}
          picked={answered ? (run.lastAnswer?.option ?? null) : null}
          onAnswer={handleAnswer}
          questionRef={questionRef}
        />
        {showNext && (
          <div className="sm:flex sm:justify-end">
            <button
              ref={nextRef}
              type="button"
              onClick={handleNext}
              className="mt-4 min-h-[48px] w-full rounded-md bg-indigo-600 px-6 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto"
            >
              {run.hearts <= 0 ? "See results" : "Next"}
            </button>
          </div>
        )}
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

export default SurvivalPage;
