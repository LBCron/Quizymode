import { FilterPanel } from "./FilterSection";

interface KeywordsFilterProps {
  selectedKeywords: string[];
  availableKeywords: string[];
  onAddKeyword: (keyword: string) => void;
  onRemoveKeyword: (keyword: string) => void;
  onRemove: () => void;
}

export const KeywordsFilter = ({
  selectedKeywords,
  availableKeywords,
  onAddKeyword,
  onRemoveKeyword,
  onRemove,
}: KeywordsFilterProps) => {
  return (
    <FilterPanel label="Keywords" onRemove={onRemove}>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value && !selectedKeywords.includes(e.target.value)) {
            onAddKeyword(e.target.value);
          }
        }}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-surface mb-2"
      >
        <option value="">Select a keyword...</option>
        {availableKeywords
          .filter((k) => !selectedKeywords.includes(k))
          .map((keyword) => (
            <option key={keyword} value={keyword}>
              {keyword}
            </option>
          ))}
      </select>
      {selectedKeywords.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {selectedKeywords.map((keyword) => (
            <span
              key={keyword}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-ink"
            >
              {keyword}
              <button
                onClick={() => onRemoveKeyword(keyword)}
                className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-indigo-200"
                aria-label={`Remove ${keyword} filter`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </FilterPanel>
  );
};
