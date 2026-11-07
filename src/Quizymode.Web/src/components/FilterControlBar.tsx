import type { ReactNode } from "react";
/**
 * Compact control bar that replaces the inline FilterSection header.
 * Shows a filter trigger button (with active badge) and optional secondary actions.
 */
import { FunnelIcon, EyeIcon, EyeSlashIcon, SpeakerWaveIcon, PauseIcon } from "@heroicons/react/24/outline";
import type { ListenAllState } from "@/hooks/useListenAll";

interface SortOptionItem {
  value: string;
  label: string;
}

interface FilterControlBarProps {
  hasActiveFilters: boolean;
  /** Number to display in the badge; hidden when 0 or undefined. */
  activeFilterCount?: number;
  onOpenFilters: () => void;
  middleSlot?: ReactNode;
  onOpenMap?: () => void;
  sortBy?: string;
  onSortChange?: (sort: string) => void;
  sortOptions?: SortOptionItem[];
  /** When provided, renders a compact "Show / Hide answers" toggle after the filter button. */
  showAnswers?: boolean;
  onToggleShowAnswers?: () => void;
  /** When provided, renders a "Listen All / Pause / Resume" TTS button. */
  listenAllState?: ListenAllState;
  onListenAll?: () => void;
}

export function FilterControlBar({
  hasActiveFilters,
  activeFilterCount,
  onOpenFilters,
  middleSlot,
  onOpenMap,
  sortBy,
  onSortChange,
  sortOptions,
  showAnswers,
  onToggleShowAnswers,
  listenAllState,
  onListenAll,
}: FilterControlBarProps) {
  const showSort = sortBy != null && onSortChange != null && sortOptions != null && sortOptions.length > 0;

  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 py-2">
      {/* Filter trigger */}
      <button
        type="button"
        onClick={onOpenFilters}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
          hasActiveFilters
            ? "border-indigo-300 bg-indigo-50 text-indigo-ink hover:bg-indigo-100"
            : "border-gray-200 bg-surface text-gray-600 hover:bg-gray-50"
        }`}
      >
        <FunnelIcon className="h-4 w-4" />
        Filters
        {hasActiveFilters && activeFilterCount != null && activeFilterCount > 0 && (
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold leading-none text-white">
            {activeFilterCount}
          </span>
        )}
      </button>

      {onToggleShowAnswers != null && (
        <button
          type="button"
          onClick={onToggleShowAnswers}
          title={showAnswers ? "Hide answers" : "Show answers"}
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
            showAnswers
              ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
              : "border-gray-200 bg-surface text-gray-500 hover:bg-gray-50"
          }`}
        >
          {showAnswers ? (
            <EyeSlashIcon className="h-4 w-4 shrink-0" />
          ) : (
            <EyeIcon className="h-4 w-4 shrink-0" />
          )}
          <span className="hidden sm:inline">{showAnswers ? "Hide answers" : "Show answers"}</span>
        </button>
      )}

      {onListenAll != null && listenAllState != null && (
        <button
          type="button"
          onClick={onListenAll}
          title={
            listenAllState === "idle"
              ? "Listen to all items (TTS)"
              : listenAllState === "playing"
              ? "Pause"
              : "Resume"
          }
          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
            listenAllState !== "idle"
              ? "border-indigo-300 bg-indigo-50 text-indigo-ink hover:bg-indigo-100"
              : "border-gray-200 bg-surface text-gray-500 hover:bg-gray-50"
          }`}
        >
          {listenAllState === "playing" ? (
            <PauseIcon className="h-4 w-4 shrink-0" />
          ) : (
            <SpeakerWaveIcon className="h-4 w-4 shrink-0" />
          )}
          <span className="hidden sm:inline">
            {listenAllState === "idle"
              ? "Listen All"
              : listenAllState === "playing"
              ? "Pause"
              : "Resume"}
          </span>
        </button>
      )}

      {middleSlot}

      {/* Right-side controls */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {onOpenMap != null && (
          <button
            type="button"
            onClick={onOpenMap}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
          >
            Map
          </button>
        )}

        {showSort && (
          <div className="flex items-center gap-1.5">
            <label htmlFor="filter-bar-sort" className="hidden text-sm text-gray-500 sm:block whitespace-nowrap">
              Sort:
            </label>
            <select
              id="filter-bar-sort"
              value={sortBy}
              onChange={(e) => onSortChange!(e.target.value)}
              className="rounded-lg border border-gray-200 bg-surface px-2 py-1.5 text-sm text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-0"
            >
              {sortOptions!.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
