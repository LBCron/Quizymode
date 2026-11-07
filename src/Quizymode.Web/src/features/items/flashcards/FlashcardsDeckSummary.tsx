import { useEffect, useRef, type ReactNode } from "react";
import { SignupPrompt } from "@/features/auth/components/SignupPrompt";
import type { FlashcardSummaryCounts } from "./flashcardDeck";

export interface FlashcardsDeckSummaryProps {
  /** True after a "Study N still-learning cards" round. */
  isLoopRound: boolean;
  counts: FlashcardSummaryCounts;
  onStudyPile: () => void;
  onRestart: () => void;
  /** The page's back link. */
  backContent?: ReactNode;
}

const PRIMARY_BUTTON =
  "rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
const SECONDARY_BUTTON =
  "rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-ink hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/** End-of-deck summary for Flashcards (AC 3.14.8). Counts are per round; the heading takes focus on mount. */
export function FlashcardsDeckSummary({ isLoopRound, counts, onStudyPile, onRestart, backContent }: FlashcardsDeckSummaryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const { gotIt, stillLearning, notGraded } = counts;
  return (
    <div className="mx-auto max-w-4xl">
      <section className="mx-auto max-w-2xl rounded-lg bg-surface p-4 text-center shadow sm:p-6" data-testid="flashcards-summary">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">
          {isLoopRound ? "Round complete" : "Deck complete"}
        </h2>
        <p className="mt-3 text-gray-700">
          {gotIt} got it · {stillLearning} still learning · {notGraded} not graded
        </p>
        {stillLearning === 0 && notGraded === 0 && <p className="mt-2 font-medium text-emerald-700">All caught up. Nice work.</p>}
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          {stillLearning > 0 && (
            <button type="button" onClick={onStudyPile} className={PRIMARY_BUTTON}>
              Study {stillLearning} still-learning {stillLearning === 1 ? "card" : "cards"}
            </button>
          )}
          <button type="button" onClick={onRestart} className={stillLearning > 0 ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
            Restart deck
          </button>
        </div>
        {/* Anonymous visitors only; nothing is written to guest storage (AC 3.14.9). */}
        {stillLearning > 0 && <SignupPrompt reason="review-later" className="mt-6" />}
      </section>
      {backContent && <div className="mt-4 text-center">{backContent}</div>}
    </div>
  );
}
