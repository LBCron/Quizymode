/**
 * Filter dialog anchored to the top of the viewport so it is immediately visible
 * without any page scrolling.
 */
import { useEffect, type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface FilterBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAll: () => void;
  hasActiveFilters: boolean;
  children: ReactNode;
}

export function FilterBottomSheet({
  isOpen,
  onClose,
  onClearAll,
  hasActiveFilters,
  children,
}: FilterBottomSheetProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-start pt-4"
      aria-modal="true"
      role="dialog"
      aria-label="Filters"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-panel-deep/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full bg-surface shadow-2xl rounded-2xl mx-4 max-w-lg max-h-[85dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Filters</h2>
          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-sm text-indigo-ink hover:text-indigo-ink font-medium"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              aria-label="Close filters"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {children}
        </div>

        {/* Apply button */}
        <div className="px-4 py-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            Show results
          </button>
        </div>
      </div>
    </div>
  );
}
