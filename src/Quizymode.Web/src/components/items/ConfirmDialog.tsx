import { useEffect, useId, useRef } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-page modal confirmation: role=dialog, focus trapped, Escape cancels, focus returns to the opener. */
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelCallback = useRef(onCancel);
  useEffect(() => { cancelCallback.current = onCancel; });
  useFocusTrap(dialogRef);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelCallback.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-panel-deep/60 px-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} className="w-full max-w-md space-y-4 rounded-lg bg-surface p-5 shadow-xl">
        <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
        <p id={messageId} className="text-sm text-gray-700">{message}</p>
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-800">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
