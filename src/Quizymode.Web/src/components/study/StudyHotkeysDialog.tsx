import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  setStudyHotkeysEnabled,
  useStudyHotkeysEnabled,
  useStudyHotkeysPersistFailed,
} from "./studyHotkeysPreference";
import type { StudyShortcutHelp } from "./studyShortcuts";

interface StudyHotkeysDialogProps {
  open: boolean;
  onClose: () => void;
  /** Bindings active on the current screen; empty shows "No other shortcuts on this screen." */
  shortcuts: StudyShortcutHelp[];
}

/** Modal listing the active shortcuts plus the "Single-key shortcuts" switch (AC 3.16.6, 3.16.7). */
export function StudyHotkeysDialog({ open, onClose, shortcuts }: StudyHotkeysDialogProps) {
  const enabled = useStudyHotkeysEnabled();
  const persistFailed = useStudyHotkeysPersistFailed();
  const dialogRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    switchRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-panel-deep/60 px-4 py-10" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-hotkeys-title"
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-surface p-6 text-slate-700 shadow-2xl"
      >
        <h2 id="study-hotkeys-title" className="text-xl font-semibold text-slate-900">
          Keyboard shortcuts
        </h2>

        <div className="mt-4 flex items-center justify-between gap-4">
          <span id="study-hotkeys-switch-label" className="text-sm font-medium text-slate-900">
            Single-key shortcuts
          </span>
          <button
            ref={switchRef}
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-labelledby="study-hotkeys-switch-label"
            onClick={() => setStudyHotkeysEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              enabled ? "bg-indigo-600" : "bg-gray-300"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-5 w-5 rounded-full bg-surface shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {persistFailed && (
          <p role="status" className="mt-2 text-xs text-amber-700">
            This setting could not be saved, so it applies to this tab only.
          </p>
        )}

        {shortcuts.length > 0 ? (
          <dl className="mt-4 space-y-2 text-sm">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.keys} className="flex justify-between gap-4">
                <dt className="font-mono text-slate-900">{shortcut.keys}</dt>
                <dd className="text-right">{shortcut.description}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-4 text-sm">No other shortcuts on this screen.</p>
        )}
        {!enabled && shortcuts.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">Shortcuts are off. Turn the switch on to use them.</p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
