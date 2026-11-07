import { useEffect, useRef } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";

interface WowCardProps {
  isCorrect: boolean;
  selectedAnswer: string;
  correctAnswer: string;
  /** One short "did you know" line; the block is omitted when empty. */
  wowLine?: string;
  /** "See my score" on the last question, otherwise "Next". */
  isLast: boolean;
  onNext: () => void;
}

/**
 * Starter-quiz answer feedback (#462, AC 3.0.27): the verdict, the correct answer and one short fact in place of the
 * option list. The whole card advances on tap or click; the real Next button is focused so Enter advances exactly once
 * (the study hotkeys ignore events from a focused button). Rendered inside the quiz's polite live region.
 */
export function WowCard({ isCorrect, selectedAnswer, correctAnswer, wowLine, isLast, onNext }: WowCardProps) {
  const nextRef = useRef<HTMLButtonElement>(null);

  // The text is already in the live region when this mounts; focus moves one frame later so it is announced first.
  useEffect(() => {
    const frame = requestAnimationFrame(() => nextRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      data-testid="wow-card"
      onClick={onNext}
      className={`cursor-pointer rounded-lg border-2 p-3 ${
        isCorrect
          ? "border-green-500 bg-green-50 motion-safe:animate-correct-pulse"
          : "border-red-500 bg-red-50 motion-safe:animate-wrong-shake"
      }`}
    >
      <div className="flex items-center gap-2">
        {isCorrect ? (
          <CheckCircleIcon className="h-6 w-6 shrink-0 text-green-600" aria-hidden="true" />
        ) : (
          <XCircleIcon className="h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />
        )}
        <p className="text-base font-semibold text-gray-900">{isCorrect ? "Correct!" : "Not quite."}</p>
      </div>
      {!isCorrect && <p className="mt-1 break-words text-sm text-gray-600">You picked: {selectedAnswer}</p>}
      <p className="mt-1 break-words text-sm font-semibold text-gray-900">
        Answer: <ForeignPhraseText text={correctAnswer} />
      </p>
      {wowLine && (
        <div className="mt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-ink">Did you know?</p>
          <p className="mt-0.5 break-words text-sm text-gray-800">{wowLine}</p>
        </div>
      )}
      <div className="mt-3 flex">
        <button
          ref={nextRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:ml-auto sm:w-auto"
        >
          {isLast ? "See my score" : "Next"}
        </button>
      </div>
    </div>
  );
}
