import { useRef, type KeyboardEvent } from "react";
import type { QuizRunMode } from "../quizRun";
import { dialogPrimaryButton, dialogSecondaryButton, TestDialog } from "./TestDialog";

const MODES: { mode: QuizRunMode; label: string }[] = [
  { mode: "practice", label: "Practice" },
  { mode: "test", label: "Test" },
];

interface QuizModeToggleProps {
  mode: QuizRunMode;
  onChange: (mode: QuizRunMode) => void;
}

/** AC 3.18.1: Practice | Test radiogroup; arrow keys move the selection. */
export function QuizModeToggle({ mode, onChange }: QuizModeToggleProps) {
  const refs = useRef<Record<QuizRunMode, HTMLButtonElement | null>>({ practice: null, test: null });

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: QuizRunMode = mode === "practice" ? "test" : "practice";
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Quiz mode"
      className="inline-flex w-full rounded-md border border-gray-300 p-0.5 text-sm sm:w-auto"
    >
      {MODES.map((option) => {
        const selected = option.mode === mode;
        return (
          <button
            key={option.mode}
            ref={(element) => {
              refs.current[option.mode] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => !selected && onChange(option.mode)}
            onKeyDown={onKeyDown}
            className={`flex-1 rounded px-3 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:flex-none ${
              selected ? "bg-panel-raised text-on-panel" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface ModeSwitchDialogProps {
  target: QuizRunMode;
  onKeep: () => void;
  onConfirm: () => void;
}

/** AC 3.18.1: shown when switching mode with at least one answer. Keep current run is the default. */
export function ModeSwitchDialog({ target, onKeep, onConfirm }: ModeSwitchDialogProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  return (
    <TestDialog
      titleId="mode-switch-title"
      title={target === "test" ? "Switch to Test?" : "Switch to Practice?"}
      initialFocusRef={keepRef}
      onEscape={onKeep}
    >
      <p className="mt-3 text-sm">Your current run will be lost and a new one will start.</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button ref={keepRef} type="button" onClick={onKeep} className={dialogSecondaryButton}>
          Keep current run
        </button>
        <button type="button" onClick={onConfirm} className={dialogPrimaryButton}>
          Switch and restart
        </button>
      </div>
    </TestDialog>
  );
}
