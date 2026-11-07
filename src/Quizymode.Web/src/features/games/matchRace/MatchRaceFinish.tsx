import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { StarIcon } from "@heroicons/react/24/solid";
import type { GhostLine } from "../ghostRun";
import { formatGameTime } from "./matchRaceRun";

interface MatchRaceFinishProps {
  elapsedMs: number;
  bestMs: number;
  isNewBest: boolean;
  ghostLine: GhostLine;
  hubPath: string;
  onPlayAgain: () => void;
}

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export function MatchRaceFinish({ elapsedMs, bestMs, isNewBest, ghostLine, hubPath, onPlayAgain }: MatchRaceFinishProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-2xl rounded-lg bg-surface p-4 text-center shadow sm:p-6">
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">
        Done!
      </h2>
      <p className="mt-3 text-3xl font-bold text-indigo-ink tabular-nums">{formatGameTime(elapsedMs)}</p>
      {isNewBest ? (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
          <StarIcon className="h-4 w-4" aria-hidden="true" />
          New best!
        </p>
      ) : (
        <p className="mt-2 text-gray-700">Best {formatGameTime(bestMs)}</p>
      )}
      <p className={`mt-1 text-sm ${ghostLine.tone === "ahead" ? "text-green-800" : "text-gray-700"}`}>{ghostLine.text}</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onPlayAgain}
          className={`min-h-[44px] w-full rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 sm:w-auto ${RING}`}
        >
          Play again
        </button>
        <Link
          to={hubPath}
          className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 sm:w-auto ${RING}`}
        >
          Back to games
        </Link>
      </div>
    </div>
  );
}
