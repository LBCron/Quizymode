import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { SignupPrompt } from "@/features/auth/components/SignupPrompt";

interface LearnFinishProps {
  total: number;
  firstTryCorrect: number;
  firstTryPercentage: number;
  missedCount: number;
  /** Questions skipped because their picture was unavailable (#403); not scored. */
  skippedCount?: number;
  isAuthenticated: boolean;
  browsePath: string;
  browseLabel: string;
  /** "failed" shows the retry line; "saved" confirms the review queue when there were misses. */
  saveState: "idle" | "saving" | "saved" | "failed";
  onLearnAgain: () => void;
  onRetrySave: () => void;
}

/** Finish screen (AC 3.17.6, 3.17.9): mastered total, first-try score, Learn again and the browse link. */
export function LearnFinish({
  total,
  firstTryCorrect,
  firstTryPercentage,
  missedCount,
  skippedCount = 0,
  isAuthenticated,
  browsePath,
  browseLabel,
  saveState,
  onLearnAgain,
  onRetrySave,
}: LearnFinishProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="mx-auto max-w-2xl rounded-lg bg-surface p-4 text-center shadow sm:p-6">
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">
        {total === 0 ? "No questions were scored" : <>You&apos;ve mastered all {total} {total === 1 ? "item" : "items"}</>}
      </h2>
      {total > 0 && (
        <>
          <p className="mt-3 text-3xl font-bold text-indigo-ink">
            First try: {firstTryCorrect} / {total}
          </p>
          <p className="mt-1 text-gray-700">{firstTryPercentage}% right first time</p>
        </>
      )}
      {skippedCount > 0 && (
        <p className="mt-1 text-sm text-gray-600">
          {skippedCount === 1
            ? "1 question skipped because the picture was unavailable. Not scored."
            : `${skippedCount} questions skipped because the picture was unavailable. Not scored.`}
        </p>
      )}
      {isAuthenticated && saveState === "saved" && missedCount > 0 && (
        <p role="status" className="mt-3 text-sm text-gray-700">
          Misses were added to your review queue.
        </p>
      )}
      {isAuthenticated && saveState === "failed" && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          We couldn&apos;t save this session. Your results are shown above.{" "}
          <button type="button" onClick={onRetrySave} className="font-medium underline">
            Try again
          </button>
        </p>
      )}
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onLearnAgain}
          className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Learn again
        </button>
        <Link
          to={browsePath}
          className="rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {browseLabel}
        </Link>
      </div>
      <SignupPrompt reason="save-progress" className="mt-6" />
    </section>
  );
}
