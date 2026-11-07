import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";

export type MatchTileState = "idle" | "selected" | "wrong" | "matched";

interface MatchTileProps {
  text: string;
  state: MatchTileState;
  onSelect: () => void;
}

const BASE_CLASS =
  "relative w-full min-h-[44px] rounded-lg border-2 px-2 py-2 text-left text-sm leading-snug [overflow-wrap:anywhere] sm:px-4 sm:py-3 sm:text-base " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 " +
  "motion-safe:transition-colors motion-safe:duration-150";

const STATE_CLASS: Record<MatchTileState, string> = {
  idle: "bg-surface border-gray-300 hover:bg-gray-50",
  selected: "bg-indigo-50 border-indigo-600 font-semibold text-indigo-ink border-l-8",
  wrong: "bg-red-100 border-red-500 pr-7 motion-safe:animate-wrong-shake",
  matched: "bg-green-100 border-green-500 text-green-900 cursor-default pr-7",
};

/** One question or answer tile. A matched tile stays in place, inert and keeping focus (AC 3.20.7). */
export function MatchTile({ text, state, onSelect }: MatchTileProps) {
  const matched: boolean = state === "matched";
  return (
    <button
      type="button"
      aria-pressed={matched ? undefined : state === "selected"}
      aria-disabled={matched ? true : undefined}
      tabIndex={matched ? -1 : undefined}
      onClick={() => {
        if (!matched) onSelect();
      }}
      className={`${BASE_CLASS} ${STATE_CLASS[state]}`}
    >
      <ForeignPhraseText text={text} />
      {state === "wrong" && (
        <>
          <XCircleIcon className="absolute right-1 top-2 h-5 w-5 text-red-600" aria-hidden="true" />
          <span className="sr-only"> Wrong</span>
        </>
      )}
      {matched && (
        <>
          <CheckCircleIcon className="absolute right-1 top-2 h-5 w-5 text-green-600" aria-hidden="true" />
          <span className="sr-only"> Matched</span>
        </>
      )}
    </button>
  );
}
