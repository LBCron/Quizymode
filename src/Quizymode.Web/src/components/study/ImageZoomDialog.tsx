import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ImageZoomDialogProps {
  url: string;
  altText: string;
  onClose: () => void;
  /** Element that receives focus again when the dialog closes (the Enlarge button). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Enlarged view of a curated picture (#403). Mounted only while open: nothing about it exists in the DOM before the
 * learner asks for it. Close is the only control and holds the initial focus; Escape, the backdrop and Close dismiss.
 */
export function ImageZoomDialog({ url, altText, onClose, returnFocusRef }: ImageZoomDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const fallback = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTo = returnFocusRef?.current ?? null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      const target = returnTo?.isConnected ? returnTo : fallback;
      if (target?.isConnected) target.focus();
    };
  }, [returnFocusRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  // Portalled to the body: an ancestor with backdrop-filter would otherwise make `fixed` relative to itself.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] overflow-hidden bg-panel-deep/80"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-zoom-title"
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        className="mx-auto flex h-[100dvh] w-full min-w-0 max-w-4xl flex-col overflow-x-hidden rounded-none bg-surface p-3 sm:my-6 sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl sm:p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="image-zoom-title" className="text-base font-semibold text-slate-900">
            Picture
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Close
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto">
          <img src={url} alt={altText} draggable={false} className="max-h-[70dvh] w-full object-contain" />
          <p className="mt-3 max-h-24 overflow-y-auto break-words text-sm text-slate-700">{altText}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
