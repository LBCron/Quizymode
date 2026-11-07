import type { ReactNode } from "react";
import { FunnelIcon, XMarkIcon, PlusIcon } from "@heroicons/react/24/outline";

interface FilterSectionProps {
  showFilters: boolean;
  hasActiveFilters: boolean;
  onToggleFilters: () => void;
  onClearAll: () => void;
  children: ReactNode;
}

export const FilterSection = ({
  showFilters,
  hasActiveFilters,
  onToggleFilters,
  onClearAll,
  children,
}: FilterSectionProps) => {
  return (
    <div className="mb-6 bg-surface rounded-lg shadow">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <FunnelIcon className="h-5 w-5 text-gray-500" />
          <h2 className="text-lg font-medium text-gray-900">Filters</h2>
          {hasActiveFilters && (
            <span className="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-ink rounded-full">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {hasActiveFilters && (
            <button
              onClick={onClearAll}
              className="text-sm text-gray-600 hover:text-gray-900 underline"
            >
              Clear All
            </button>
          )}
          <button
            onClick={onToggleFilters}
            className="text-sm text-indigo-ink hover:text-indigo-ink font-medium"
          >
            {showFilters ? "Hide Filters" : "Show Filters"}
          </button>
        </div>
      </div>

      {showFilters && <div className="px-4 py-4 space-y-4">{children}</div>}
    </div>
  );
};

interface FilterPanelProps {
  label: string;
  onRemove: () => void;
  children: ReactNode;
}

export const FilterPanel = ({ label, onRemove, children }: FilterPanelProps) => {
  return (
    <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-gray-600"
          aria-label={`Remove ${label.toLowerCase()} filter`}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
};

interface AddFilterButtonProps {
  onClick: () => void;
  label: string;
}

export const AddFilterButton = ({ onClick, label }: AddFilterButtonProps) => {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-indigo-ink bg-indigo-50 rounded-md hover:bg-indigo-100"
    >
      <PlusIcon className="h-4 w-4 mr-1" />
      {label}
    </button>
  );
};
