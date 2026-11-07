import { MediaIdentityContext } from "@/contexts/MediaIdentityContext";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExclamationTriangleIcon, MagnifyingGlassPlusIcon } from "@heroicons/react/24/outline";
import { useParams } from "react-router-dom";
import { PictureReportButton } from "./PictureReportButton";
import { mediaApi } from "@/api/media";
import { resolveCuratedImage } from "@/media/curatedImages";
import type { ItemImageReference } from "@/types/api";
import { ImageZoomDialog } from "@/components/study/ImageZoomDialog";

export type QuestionImageSize = "lg" | "sm" | "xs";
export type QuestionImageSlot = "question" | "explanation";
/** Load state reported to the parent; "stuck" is a picture still loading after STUCK_AFTER_MS, "unknown" an unbundled key. */
export type PictureStatus = "loading" | "loaded" | "error" | "stuck" | "unknown";

/** How long a question picture may stay in the loading state before Retry and Skip are offered (#403). */
export const STUCK_AFTER_MS = 10_000;

interface QuestionImageProps {
  image?: ItemImageReference | null;
  itemId?: string;
  collectionId?: string;
  /** lg: study surfaces; sm: list/review thumbnail; xs: recap thumbnail. */
  size?: QuestionImageSize;
  /** question: blocks answering until loaded (the parent decides); explanation: shown after reveal, never blocks. */
  slot?: QuestionImageSlot;
  className?: string;
  /** Reports every status change (and the initial "loading") before paint so a parent can gate answering. */
  onStatusChange?: (status: PictureStatus) => void;
  /** Question slot only: when set, a failed or stuck picture offers "Skip question (not scored)". */
  onSkip?: () => void;
  /** Enlarge button (lg only; default true for lg). */
  showEnlarge?: boolean;
}

const THUMB_BOX: Record<Exclude<QuestionImageSize, "lg">, string> = {
  sm: "relative h-12 w-[4.5rem] shrink-0 overflow-hidden rounded bg-slate-200 ring-1 ring-inset ring-gray-300 sm:h-16 sm:w-24",
  xs: "relative h-8 w-12 shrink-0 overflow-hidden rounded bg-slate-200 ring-1 ring-inset ring-gray-300",
};

const LARGE_BOX =
  "relative aspect-[3/2] w-full max-h-[30vh] overflow-hidden rounded-lg bg-slate-200 ring-1 ring-inset ring-gray-300 focus:outline-none sm:max-h-72";
const LARGE_ERROR_BOX =
  "relative w-full overflow-hidden rounded-lg bg-slate-100 ring-1 ring-inset ring-gray-300 focus:outline-none";

const buttonClass =
  "min-h-[44px] rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/**
 * Curated picture (#407 question, #403 explanation). Renders nothing without an image. The alt text is the image's
 * altText and is never shown as an inline caption (the enlarged view is the one exception). The question slot
 * reports its status so the parent can keep answers off until the picture shows.
 */
export function QuestionImage({
  image,
  size = "lg",
  slot = "question",
  className = "",
  onStatusChange,
  onSkip,
  showEnlarge,
  itemId,
  collectionId,
}: QuestionImageProps) {
  const identity = useContext(MediaIdentityContext);
  const route = useParams<{ collectionId?: string }>();
  const effectiveCollectionId = collectionId ?? route.collectionId;
  if (!image) return null;
  return (
    <QuestionImageBox
      key={`${identity}:${itemId ?? ""}:${effectiveCollectionId ?? ""}:${slot}:${image.key}:${image.revision ?? 0}`}
      image={image}
      itemId={itemId}
      collectionId={effectiveCollectionId}
      size={size}
      slot={slot}
      className={className}
      onStatusChange={onStatusChange}
      onSkip={onSkip}
      showEnlarge={showEnlarge ?? size === "lg"}
    />
  );
}

function QuestionImageBox({
  image,
  size,
  slot,
  className,
  onStatusChange,
  onSkip,
  showEnlarge,
  itemId,
  collectionId,
}: {
  image: ItemImageReference;
  itemId?: string;
  collectionId?: string;
  size: QuestionImageSize;
  slot: QuestionImageSlot;
  className: string;
  onStatusChange?: (status: PictureStatus) => void;
  onSkip?: () => void;
  showEnlarge: boolean;
}) {
  const uploaded = image.key.startsWith("media:");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const url = uploaded ? blobUrl : resolveCuratedImage(image.key);
  const isUnknown = (uploaded && (!itemId || !Number.isSafeInteger(image.revision) || (image.revision ?? 0) <= 0)) || (!uploaded && url === null);
  const [status, setStatus] = useState<PictureStatus>(isUnknown ? "unknown" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  useEffect(() => {
    if (!uploaded || !itemId || isUnknown) return;
    const abort = new AbortController(); let created: string | null = null;
    mediaApi.content(itemId, slot, collectionId, abort.signal, image.revision!).then(blob => {
      if (!abort.signal.aborted) { created = URL.createObjectURL(blob); setBlobUrl(created); }
    }).catch(() => { if (!abort.signal.aborted) setStatus("error"); });
    return () => { abort.abort(); if (created) URL.revokeObjectURL(created); };
  }, [uploaded, itemId, collectionId, slot, image.revision, isUnknown, attempt]);

  const boxRef = useRef<HTMLDivElement>(null);
  const enlargeRef = useRef<HTMLButtonElement>(null);
  const focusAfterRetry = useRef(false);
  const statusCallback = useRef(onStatusChange);
  const isQuestion = slot === "question";
  const isLarge = size === "lg";

  // Keep the latest callback without re-running the status effect when only the callback identity changes.
  useLayoutEffect(() => {
    statusCallback.current = onStatusChange;
  });

  useLayoutEffect(() => {
    statusCallback.current?.(status);
  }, [status]);

  useEffect(() => {
    if (focusAfterRetry.current) {
      focusAfterRetry.current = false;
      boxRef.current?.focus();
    }
  }, [attempt]);

  // A question picture that keeps loading is surfaced like a failure so the learner is never stranded.
  useEffect(() => {
    if (!isQuestion || !isLarge || status !== "loading") return;
    const timer = window.setTimeout(() => setStatus((current) => (current === "loading" ? "stuck" : current)), STUCK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [isQuestion, isLarge, status, attempt]);

  const retry = () => {
    focusAfterRetry.current = true;
    setStatus("loading");
    setBlobUrl(null);
    setAttempt((current) => current + 1);
  };

  const showsProblem = status === "error" || status === "stuck" || status === "unknown";
  const message =
    status === "unknown"
      ? "Picture isn't available"
      : status === "stuck"
        ? "Picture is taking too long to load"
        : "Picture couldn't load";
  const src = url === null ? undefined : !uploaded && attempt > 0 ? `${url}?r=${attempt}` : url;
  const canZoom = isLarge && showEnlarge && status === "loaded" && url !== null;
  const showSkip = isQuestion && onSkip !== undefined;

  const box = (
    <div
      ref={boxRef}
      data-picture-status={status}
      data-testid={isQuestion ? "question-image" : "explanation-image"}
      aria-busy={status === "loading" || status === "stuck"}
      tabIndex={isLarge ? -1 : undefined}
      onClick={canZoom ? () => setZoomOpen(true) : undefined}
      className={
        isLarge
          ? `${showsProblem ? LARGE_ERROR_BOX : LARGE_BOX}${canZoom ? " cursor-zoom-in" : ""}`
          : `${THUMB_BOX[size as Exclude<QuestionImageSize, "lg">]} ${className}`.trim()
      }
    >
      {status === "loading" && (
        <>
          <div className="absolute inset-0 bg-slate-300 motion-safe:animate-pulse" aria-hidden="true" />
          {isLarge && (
            <span className="sr-only" role="status">
              Loading picture
            </span>
          )}
        </>
      )}
      {url !== null && !isUnknown && status !== "error" && (
        <img
          key={attempt}
          src={src}
          alt={image.altText}
          width={640}
          height={640}
          decoding="async"
          draggable={false}
          loading={isLarge ? "eager" : "lazy"}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={`h-full w-full object-contain ${isLarge ? "p-2" : "p-1"} motion-safe:transition-opacity motion-safe:duration-200 ${
            status === "loaded" ? "opacity-100" : "opacity-0"
          } ${status === "stuck" ? "absolute inset-0" : ""}`}
        />
      )}
      {showsProblem &&
        (isLarge ? (
          <div className="relative flex flex-col items-center justify-center gap-2 bg-slate-100 p-3 text-center">
            <ExclamationTriangleIcon className="h-6 w-6 text-gray-500" aria-hidden="true" />
            <p role="status" className="text-sm font-medium text-gray-700">
              {message}
            </p>
            {isQuestion && (
              <p className="text-xs text-gray-600">Answers are off until the picture shows. You can retry or skip this question.</p>
            )}
            <div className="flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row">
              {status !== "unknown" && (
                <button
                  type="button"
                  onClick={retry}
                  aria-label="Retry loading picture"
                  data-testid="question-image-retry"
                  className={buttonClass}
                >
                  Retry
                </button>
              )}
              {showSkip && (
                <button type="button" onClick={onSkip} data-testid="question-image-skip" className={buttonClass}>
                  Skip question (not scored)
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center" role="img" aria-label={message}>
            <ExclamationTriangleIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />
          </div>
        ))}
    </div>
  );

  if (!isLarge) return box;
  return (
    <div className={`relative mx-auto w-full max-w-md ${className}`.trim()}>
      {box}
      {status === "loaded" && isQuestion && onSkip && <button type="button" onClick={onSkip} data-testid="question-image-skip" className={`${buttonClass} mt-2`}>Skip question (not scored)</button>}
      {uploaded && itemId && (image.revision ?? 0) > 0 && <PictureReportButton itemId={itemId} slot={slot} revision={image.revision!} collectionId={collectionId} />}
      {image.longDescription && <details className="mt-2 text-sm"><summary>Picture description</summary><p className="whitespace-pre-wrap">{image.longDescription}</p></details>}
      {canZoom && (
        <button
          ref={enlargeRef}
          type="button"
          aria-label="Enlarge picture"
          aria-haspopup="dialog"
          onClick={() => setZoomOpen(true)}
          className="absolute bottom-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-surface/90 text-slate-800 shadow ring-1 ring-slate-300 hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 print:hidden"
        >
          <MagnifyingGlassPlusIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      {zoomOpen && url !== null && (
        <ImageZoomDialog url={url} altText={image.altText} onClose={() => setZoomOpen(false)} returnFocusRef={enlargeRef} />
      )}
    </div>
  );
}
