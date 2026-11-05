import { Link } from "react-router-dom";
import type { StarterPoolEntry } from "@/api/starter";
import { trackEventOnce } from "@/features/analytics/analyticsEvents";
import { pickExploreWorlds } from "./composeStarterRun";
import { getStarterWorld } from "./starterWorlds";

interface StarterEndCardsProps {
  /** The finished run's questions in order; the cards come from its worlds. */
  run: StarterPoolEntry[];
  runId: string;
}

/**
 * "Explore next" (#462, AC 3.0.28): three cards from the worlds the player just saw, plus Explore all topics.
 * Each click sends starter_next_clicked once per run (position 1-3 cards, 5 explore all; 4 is Another random five).
 */
export function StarterEndCards({ run, runId }: StarterEndCardsProps) {
  const worlds = pickExploreWorlds(run);
  const track = (position: number, world: string | null) =>
    trackEventOnce(runId, {
      name: "starter_next_clicked",
      runId,
      position,
      contextType: "home",
      contextId: world ? `next:${world}` : "starter",
    });

  return (
    <div className="mt-6 text-left">
      <h3 className="text-base font-semibold text-gray-900">Explore next</h3>
      <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {worlds.map((id, index) => {
          const world = getStarterWorld(id);
          if (!world) return null;
          return (
            <li key={id}>
              <Link
                to={world.target}
                onClick={() => track(index + 1, id)}
                className="block h-full min-h-[44px] rounded-lg border border-gray-200 bg-white p-4 text-left hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span aria-hidden="true" className="text-2xl">{world.emoji}</span>
                <span className="mt-1 block font-semibold text-gray-900">{world.label}</span>
                <span className="mt-0.5 block text-sm text-gray-600">{world.copy}</span>
                <span className="mt-2 block text-sm font-semibold text-indigo-700">{world.cta}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 text-center">
        <Link
          to="/categories"
          onClick={() => track(5, null)}
          className="inline-block rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Explore all topics
        </Link>
      </div>
    </div>
  );
}
