import { Link } from "react-router-dom";

export type BossFollowUp =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; dueCount: number; nextDueAt: string | null };

interface BossFightOutcomeProps {
  defeated: boolean;
  hp: number;
  followUp: BossFollowUp | null;
  /** True while the next fight's questions are loading. */
  rematching: boolean;
  onRematch: () => void;
}

/** A boss fight needs this many due questions to be offered. */
export const BOSS_FIGHT_MIN_DUE = 5;

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

function followUpLine(followUp: BossFollowUp): string | null {
  if (followUp.status === "error") return null;
  if (followUp.status === "loading") return "Checking...";
  if (followUp.dueCount >= BOSS_FIGHT_MIN_DUE) return "Another boss is ready now.";
  if (followUp.dueCount > 0) return `${followUp.dueCount} still due.`;
  return followUp.nextDueAt ? `Next boss arrives ${dateFormatter.format(new Date(followUp.nextDueAt))}.` : "No boss scheduled.";
}

/** How a boss fight ended and when the next one comes (AC 3.14.12). The results below it stay available. */
export function BossFightOutcome({ defeated, hp, followUp, rematching, onRematch }: BossFightOutcomeProps) {
  const line: string | null = followUp ? followUpLine(followUp) : null;
  const canRematch: boolean =
    followUp?.status === "ready" && followUp.dueCount >= BOSS_FIGHT_MIN_DUE;

  return (
    <div className="mb-3 rounded-lg bg-surface p-4 text-center shadow">
      <h2 tabIndex={-1} className={`text-2xl font-bold focus:outline-none ${defeated ? "text-green-800" : "text-gray-900"}`}>
        {defeated ? "Boss defeated!" : `The boss escaped with ${hp} HP`}
      </h2>
      {line && (
        <p role={followUp?.status === "loading" ? "status" : undefined} className="mt-2 text-sm text-gray-700">
          {line}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          to="/categories"
          className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 sm:w-auto ${RING}`}
        >
          Browse categories
        </Link>
        <Link
          to="/daily"
          className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 sm:w-auto ${RING}`}
        >
          Play the daily quiz
        </Link>
        {canRematch && (
          <button
            type="button"
            aria-disabled={rematching}
            onClick={() => {
              if (!rematching) onRematch();
            }}
            className={`min-h-[44px] w-full rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-ink hover:bg-indigo-50 sm:w-auto ${
              rematching ? "cursor-not-allowed opacity-60" : ""
            } ${RING}`}
          >
            Boss fight
          </button>
        )}
      </div>
    </div>
  );
}
