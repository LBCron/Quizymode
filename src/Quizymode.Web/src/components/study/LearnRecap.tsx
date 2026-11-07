import { useEffect, useRef } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { MasteryProgress } from "./MasteryProgress";
import { QuestionImage } from "./QuestionImage";
import type { ItemImageReference } from "@/types/api";

export type LearnRecapStatus = "mastered" | "one-more" | "missed";

export interface LearnRecapRow {
  itemId: string;
  question: string;
  questionImage?: ItemImageReference | null;
  status: LearnRecapStatus;
}

interface LearnRecapProps {
  roundNumber: number;
  rows: LearnRecapRow[];
  mastered: number;
  total: number;
  caption?: string | null;
  onContinue: () => void;
  onStartOver: () => void;
}

const STATUS_TEXT: Record<LearnRecapStatus, string> = {
  mastered: "Mastered",
  "one-more": "Got it, 1 more to go",
  missed: "Missed, coming back",
};

/** Between-rounds recap (AC 3.17.6): the round's correct count and a text status for every item. */
export function LearnRecap({ roundNumber, rows, mastered, total, caption, onContinue, onStartOver }: LearnRecapProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [roundNumber]);

  const correct = rows.filter((row) => row.status !== "missed").length;

  return (
    <div className="space-y-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 focus:outline-none">
        Round {roundNumber} complete
      </h2>
      <p className="text-gray-700">
        {correct} of {rows.length} correct. Mastered {mastered} of {total} so far.
      </p>
      <MasteryProgress mastered={mastered} total={total} caption={caption} />
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {rows.map((row) => (
          <li key={row.itemId} className="flex items-center gap-3 px-3 py-2 text-sm">
            {row.status === "missed" ? (
              <XCircleIcon className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            ) : (
              <CheckCircleIcon className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
            )}
            <QuestionImage itemId={row.itemId} image={row.questionImage} size="xs" />
            <span className="min-w-0 flex-1 truncate sm:whitespace-normal" title={row.question}>
              {row.question}
            </span>
            <span className="shrink-0 font-medium text-gray-700">{STATUS_TEXT[row.status]}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onStartOver}
          className="self-start text-sm text-gray-500 underline hover:text-gray-700"
        >
          Start over
        </button>
        <button
          type="button"
          onClick={onContinue}
          aria-keyshortcuts="Enter"
          className="w-full rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
