import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ItemResponse } from "@/types/api";
import { QuestionImage } from "@/components/study/QuestionImage";
import { getOptionRationale } from "@/utils/itemSpeech";
import type { QuizRunState } from "./quizRun";
import { summarizeQuizRun } from "./quizRun";
import { formatDuration } from "./test/testSetup";
import { SignupPrompt } from "@/features/auth/components/SignupPrompt";
import { celebratePerfectScore } from "./celebrate";
import { scoreTier, type ResultShareDescriptor } from "./resultShare";
import { ShareResultButton } from "./ShareResultButton";
import type { StudyEventContext } from "./quizAnalytics";

interface QuizCompletionViewProps {
  run: QuizRunState;
  items: ItemResponse[];
  browsePath: string;
  browseLabel: string;
  onReviewMistakes: () => void;
  /** Test only: lists every question in roster order (AC 3.18.8). */
  onReviewAll?: () => void;
  onBackToResults: () => void;
  onPlayAgain: () => void;
  /** What Share result sends; omitted (for example for the review queue) hides the button. */
  share?: ResultShareDescriptor | null;
  /** The run's own analytics context for the share event. */
  analyticsContext?: StudyEventContext;
  /** Starter quiz results (#462, AC 3.0.28): one-line score, "Another random five", and `endExtras` instead of browse. */
  variant?: "default" | "starter";
  /** Starter results: the explore-next cards and the explore-all link, shown under Share result. */
  endExtras?: ReactNode;
}

export function QuizCompletionView({
  run,
  items,
  browsePath,
  browseLabel,
  onReviewMistakes,
  onReviewAll,
  onBackToResults,
  onPlayAgain,
  share,
  analyticsContext,
  variant = "default",
  endExtras,
}: QuizCompletionViewProps) {
  const isStarter = variant === "starter";
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summary = summarizeQuizRun(run);

  useEffect(() => {
    headingRef.current?.focus();
  }, [run.view]);

  // A run with skipped questions is not a "perfect" score: show the plain score with the skipped note.
  const tier = summary.skipped > 0 ? null : scoreTier(summary.percentage, summary.scoredTotal);
  const isPerfect = tier?.id === "perfect";
  const isSummaryView = run.view === "summary";
  const isTest = run.mode === "test";
  const elapsedSec =
    isTest && run.startedAt && run.submittedAt
      ? Math.max(0, Math.round((Date.parse(run.submittedAt) - Date.parse(run.startedAt)) / 1000))
      : null;

  // After the heading has focus: one burst per run for a perfect score.
  useEffect(() => {
    if (isSummaryView && isPerfect) void celebratePerfectScore(run.runId);
  }, [isSummaryView, isPerfect, run.runId]);

  if (run.view === "review" || run.view === "review-all") {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const isReviewAll = run.view === "review-all";
    const listedIds = isReviewAll ? run.itemIds : summary.missedItemIds;
    const unavailableCount = listedIds.filter((itemId) => !itemsById.has(itemId)).length;
    const flagged = new Set(run.flagged);
    const backButton = (
      <button type="button" onClick={onBackToResults} className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
        Back to results
      </button>
    );
    return (
      <section className="mx-auto max-w-4xl rounded-lg bg-white p-4 shadow sm:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">
          {isReviewAll ? "Review all" : "Review mistakes"}
        </h2>
        {isReviewAll && <div className="mt-3">{backButton}</div>}
        <div className="mt-4 space-y-4">
          {listedIds.map((itemId) => {
            const item = itemsById.get(itemId);
            const outcome = run.outcomes[itemId];
            if (!item || (!outcome && !isTest)) return null;
            const position = run.itemIds.indexOf(itemId) + 1;
            return (
              <article key={itemId} className="rounded-lg border border-gray-200 p-4">
                {isTest && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium">
                    <span className="text-gray-600">Question {position}</span>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">
                      {outcome
                        ? outcome.isCorrect
                          ? "Correct"
                          : "Incorrect"
                        : run.skipped.includes(itemId)
                          ? "Not scored (picture unavailable)"
                          : "Not answered"}
                    </span>
                    {flagged.has(itemId) && <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">Flagged</span>}
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <QuestionImage image={item.questionImage} size="xs" />
                  <h3 className="min-w-0 font-semibold text-gray-900">{item.question}</h3>
                </div>
                {outcome && (
                  <p className={`mt-2 text-sm ${outcome.isCorrect ? "text-green-700" : "text-red-700"}`}>
                    <strong>Your answer:</strong> {outcome.selectedAnswer}
                  </p>
                )}
                {outcome && !outcome.isCorrect && getOptionRationale(item.incorrectAnswers, item.incorrectAnswerRationale, outcome.selectedAnswer) && (
                  <p className="mt-1 text-sm text-red-800" data-testid="option-rationale">
                    {getOptionRationale(item.incorrectAnswers, item.incorrectAnswerRationale, outcome.selectedAnswer)}
                  </p>
                )}
                <p className="mt-1 text-sm text-green-700"><strong>Correct answer:</strong> {item.correctAnswer}</p>
                {item.incorrectAnswers.some((_answer, index) => item.incorrectAnswerRationale?.[index]) && (
                  <ul className="mt-2 space-y-1 text-sm text-gray-700" aria-label="Why the other options are wrong">
                    {item.incorrectAnswers.map((answer, index) =>
                      item.incorrectAnswerRationale?.[index] ? (
                        <li key={index}>
                          <strong>{answer}:</strong> {item.incorrectAnswerRationale[index]}
                        </li>
                      ) : null
                    )}
                  </ul>
                )}
                {(item.explanation || item.explanationImage) && (
                  <div className="mt-2 flex items-start gap-3">
                    <QuestionImage image={item.explanationImage} slot="explanation" size="sm" />
                    {item.explanation && <p className="min-w-0 text-sm text-gray-700">{item.explanation}</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {unavailableCount > 0 && (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {unavailableCount} {isReviewAll ? "" : "missed "}{unavailableCount === 1 ? "question is" : "questions are"} no longer available to review. Your completed score has not changed.
          </p>
        )}
        <div className="mt-5">{backButton}</div>
      </section>
    );
  }

  return (
    <section className={`mx-auto ${isStarter ? "max-w-3xl" : "max-w-2xl"} rounded-lg bg-white p-4 text-center shadow sm:p-6`}>
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">
        {isTest ? "Test complete" : "Quiz complete"}
      </h2>
      {isTest && run.submitReason === "timeout" && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Time ran out. Your test was submitted automatically.
        </p>
      )}
      {tier && <p className="mt-2 text-lg font-semibold text-gray-800">{tier.label}</p>}
      {summary.scoredTotal === 0 ? (
        <p className="mt-3 text-xl font-semibold text-gray-800">No questions were scored</p>
      ) : isStarter ? (
        <p className="mt-3 text-2xl font-bold text-indigo-700">
          You got {summary.correct} of {summary.scoredTotal}.
        </p>
      ) : (
        <>
          <p className="mt-3 text-3xl font-bold text-indigo-700">{summary.correct} / {summary.scoredTotal}</p>
          <p className="mt-1 text-gray-700">
            {summary.percentage}% correct · {summary.missedItemIds.length} missed
            {isTest && ` · ${summary.notAnswered} not answered`}
          </p>
        </>
      )}
      {summary.skipped > 0 && (
        <p className="mt-1 text-sm text-gray-600">
          {summary.skipped === 1
            ? "1 question skipped because the picture was unavailable. Not scored."
            : `${summary.skipped} questions skipped because the picture was unavailable. Not scored.`}
        </p>
      )}
      {isTest && elapsedSec !== null && (
        <p className="mt-1 text-sm text-gray-700">
          Time taken {formatDuration(elapsedSec)}
          {run.timeLimitSec !== null && ` of ${formatDuration(run.timeLimitSec)}`}
        </p>
      )}
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
        {isTest && onReviewAll && (
          <button type="button" onClick={onReviewAll} className="rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Review all
          </button>
        )}
        {!isStarter && summary.missedItemIds.length > 0 && (
          <button type="button" onClick={onReviewMistakes} className="rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Review mistakes
          </button>
        )}
        <button
          type="button"
          onClick={onPlayAgain}
          className={
            isPerfect && share && summary.scoredTotal > 0
              ? "rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              : "rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          }
        >
          {isStarter ? "Another random five" : "Play again"}
        </button>
        {share && summary.scoredTotal > 0 && (
          <ShareResultButton
            descriptor={share}
            runId={run.runId}
            score={summary.correct}
            total={summary.scoredTotal}
            context={analyticsContext ?? { contextType: "quiz" }}
            emphasized={isPerfect}
          />
        )}
        {!isStarter && (
          <Link to={browsePath} className="rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            {browseLabel}
          </Link>
        )}
      </div>
      {isStarter && endExtras}
      {isStarter && summary.missedItemIds.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={onReviewMistakes} className="rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Review mistakes
          </button>
        </div>
      )}
      {/* Shown only after the run is complete (never mid-quiz), only to anonymous visitors (AC 4.2.10). */}
      <SignupPrompt reason="save-progress" className="mt-6" />
    </section>
  );
}
