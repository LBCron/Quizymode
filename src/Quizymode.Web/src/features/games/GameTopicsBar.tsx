import { Link, useLocation } from "react-router-dom";
import { homeCategoryCards } from "@/features/home/homePageData";
import { useTopicEditor } from "@/features/interests/topicEditorContext";
import { topicLabel } from "@/features/interests/topicPaths";
import { GAMES } from "./gameRegistry";
import { buildGamePath, type GameScope } from "./gameScope";
import type { GameTopicResolution } from "./gameTopicResolution";

const names = new Map(homeCategoryCards.map(card => [card.slug, card.name]));
const buttonClass = "inline-flex min-h-[44px] items-center justify-center rounded-md border border-indigo-600 px-3 py-2 text-sm font-semibold text-indigo-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export function GameTopicsBar({ scope, resolution, unavailable }: { scope: GameScope; resolution: GameTopicResolution; unavailable: string[] }) {
  const editor = useTopicEditor();
  const location = useLocation();
  const gameId = GAMES.find(game => game.id === location.pathname.split("/")[2])?.id;
  const allPath = buildGamePath({ kind: "global", filterKeywords: [], search: "?all=1" }, gameId);
  const label = scope.kind === "topics" ? `My topics: ${scope.topics.map(path => topicLabel(path, names)).join(", ")}` :
    scope.kind === "category" ? `${topicLabel([scope.category, ...scope.navigationKeywords].join("/"), names)}${scope.filterKeywords.length ? ` · Keywords: ${scope.filterKeywords.join(", ")}` : ""}` :
    scope.kind === "collection" ? (scope.collectionName ?? "Collection") :
    resolution.mode === "loading" ? "Loading your topics…" : resolution.mode === "error" ? "My topics unavailable" :
    resolution.mode === "choose" ? "No topics chosen" : scope.kind === "global" && scope.filterKeywords.length ? `Keywords: ${scope.filterKeywords.join(", ")}` : "All topics";
  return (
    <section aria-label="Game topics" className="mx-auto mt-4 max-w-4xl rounded-lg bg-surface px-4 py-3 text-sm shadow">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 break-words font-medium text-gray-900">{label}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={editor.open} className={buttonClass}>Change topics</button>
          <Link to={buildGamePath({ kind: "global", filterKeywords: [] }, gameId)} className={buttonClass}>Play My topics</Link>
          <Link to={allPath} className={buttonClass}>All topics</Link>
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-600">{resolution.mode === "explicit" ? "This link uses its own scope. Open My topics to play your saved choices." : "Topic edits apply when you open another game. This game's topics stay fixed."}</p>
      {unavailable.length > 0 && <p role="status" className="mt-2 text-sm text-amber-800">No playable questions in: {unavailable.map(path => topicLabel(path, names)).join(", ")}.{scope.kind === "topics" && unavailable.length < scope.topics.length ? " Other selected topics are still available." : " Choose different topics or explicitly play all topics."}</p>}
    </section>
  );
}

export function GameTopicsPrompt({ mode, onRetry }: { mode: "choose" | "error"; onRetry: () => void }) {
  const editor = useTopicEditor();
  const location = useLocation();
  const gameId = GAMES.find(game => game.id === location.pathname.split("/")[2])?.id;
  return (
    <section className="mx-auto mt-4 max-w-4xl rounded-lg bg-surface p-6 text-center shadow">
      <h1 className="text-xl font-bold text-gray-900">{mode === "error" ? "Your topics could not be loaded." : "Choose topics for your games"}</h1>
      <p className="mt-2 text-sm text-gray-600">Choose the subjects you want to play, or explicitly play all topics.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {mode === "error" && <button type="button" onClick={onRetry} className={buttonClass}>Retry topics</button>}
        <button type="button" onClick={editor.open} className={buttonClass}>Choose topics</button>
        <Link to={buildGamePath({ kind: "global", filterKeywords: [], search: "?all=1" }, gameId)} className={buttonClass}>Play all topics</Link>
      </div>
    </section>
  );
}
