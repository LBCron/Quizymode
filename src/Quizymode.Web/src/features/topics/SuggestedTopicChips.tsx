import { useId } from "react";
import type { TopicSuggestion } from "@/api/taxonomy";
import type { SuggestionPhase } from "./useTopicSuggestions";
import TopicBreadcrumb from "./TopicBreadcrumb";

export const MAX_CHIPS = 5;

interface SuggestedTopicChipsProps {
  suggestions: TopicSuggestion[];
  phase: SuggestionPhase;
  /** The chips belong to earlier text while newer text is fetched. */
  isRefreshing?: boolean;
  /** Called with the chip and its 1-based position. */
  onPick: (suggestion: TopicSuggestion, position: number) => void;
  /** Optional line under the chips (for example the notes file-type hint). */
  helperText?: string;
}

function chipsHeading(suggestions: TopicSuggestion[]): string {
  return suggestions[0]?.reason === "text" ? "Suggested from your text" : "Common topics";
}

function badgeFor(reason: TopicSuggestion["reason"]): string | null {
  if (reason === "yours") return "Yours";
  if (reason === "popular") return "Popular";
  return null;
}

/**
 * Up to five suggested topic paths. Nothing is ever pre-selected: a chip only does something when clicked. Errors,
 * rate limits and empty answers render nothing, because the suggestions are an optional aid.
 */
const SuggestedTopicChips = ({ suggestions, phase, isRefreshing = false, onPick, helperText }: SuggestedTopicChipsProps) => {
  const headingId = useId();

  if (phase === "hidden" || (phase === "ready" && suggestions.length === 0)) {
    return null;
  }

  if (phase === "initial" || phase === "loading") {
    return (
      <div aria-busy="true" className="min-h-11 space-y-2" data-testid="topic-chips-loading">
        {phase === "loading" && <p className="text-xs text-slate-600">Finding topics…</p>}
        <div className="flex flex-col gap-2" aria-hidden="true">
          {["w-full", "w-4/5", "w-3/5"].map((width) => (
            <div key={width} className={`h-11 rounded-lg bg-slate-100 motion-safe:animate-pulse ${width}`} />
          ))}
        </div>
      </div>
    );
  }

  const shown = suggestions.slice(0, MAX_CHIPS);

  return (
    <div className="min-h-11 space-y-2" aria-busy={isRefreshing}>
      <p id={headingId} className="text-xs font-medium text-slate-600">
        {chipsHeading(shown)}
      </p>
      <div
        role="group"
        aria-labelledby={headingId}
        className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap ${isRefreshing ? "opacity-60" : ""}`}
      >
        {shown.map((suggestion, index) => {
          const badge = badgeFor(suggestion.reason);
          return (
            <button
              key={suggestion.path}
              type="button"
              data-testid="topic-chip"
              onClick={() => onPick(suggestion, index + 1)}
              className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-left text-sm text-slate-900 hover:border-indigo-500 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:w-auto sm:max-w-sm"
            >
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words font-medium">
                  <TopicBreadcrumb parts={[suggestion.categorySlug, suggestion.l1, suggestion.l2]} />
                </span>
                {badge && (
                  <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-800">
                    {badge}
                  </span>
                )}
              </span>
              {suggestion.description && (
                <span className="block truncate text-xs text-slate-600 sm:whitespace-normal">
                  <span className="sr-only">. </span>
                  {suggestion.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {helperText && <p className="text-xs text-slate-600">{helperText}</p>}
    </div>
  );
};

export default SuggestedTopicChips;
