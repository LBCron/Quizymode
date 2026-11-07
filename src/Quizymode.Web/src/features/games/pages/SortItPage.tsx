import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircleIcon, HeartIcon as HeartOutlineIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { HeartIcon as HeartSolidIcon } from "@heroicons/react/24/solid";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { createAnalyticsId } from "@/features/analytics/analyticsEvents";
import { celebratePerfectScore } from "@/features/items/quiz/celebrate";
import { BUCKET_DROP_FEEDBACK_MS, BUCKET_DROP_LIVES } from "../gameRoster";
import { SORT_IT_ID } from "../gameRegistry";
import { buildGamePath, gameScopeKey } from "../gameScope";
import { trackGameCompleted, trackGameStarted } from "../gameAnalytics";
import { sortItBestKey, writeBestIfHigher } from "../gameBest";
import { useGameRoster } from "../useGameRoster";
import { GamesEmptyState } from "../GamesEmptyState";
import { GameFinishCard } from "../GameFinishCard";
import { isGameKeyIgnored } from "../gameKeys";
import { GameMisses, type GameMiss } from "../GameMisses";
import { FallingCard } from "../bucketDrop/FallingCard";
import { prefersReducedMotion } from "../bucketDrop/reducedMotion";
import { getFallMs } from "../bucketDrop/bucketDropRun";
import { buildSortItGroups, type SortItGroup } from "../sortIt/sortItPool";
import { createSortItRun, reduceSortItRun, type SortItRunState } from "../sortIt/sortItRun";

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

function bucketGridClass(count: number): string {
  if (count <= 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  return "grid-cols-2 sm:grid-cols-4";
}

function hintText(count: number): string {
  const keys: string = Array.from({ length: count }, (_, index) => String(index + 1)).join(", ");
  return `Tap a group, or press ${keys}.`;
}

const SortItPage = () => {
  const { scope, runIdentityKey, topicBar, topicPrompt, rawItems, isPending, error, refetch, availableModes, handleModeChange, quizPath } = useGameRoster();
  const scopeKey: string = gameScopeKey(scope);
  const runKey = `${runIdentityKey}|${scopeKey}`;
  const groups = useMemo<SortItGroup[]>(() => buildSortItGroups(rawItems), [rawItems]);

  const [runBox, setRunBox] = useState<{ runKey: string; state: SortItRunState } | null>(null);
  const [announcement, setAnnouncement] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [reducedMotion] = useState<boolean>(() => prefersReducedMotion());
  const cardRef = useRef<HTMLDivElement>(null);
  const finishHandledRunIds = useRef(new Set<string>());

  const run: SortItRunState | null = runBox && runBox.runKey === runKey ? runBox.state : null;
  const itemsById = useMemo(
    () => new Map(groups.flatMap((group) => group.items.map((item) => [item.id, item] as const))),
    [groups],
  );

  // The latest state is also kept in a ref, updated synchronously, for handlers that can fire before a render.
  const runRef = useRef<SortItRunState | null>(null);
  const commit = (state: SortItRunState) => {
    runRef.current = state;
    setRunBox({ runKey, state });
  };

  // A new id per event makes the live region re-announce a repeated message.
  const announce = (text: string) => setAnnouncement((current) => ({ id: current.id + 1, text }));

  const startRun = () => {
    commit(createSortItRun(groups, createAnalyticsId()));
    announce("");
    setFinishResult(null);
  };

  // Create the first run (and one for a new scope) once the roster is known.
  useEffect(() => {
    if (run || isPending || error || groups.length === 0) return;
    startRun();
    // startRun only reads values already in this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, isPending, error, groups, scopeKey]);

  const runId: string | undefined = run?.runId;
  const sequence: number | undefined = run?.sequence;
  const status = run?.status;

  /** Reports and stores the result the moment the last life goes, not when the feedback ends. */
  const settle = (previous: SortItRunState, next: SortItRunState) => {
    commit(next);
    if (previous.status === "ready") trackGameStarted(SORT_IT_ID, scope, next.runId, next.poolIds.length);
    const result = next.lastResult;
    if (result?.isCorrect) {
      announce(`Correct. Score ${next.score}.`);
      return;
    }
    const label: string = next.buckets[next.items[next.itemId].bucketIndex];
    announce(
      `${result?.pickedIndex === null ? "Too slow" : "Wrong"}. The group is ${label}. ${livesLeftText(next.lives)}.`,
    );
    if (next.lives <= 0 && !finishHandledRunIds.current.has(next.runId)) {
      finishHandledRunIds.current.add(next.runId);
      trackGameCompleted(SORT_IT_ID, scope, next.runId, next.score, next.answered);
      const best = writeBestIfHigher(sortItBestKey(scopeKey), next.score);
      setFinishResult({ runId: next.runId, best: best.best, isNewBest: best.isNewBest });
    }
  };

  // Reduce against the latest committed state, so a tap or key in the same tick as a landing cannot overwrite it.
  const handlePick = (index: number) => {
    const current = runRef.current;
    if (!run || !current) return;
    const next: SortItRunState = reduceSortItRun(current, { type: "pick", index });
    if (next !== current) settle(current, next);
  };

  const handleLand = () => {
    const current = runRef.current;
    if (!run || !current || current.status !== "playing") return;
    const next: SortItRunState = reduceSortItRun(current, { type: "land" });
    if (next !== current) settle(current, next);
  };

  // After the feedback the next card starts to fall, or the game ends.
  useEffect(() => {
    if (!run || status !== "feedback") return;
    const id = window.setTimeout(() => {
      const next: SortItRunState = reduceSortItRun(run, { type: "next" });
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

  // The card takes focus at run start and with each new drop; never during feedback.
  useEffect(() => {
    if (runId && status !== "finished" && status !== "feedback") cardRef.current?.focus({ preventScroll: true });
  }, [runId, sequence, status]);

  // Keys 1 to N pick a group; higher digits are ignored. Detached once the game is over.
  const bucketCount: number = run?.buckets.length ?? 0;
  useEffect(() => {
    if (!run || status === "finished") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!/^[1-9]$/.test(event.key)) return;
      const index: number = Number(event.key) - 1;
      if (index >= bucketCount) return;
      if (isGameKeyIgnored(event)) return;
      event.preventDefault();
      handlePick(index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // handlePick reads only `run`, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, status, bucketCount]);

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
  } else if (!isPending && groups.length === 0) {
    body = (
      <GamesEmptyState
        quizPath={quizPath}
        heading="No sortable groups here"
        message="Sort It needs 2 to 4 groups with at least 4 short answers each."
      />
    );
  } else if (!run) {
    body = <LoadingSpinner />;
  } else if (run.status === "finished") {
    const result: FinishResult | null = finishResult?.runId === run.runId ? finishResult : null;
    const misses: GameMiss[] = run.missedItemIds.flatMap((id) => {
      const item = itemsById.get(id);
      const data = run.items[id];
      return item && data ? [{ id, question: data.fact, answer: run.buckets[data.bucketIndex] }] : [];
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
    const correctLabel: string = run.buckets[item.bucketIndex];
    body = (
      <section className="mx-auto max-w-2xl rounded-lg bg-surface p-4 shadow sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 tabIndex={-1} className="text-lg font-semibold text-gray-900 focus:outline-none">
            Sort It
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
        <div className="relative mt-4 h-72 touch-none select-none overflow-hidden rounded-lg border-2 border-gray-200 bg-gray-50 sm:h-80">
          <FallingCard
            key={run.sequence}
            question={item.fact}
            revealAnswer={answered && result?.isCorrect === false ? correctLabel : null}
            revealPrefix="Group: "
            caught={answered && result?.isCorrect === true}
            running={run.status === "playing"}
            fallMs={getFallMs(run.score)}
            reducedMotion={reducedMotion}
            onLand={handleLand}
            cardRef={cardRef}
          />
        </div>
        <div className={`mt-3 grid gap-2 sm:gap-3 ${bucketGridClass(run.buckets.length)}`}>
          {run.buckets.map((bucket, index) => {
            const isPicked: boolean = answered && result?.pickedIndex === index;
            const isCorrectBucket: boolean = answered && index === item.bucketIndex;
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
                <span className="line-clamp-3 block [overflow-wrap:anywhere]">
                  <ForeignPhraseText text={bucket} />
                </span>
                {suffix && <span className="sr-only">{suffix}</span>}
                {icon && <span className="absolute right-1 top-1">{icon}</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 min-h-5 text-center text-sm text-gray-500">
          {run.status === "ready" ? hintText(run.buckets.length) : ""}
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

export default SortItPage;
