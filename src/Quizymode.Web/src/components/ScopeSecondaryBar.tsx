/**
 * Secondary bar for scope screens: mode switcher (Sets|List Items|Flashcards|Quiz).
 * Rendered by scope pages (categories, collection, explore, quiz, my-items) below the main nav.
 */
import type { ReactNode } from "react";
import { ModeSwitcher, type ViewMode } from "@/components/ModeSwitcher";

export type ScopeType = "category" | "collection" | "my-items";

export interface ScopeSecondaryBarProps {
  scopeType: ScopeType;
  activeMode: ViewMode;
  availableModes: ViewMode[];
  onModeChange: (mode: ViewMode) => void;
  /** Optional slot for filter toggle / filter summary (e.g. when activeMode === "list") */
  filterSlot?: ReactNode;
  /** Optional actions on the far right (e.g. Add items) */
  endSlot?: ReactNode;
  className?: string;
}

export function ScopeSecondaryBar({
  scopeType,
  activeMode,
  availableModes,
  onModeChange,
  filterSlot,
  endSlot,
  className = "",
}: ScopeSecondaryBarProps) {
  const right =
    filterSlot != null || endSlot != null ? (
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2 min-w-0">
        {filterSlot}
        {endSlot}
      </div>
    ) : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 py-2 px-2 bg-surface border-b border-gray-200 ${className}`}
      role="region"
      aria-label={`Scope toolbar: ${scopeType}`}
    >
      {availableModes.length > 0 && (
        <ModeSwitcher
          availableModes={availableModes}
          activeMode={activeMode}
          onChange={onModeChange}
        />
      )}
      {right}
    </div>
  );
}
