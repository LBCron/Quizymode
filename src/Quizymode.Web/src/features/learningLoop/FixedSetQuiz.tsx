import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ItemResponse } from "@/types/api";
import { useStudyHotkeys } from "@/components/study/useStudyHotkeys";
import { StudyHotkeysDialog } from "@/components/study/StudyHotkeysDialog";
import { QUIZ_SHORTCUTS } from "@/components/study/studyShortcuts";
import { StudyHotkeysHint } from "@/components/study/StudyHotkeysHint";
import { QuizRenderer } from "@/components/study/QuizRenderer";
import { useQuestionPictureStatuses } from "@/components/study/pictureGate";
import { usePreloadNextPicture } from "@/components/study/preloadPicture";
import { WowCard } from "@/features/starter/WowCard";
import { QuizCompletionView } from "@/features/items/quiz/QuizCompletionView";
import type { ResultShareDescriptor } from "@/features/items/quiz/resultShare";
import {
  createQuizRun,
  getQuizOptions,
  reduceQuizRun,
  summarizeQuizRun,
  type QuizRunState,
} from "@/features/items/quiz/quizRun";
import {
  flushDeferredAnalyticsEvents,
  trackEventDeferredOnce,
  trackEventOnce,
  type AnalyticsContextType,
} from "@/features/analytics/analyticsEvents";

export interface FixedSetQuizAnalytics {
  contextType: Extract<AnalyticsContextType, "daily" | "review" | "home">;
  contextId?: string;
}

export interface FixedSetQuizProps {
  /** Frozen roster: the run never refetches or reorders it. */
  items: ItemResponse[];
  identityKey: string;
  analytics: FixedSetQuizAnalytics;
  browsePath: string;
  browseLabel: string;
  /** Called once per item per run with the first (scored) answer. */
  onAnswer?: (item: ItemResponse, isCorrect: boolean, run: QuizRunState) => void;
  /** Called once per run when every item has an answer. */
  onComplete?: (run: QuizRunState) => void;
  /** Builds the Share result descriptor for the finished run; omitted for the review queue (no Share). */
  share?: (run: QuizRunState) => ResultShareDescriptor | null;
  /**
   * Starter quiz (#462): answer feedback is a short wow card (verdict, answer, one fact from `wowLines` by item id)
   * instead of the option list and explanation, Previous is hidden, and the results screen uses the starter layout.
   */
  feedback?: "wow";
  wowLines?: Record<string, string>;
  /** Called once per item the first time its question is shown. */
  onQuestionShown?: (item: ItemResponse) => void;
  /** Starter results: the "explore next" content shown under the score. */
  endExtras?: (run: QuizRunState) => ReactNode;
  /** Starter results: replaces the local reset behind the primary "Another random five" button. */
  onRestart?: (run: QuizRunState) => void;
}

function newRun(items: ItemResponse[], identityKey: string): QuizRunState {
  return createQuizRun(
    { kind: "global", category: null, navigationKeywords: [], filterKeywords: [], quizSize: items.length },
    items.map((item) => item.id),
    identityKey,
  );
}

/**
 * A quiz over a fixed list of items (daily quiz, review queue). Same answer-locking, scoring, results and mistake
 * review as the main quiz (AC 3.6.8–3.6.11), without per-item URLs. Analytics use the run's own context type so these
 * runs are reported separately from category, collection and unscoped quizzes.
 */
export function FixedSetQuiz({
  items,
  identityKey,
  analytics,
  browsePath,
  browseLabel,
  onAnswer,
  onComplete,
  share,
  feedback,
  wowLines,
  onQuestionShown,
  endExtras,
  onRestart,
}: FixedSetQuizProps) {
  const [run, setRun] = useState<QuizRunState>(() => newRun(items, identityKey));
  const [index, setIndex] = useState(0);
  const completedRunIds = useRef(new Set<string>());
  const questionHeadingRef = useRef<HTMLParagraphElement>(null);
  const item = items[index];
  const summary = summarizeQuizRun(run);
  const outcome = item ? run.outcomes[item.id] : undefined;
  // #403: answers stay off until the question's picture has loaded; a skipped question is never answerable again.
  const pictures = useQuestionPictureStatuses();
  const isSkipped = item ? run.skipped.includes(item.id) : false;
  const pictureBlocked = pictures.isBlocked(item) || isSkipped;
  usePreloadNextPicture(items[index + 1]);
  const options = useMemo(() => (item ? getQuizOptions(item, run.runId) : []), [item, run.runId]);
  const context = analytics.contextId
    ? { contextType: analytics.contextType, contextId: analytics.contextId }
    : { contextType: analytics.contextType };

  useEffect(() => {
    trackEventOnce(run.runId, { name: "quick_quiz_started", runId: run.runId, total: run.itemIds.length, ...context });
    // context is derived from props that do not change during a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.runId]);

  const isWow = feedback === "wow";
  const shownItemIds = useRef(new Set<string>());
  useEffect(() => {
    if (!item || shownItemIds.current.has(item.id)) return;
    shownItemIds.current.add(item.id);
    onQuestionShown?.(item);
    // Fires when the displayed question changes; the callback identity is not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(() => {
    if (!summary.isComplete || summary.scoredTotal === 0 || completedRunIds.current.has(run.runId)) return;
    completedRunIds.current.add(run.runId);
    flushDeferredAnalyticsEvents();
    trackEventOnce(run.runId, {
      name: "quiz_completed",
      runId: run.runId,
      score: summary.correct,
      total: summary.scoredTotal,
      ...context,
    });
    onComplete?.(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.isComplete, run.runId]);

  const handleAnswer = (answer: string) => {
    if (!item || outcome || pictureBlocked) return;
    const isCorrect = answer === item.correctAnswer;
    const next = reduceQuizRun(run, {
      type: "answer",
      itemId: item.id,
      selectedAnswer: answer,
      isCorrect,
      completedAt: new Date().toISOString(),
    });
    setRun(next);
    trackEventDeferredOnce(`${run.runId}:${item.id}`, {
      name: "question_answered",
      runId: run.runId,
      itemId: item.id,
      position: index + 1,
      isCorrect,
      ...context,
    });
    onAnswer?.(item, isCorrect, next);
  };

  /** Leaves a question whose picture will not load; it is not scored and the quiz moves on (#403). */
  const handleSkipUnavailable = () => {
    if (!item || outcome || isSkipped) return;
    setRun((current) =>
      reduceQuizRun(current, { type: "skip-unavailable", reason: pictures.isBlocked(item) ? "picture-unavailable" : "picture-inaccessible", itemId: item.id, completedAt: new Date().toISOString() }),
    );
    if (!isLast) goTo(index + 1);
  };

  const goTo = (nextIndex: number) => {
    setIndex(nextIndex);
    requestAnimationFrame(() => questionHeadingRef.current?.focus());
  };

  const isLast = index === items.length - 1;
  const isActive = run.view === "active" && !!item;
  const handled = Boolean(outcome) || isSkipped;
  const canGoNext = !isLast && handled;
  const advance = () => {
    if (summary.isComplete) setRun((current) => reduceQuizRun(current, { type: "show-summary" }));
    else if (canGoNext) goTo(index + 1);
  };
  const { isHelpOpen, openHelp, closeHelp } = useStudyHotkeys({
    enabled: true,
    letter: isActive && !outcome && !pictureBlocked ? (i) => options[i] !== undefined && handleAnswer(options[i]) : undefined,
    digit: isActive && !outcome && !pictureBlocked ? (n) => options[n - 1] !== undefined && handleAnswer(options[n - 1]) : undefined,
    prev: isActive && !isWow && index > 0 ? () => goTo(index - 1) : undefined,
    next: isActive && !summary.isComplete && canGoNext ? () => goTo(index + 1) : undefined,
    enter: isActive && handled ? advance : undefined,
  });
  const helpDialog = <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={isActive ? QUIZ_SHORTCUTS : []} />;

  if (run.view !== "active") {
    return (
      <>
      <QuizCompletionView
        run={run}
        items={items}
        browsePath={browsePath}
        browseLabel={browseLabel}
        onReviewMistakes={() => setRun((current) => reduceQuizRun(current, { type: "review-mistakes" }))}
        onBackToResults={() => setRun((current) => ({ ...current, view: "summary" }))}
        onPlayAgain={() => {
          if (onRestart) {
            onRestart(run);
            return;
          }
          setRun(newRun(items, identityKey));
          setIndex(0);
        }}
        {...(isWow ? { variant: "starter" as const } : {})}
        {...(isWow && endExtras ? { endExtras: endExtras(run) } : {})}
        share={run.view === "summary" ? share?.(run) : null}
        analyticsContext={context}
      />
      {helpDialog}
      </>
    );
  }

  if (!item) return null;

  return (
    <section className="mx-auto max-w-2xl rounded-lg bg-white p-4 shadow sm:p-6" aria-label="Quiz">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
        <p ref={questionHeadingRef} tabIndex={-1} className="font-semibold text-gray-800 focus:outline-none" aria-live="polite">
          Question {index + 1} of {items.length}
        </p>
        <div className="flex items-center gap-2">
          <p>
            {summary.correct} correct · {summary.answered} answered
            {summary.skipped > 0 && ` · ${summary.skipped} skipped`}
          </p>
          <StudyHotkeysHint onClick={openHelp} />
        </div>
      </div>
      <QuizRenderer
        item={item}
        options={options}
        selectedAnswer={outcome?.selectedAnswer ?? null}
        showAnswer={Boolean(outcome)}
        onAnswerSelect={handleAnswer}
        stats={{ total: summary.answered, correct: summary.correct }}
        questionPicture={{
          ...pictures.controlsFor(item, isSkipped ? undefined : handleSkipUnavailable),
          blocked: pictureBlocked,
        }}
        {...(isWow
          ? {
              answerPanel: outcome ? (
                <WowCard
                  key={item.id}
                  isCorrect={outcome.isCorrect}
                  selectedAnswer={outcome.selectedAnswer}
                  correctAnswer={item.correctAnswer}
                  wowLine={wowLines?.[item.id] ?? ""}
                  isLast={isLast}
                  onNext={advance}
                />
              ) : null,
            }
          : {})}
      />
      {/* Wow mode: the card holds Next. Only a last question skipped for its picture still needs a way to the score. */}
      {isWow && !(summary.isComplete && !outcome) ? null : (
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          hidden={isWow}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Previous
        </button>
        {summary.isComplete ? (
          <button
            type="button"
            onClick={() => setRun((current) => reduceQuizRun(current, { type: "show-summary" }))}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            View results
          </button>
        ) : (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={isLast || !handled}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Next
          </button>
        )}
      </div>
      )}
      {helpDialog}
    </section>
  );
}
