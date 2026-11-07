import { FilterPanel } from "./FilterSection";

interface SearchFilterProps {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
}

export const SearchFilter = ({
  value,
  onChange,
  onRemove,
}: SearchFilterProps) => {
  return (
    <FilterPanel label="Text Search" onRemove={onRemove}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search in questions, answers, explanations, categories, subcategories, keywords..."
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-surface"
      />
      <p className="mt-1 text-xs text-gray-500">
        Searches across item content, category, and keywords
      </p>
    </FilterPanel>
  );
};
