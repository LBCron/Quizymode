import { createPortal } from "react-dom";
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

interface TestDialogProps {
  titleId: string;
  title: string;
  /** Element that receives focus when the dialog opens. */
  initialFocusRef: RefObject<HTMLElement | null>;
  /** Escape; must be the harmless choice (Return to test / Keep current run). */
  onEscape: () => void;
  children: ReactNode;
}

/** Modal panel shared by the Submit confirmation and the mode-switch confirmation (same pattern as the shortcuts dialog). */
export function TestDialog({ titleId, title, initialFocusRef, onEscape, children }: TestDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus();
    const returnTo = returnFocusRef.current;
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [initialFocusRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled])"));
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

  // Portalled to the body so a backdrop-filter ancestor cannot turn `fixed` into content-relative positioning.
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-panel-deep/60 px-4 py-10">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-surface p-6 text-slate-700 shadow-2xl"
      >
        <h2 id={titleId} className="text-xl font-semibold text-slate-900">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const dialogSecondaryButton =
  "rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
export const dialogPrimaryButton =
  "rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";
