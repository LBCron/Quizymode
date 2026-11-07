import { FilterPanel } from "./FilterSection";
import type { CategoryResponse } from "@/types/api";

interface CategoryFilterProps {
  value: string;
  categories?: CategoryResponse[];
  onChange: (value: string) => void;
  onRemove: () => void;
}

export const CategoryFilter = ({
  value,
  categories,
  onChange,
  onRemove,
}: CategoryFilterProps) => {
  return (
    <FilterPanel label="Category" onRemove={onRemove}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-surface"
      >
        <option value="">All Categories</option>
        {categories?.map((cat) => (
          <option key={cat.category} value={cat.category}>
            {cat.category}
          </option>
        ))}
      </select>
    </FilterPanel>
  );
};
