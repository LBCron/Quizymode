import { FilterPanel } from "./FilterSection";
import type { RatingRangeFilter } from "../../types/filters";
import { StarIcon } from "@heroicons/react/24/outline";

const MIN = 1;
const MAX = 5;

const thumbStyles =
  "absolute w-full h-5 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-surface [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-300 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:hover:border-indigo-400 [&::-webkit-slider-thumb]:transition-colors [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-surface [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-slate-300 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:hover:border-indigo-400";

interface RatingFilterProps {
  value: RatingRangeFilter;
  onChange: (value: RatingRangeFilter) => void;
  onRemove: () => void;
}

export const RatingFilter = ({
  value,
  onChange,
  onRemove,
}: RatingFilterProps) => {
  const minVal = value.min ?? MIN;
  const maxVal = value.max ?? MAX;
  const onlyUnrated = value.onlyUnrated ?? false;
  const includeUnrated = value.includeUnrated ?? false;
  const hasRange = value.min !== null || value.max !== null;

  const handleMinInput = (n: number) => {
    const newMin = Math.max(MIN, Math.min(n, maxVal));
    onChange({ ...value, min: newMin, max: value.max ?? MAX });
  };

  const handleMaxInput = (n: number) => {
    const newMax = Math.min(MAX, Math.max(n, minVal));
    onChange({ ...value, min: value.min ?? MIN, max: newMax });
  };

  const handleClearRange = () => {
    onChange({ ...value, min: null, max: null });
  };

  const handleOnlyUnrated = (checked: boolean) => {
    onChange({ ...value, onlyUnrated: checked });
  };

  const handleIncludeUnrated = (checked: boolean) => {
    onChange({ ...value, includeUnrated: checked });
  };

  const pct = (v: number) => ((v - MIN) / (MAX - MIN)) * 100;

  return (
    <FilterPanel label="Rating" onRemove={onRemove}>
      <div className="space-y-4">
        {/* Only unrated toggle */}
        <label className="flex items-center gap-3 cursor-pointer group">
          <span className="relative inline-flex h-5 w-9 flex-shrink-0">
            <input
              type="checkbox"
              checked={onlyUnrated}
              onChange={(e) => handleOnlyUnrated(e.target.checked)}
              className="sr-only peer"
            />
            <span className="absolute inset-0 rounded-full bg-slate-200 transition-colors peer-focus:ring-2 peer-focus:ring-indigo-500/30 peer-focus:ring-offset-1 peer-checked:bg-indigo-500" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform peer-checked:translate-x-4" />
          </span>
          <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
            Only items with no rating
          </span>
        </label>

        {/* Range slider (disabled when only unrated) */}
        <div className={`space-y-3 ${onlyUnrated ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="relative h-6 flex items-center px-0.5">
            <div
              className="absolute inset-x-0 h-2 rounded-full bg-slate-100"
              style={{ top: "50%", transform: "translateY(-50%)" }}
              aria-hidden
            />
            <div
              className="absolute h-2 rounded-full bg-indigo-500/90 transition-[left,width] duration-150 ease-out"
              style={{
                top: "50%",
                transform: "translateY(-50%)",
                left: `${pct(minVal)}%`,
                width: `${Math.max(pct(maxVal) - pct(minVal), 4)}%`,
              }}
              aria-hidden
            />
            <input
              type="range"
              min={MIN}
              max={MAX}
              step={1}
              value={minVal}
              onChange={(e) => handleMinInput(Number(e.target.value))}
              className={thumbStyles}
              aria-label="Minimum rating"
            />
            <input
              type="range"
              min={MIN}
              max={MAX}
              step={1}
              value={maxVal}
              onChange={(e) => handleMaxInput(Number(e.target.value))}
              className={thumbStyles}
              aria-label="Maximum rating"
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-slate-600">
              <StarIcon className="w-4 h-4 text-amber-400 fill-amber-400" aria-hidden />
              <span className="font-medium tabular-nums">{minVal}</span>
              <span className="text-on-panel-muted">–</span>
              <span className="font-medium tabular-nums">{maxVal}</span>
              <span className="text-slate-400 text-xs ml-0.5">stars</span>
            </span>
            {hasRange && !onlyUnrated && (
              <button
                type="button"
                onClick={handleClearRange}
                className="text-indigo-ink hover:text-indigo-ink text-xs font-medium transition-colors"
              >
                Clear range
              </button>
            )}
          </div>
        </div>

        {/* Include unrated toggle (only when using range) */}
        <label className={`flex items-center gap-3 cursor-pointer group ${onlyUnrated ? "opacity-50 pointer-events-none" : ""}`}>
          <span className="relative inline-flex h-5 w-9 flex-shrink-0">
            <input
              type="checkbox"
              checked={includeUnrated}
              onChange={(e) => handleIncludeUnrated(e.target.checked)}
              className="sr-only peer"
            />
            <span className="absolute inset-0 rounded-full bg-slate-200 transition-colors peer-focus:ring-2 peer-focus:ring-indigo-500/30 peer-focus:ring-offset-1 peer-checked:bg-indigo-500" />
            <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow-sm transition-transform peer-checked:translate-x-4" />
          </span>
          <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">
            Include items with no rating
          </span>
        </label>
      </div>
    </FilterPanel>
  );
};
