/**
 * Shared mode tabs for study/browse screens: Sets | List | Flashcards | Quiz | Learn | Games.
 * Visibility: show Sets only when scope has child buckets; show Flashcards/Quiz/Learn/Games only when scope has items.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowPathIcon,
  Squares2X2Icon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  AcademicCapIcon,
  PuzzlePieceIcon,
} from "@heroicons/react/24/outline";

export type ViewMode = "sets" | "list" | "explore" | "quiz" | "learn" | "games";

export interface ModeSwitcherProps {
  /** Which modes to show. Omit "sets" when no child buckets; omit "explore"/"quiz" when no items. */
  availableModes: ViewMode[];
  activeMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Optional class for the container */
  className?: string;
}

export function ModeSwitcher({
  availableModes,
  activeMode,
  onChange,
  className = "",
}: ModeSwitcherProps) {
  const baseClass =
    "inline-flex shrink-0 items-center gap-1 px-1.5 sm:px-2 py-1 text-sm font-medium rounded-md transition-colors whitespace-nowrap";
  const activeClass = "bg-indigo-50 text-indigo-ink border border-indigo-200";
  const inactiveClass =
    "text-gray-600 hover:bg-gray-100 hover:text-gray-900";

  const modes: { mode: ViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { mode: "sets", label: "Sets", icon: Squares2X2Icon },
    { mode: "list", label: "List", icon: ListBulletIcon },
    { mode: "explore", label: "Flashcards", icon: MagnifyingGlassIcon },
    { mode: "quiz", label: "Quiz", icon: AcademicCapIcon },
    { mode: "learn", label: "Learn", icon: ArrowPathIcon },
    { mode: "games", label: "Games", icon: PuzzlePieceIcon },
  ];

  const stripRef = useRef<HTMLDivElement>(null);
  const [hasMoreToRight, setHasMoreToRight] = useState(false);

  // The strip scrolls when five tabs do not fit (360/375 px): bring the active tab into view and
  // show an edge cue while tabs are cut off on the right.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
    const update = () => setHasMoreToRight(strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1);
    update();
    strip.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      strip.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [activeMode, availableModes]);

  return (
    <div
      ref={stripRef}
      className={`flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      role="tablist"
      aria-label="View mode"
    >
      {modes
        .filter((m) => availableModes.includes(m.mode))
        .map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={activeMode === mode}
            onClick={() => onChange(mode)}
            className={`${baseClass} ${
              activeMode === mode ? activeClass : inactiveClass
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      {hasMoreToRight && (
        <div
          data-testid="mode-switcher-edge-cue"
          aria-hidden="true"
          className="pointer-events-none sticky right-0 -ml-8 h-7 w-8 shrink-0 bg-gradient-to-l from-white to-transparent"
        />
      )}
    </div>
  );
}
