import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ShareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useShareActions } from "@/components/share/useShareActions";
import { shareCopyText, type ResultShareDescriptor } from "./resultShare";
import { trackQuizResultShared, type StudyEventContext } from "./quizAnalytics";

interface ShareResultButtonProps {
  descriptor: ResultShareDescriptor;
  runId: string;
  score: number;
  total: number;
  context: StudyEventContext;
  /** Filled style for a perfect score. */
  emphasized?: boolean;
}

const COPIED_RESET_MS = 3000;

/** "Share result" button and dialog (AC 3.19.2-3.19.5). */
export function ShareResultButton({ descriptor, runId, score, total, context, emphasized = false }: ShareResultButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const textId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyText = shareCopyText(descriptor);
  const { canNativeShare, copyState, copy, nativeShare, qrDataUrl, qrError, isLoadingQr, showQr, resetCopyState } =
    useShareActions({
      copyText,
      shareData: descriptor.url ? { text: descriptor.text, url: descriptor.url } : { text: descriptor.text },
      qrValue: descriptor.url,
    });

  const close = useCallback(() => {
    setIsOpen(false);
    resetCopyState();
    triggerRef.current?.focus();
  }, [resetCopyState]);

  useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (copyState === "copied") {
      const timer = setTimeout(resetCopyState, COPIED_RESET_MS);
      return () => clearTimeout(timer);
    }
    if (copyState === "failed") {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [copyState, resetCopyState]);

  const reportShared = () => trackQuizResultShared(runId, score, total, context);

  const handleCopy = async () => {
    if (await copy()) reportShared();
  };

  const handleNativeShare = async () => {
    if (await nativeShare()) reportShared();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea"));
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

  const triggerClass = emphasized
    ? "bg-indigo-600 text-white hover:bg-indigo-700"
    : "border border-indigo-600 text-indigo-ink hover:bg-indigo-50";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${triggerClass}`}
      >
        <ShareIcon className="h-4 w-4" aria-hidden="true" />
        Share result
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-panel-deep/60 px-4 py-10" onClick={close}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            onClick={(event) => event.stopPropagation()}
            className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-surface p-6 text-left text-slate-700 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id={titleId} className="text-lg font-semibold text-slate-900">
                Share your result
              </h3>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="text-gray-400 hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Close share dialog"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {descriptor.isPrivateCollection && (
              <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                Private collection: only your score is shared, with no link.
              </p>
            )}

            <label htmlFor={textId} className="mb-1 block text-sm font-medium text-gray-700">
              Message
            </label>
            <textarea
              id={textId}
              ref={textareaRef}
              readOnly
              rows={descriptor.kind === "daily" ? 4 : 3}
              value={copyText}
              onFocus={(event) => event.target.select()}
              className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Copy
              </button>
              {canNativeShare && (
                <button
                  type="button"
                  onClick={() => void handleNativeShare()}
                  className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Share via…
                </button>
              )}
              {descriptor.url && (
                <button
                  type="button"
                  onClick={() => void showQr()}
                  disabled={isLoadingQr}
                  className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isLoadingQr ? "Loading QR code…" : "Show QR code"}
                </button>
              )}
            </div>

            <p className="mt-2 min-h-5 text-sm" role="status">
              {copyState === "copied" && <span className="text-green-700">Copied.</span>}
              {copyState === "failed" && (
                <span className="text-red-700">Couldn't copy. Select the text above and copy it.</span>
              )}
            </p>

            {qrError && <p className="text-sm text-red-700">The QR code couldn't be created.</p>}
            {qrDataUrl && (
              <div className="mt-2 flex justify-center">
                <img src={qrDataUrl} alt="QR code for the shared quiz link" width={240} height={240} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
