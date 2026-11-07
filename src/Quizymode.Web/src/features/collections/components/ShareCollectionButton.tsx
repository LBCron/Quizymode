import * as React from "react";
import { ShareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useShareActions } from "@/components/share/useShareActions";

interface ShareCollectionButtonProps {
  /** Absolute URL of the collection page. */
  url: string;
  title: string;
  /** When false the link only works for the owner; the dialog says so. */
  isPublic: boolean;
}

export function ShareCollectionButton({ url, title, isPublic }: ShareCollectionButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const { canNativeShare, copyState, copy, nativeShare, qrDataUrl, qrError, isLoadingQr, showQr, resetCopyState } =
    useShareActions({ copyText: url, shareData: { title, url }, qrValue: url });
  const linkInputId = React.useId();
  const titleId = React.useId();

  const close = React.useCallback(() => {
    setIsOpen(false);
    resetCopyState();
  }, [resetCopyState]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <ShareIcon className="h-4 w-4" aria-hidden="true" />
        Share
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-40 h-full w-full overflow-y-auto bg-black/50"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative top-24 mx-auto w-full max-w-md rounded-md border bg-surface p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id={titleId} className="text-lg font-medium text-gray-900">
                Share collection
              </h3>
              <button
                type="button"
                onClick={close}
                className="text-gray-400 hover:text-gray-500"
                aria-label="Close share dialog"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {!isPublic && (
              <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                Only you can open this link until you turn on “Anyone with the link can view”.
              </p>
            )}

            <label htmlFor={linkInputId} className="mb-1 block text-sm font-medium text-gray-700">
              Collection link
            </label>
            <input
              id={linkInputId}
              type="text"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
              className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Copy link
              </button>
              {canNativeShare && (
                <button
                  type="button"
                  onClick={() => void nativeShare()}
                  className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Share via…
                </button>
              )}
              <button
                type="button"
                onClick={() => void showQr()}
                disabled={isLoadingQr}
                className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {isLoadingQr ? "Loading QR code…" : "Show QR code"}
              </button>
            </div>

            <p className="mt-2 min-h-5 text-sm" role="status">
              {copyState === "copied" && <span className="text-green-700">Link copied.</span>}
              {copyState === "failed" && (
                <span className="text-red-700">Could not copy. Select the link above and copy it.</span>
              )}
            </p>

            {qrError && <p className="text-sm text-red-700">The QR code could not be created.</p>}
            {qrDataUrl && (
              <div className="mt-2 flex justify-center">
                <img src={qrDataUrl} alt={`QR code for ${title}`} width={240} height={240} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
