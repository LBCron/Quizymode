import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { StarIcon } from "@heroicons/react/24/solid";
import type { GhostLine } from "./ghostRun";

interface GameFinishCardProps {
  heading: string;
  bigValue: ReactNode;
  statLine: string;
  /** "Best 23"; null when no best is stored. */
  bestLine: string | null;
  isNewBest: boolean;
  /** How the run compares with the player's ghost; omitted by games without one. */
  ghostLine?: GhostLine;
  hubPath: string;
  onPlayAgain: () => void;
  /** Rendered after the buttons (the misses). */
  children?: ReactNode;
}

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/** Finish screen shared by Swipe Blitz and Survival (AC 3.20.13, 3.20.15). */
export function GameFinishCard({
  heading,
  bigValue,
  statLine,
  bestLine,
  isNewBest,
  ghostLine,
  hubPath,
  onPlayAgain,
  children,
}: GameFinishCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-2xl rounded-lg bg-surface p-4 text-center shadow sm:p-6">
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none">
        {heading}
      </h2>
      <p className="mt-3 text-3xl font-bold text-indigo-ink tabular-nums">{bigValue}</p>
      <p className="mt-1 text-gray-700">{statLine}</p>
      {isNewBest ? (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">
          <StarIcon className="h-4 w-4" aria-hidden="true" />
          New best!
        </p>
      ) : (
        bestLine && <p className="mt-2 text-gray-700">{bestLine}</p>
      )}
      {ghostLine && (
        <p className={`mt-1 text-sm ${ghostLine.tone === "ahead" ? "text-green-800" : "text-gray-700"}`}>{ghostLine.text}</p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
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
      {children}
    </div>
  );
}
