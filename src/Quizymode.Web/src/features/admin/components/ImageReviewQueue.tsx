import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { z } from "zod";
import { adminApi, type ImageReviewQueueItem } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { QuestionImage } from "@/components/study/QuestionImage";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { ItemImageReference } from "@/types/api";
import { IMAGE_REVIEW_QUEUE_KEY, useImageReviewQueue } from "../hooks/useImageReviewQueue";
import { formatAge, secondsSince } from "./overviewFormatting";

/** The repo is public; this opens the policy the reviewer judges against. Keep the version in step with docs/picture-policy.md. */
export const PICTURE_POLICY_URL = "https://github.com/yanis-kr/Quizymode/blob/main/docs/picture-policy.md";
export const PICTURE_POLICY_VERSION = "pictures-v1";
const MAX_REASON_LENGTH = 500;

const rejectReasonSchema = z.string().trim().min(1).max(MAX_REASON_LENGTH);

type Slot = "question" | "explanation";
const SLOT_LABEL: Record<Slot, string> = { question: "Question", explanation: "Explanation" };

type DecisionError = "stale" | "unavailable" | "other" | null;

function classifyError(error: unknown): DecisionError {
  if (!isAxiosError(error)) return "other";
  const status = error.response?.status;
  if (status === 404) return "stale";
  if (status === 409) {
    const title = (error.response?.data as { title?: string } | undefined)?.title;
    return title === "Item.ImageAssetUnavailable" ? "unavailable" : "stale";
  }
  return "other";
}

function intentText(item: ImageReviewQueueItem): string {
  if (item.isPrivate) {
    return "Item visibility: Private. Approving these pictures does not make this item public.";
  }
  if (item.readyForReview) {
    return "Item is public or being submitted for publication. Approving these pictures only clears the pictures; it does not approve the item.";
  }
  return "Item visibility: Public. Approving these pictures only clears the pictures; it does not change the item's review status.";
}

function PictureZoomDialog({
  url,
  title,
  altText,
  attribution,
  onClose,
  returnFocusRef,
}: {
  url: string;
  title: string;
  altText: string;
  attribution?: string | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const returnTo = returnFocusRef.current;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [onClose, returnFocusRef]);

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 px-4 py-10 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="picture-zoom-title"
        className="mx-auto w-full max-w-4xl rounded-lg bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="picture-zoom-title" className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close picture"
            onClick={onClose}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <img src={url} alt={altText} draggable={false} className="mt-3 max-h-[70vh] w-full object-contain" />
        <p className="mt-3 break-words text-sm text-gray-700">Alt text: {altText || "none provided"}</p>
        {attribution ? <p className="mt-1 break-words text-xs text-gray-500">Attribution: {attribution}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

type SlotLoad = "none" | "loading" | "ready" | "error";

const Spinner = () => (
  <span
    className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-b-2 border-white align-middle"
    aria-hidden="true"
  />
);

type BlobState = { status: "loading" } | { status: "ready"; url: string } | { status: "error" };

/** One picture slot. Uploaded pictures (media: keys) are fetched with the bearer token; curated ones render directly. */
function PictureSlot({
  itemId,
  slot,
  image,
  onLoadChange,
}: {
  itemId: string;
  slot: Slot;
  image: ItemImageReference | null | undefined;
  onLoadChange: (slot: Slot, load: SlotLoad) => void;
}) {
  const [blob, setBlob] = useState<BlobState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  const isUploaded = image?.key.startsWith("media:") ?? false;
  const closeZoom = useCallback(() => setZoomOpen(false), []);

  useEffect(() => {
    if (!isUploaded) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    adminApi
      .fetchItemImageBlob(itemId, slot)
      .then((data) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setBlob({ status: "ready", url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setBlob({ status: "error" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, slot, isUploaded, attempt]);

  const load: SlotLoad = isUploaded ? blob.status : "none";
  useEffect(() => {
    onLoadChange(slot, load);
  }, [slot, load, onLoadChange]);

  const label = SLOT_LABEL[slot];
  if (!image) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase text-gray-500">{label} picture</p>
        <div className="mt-1 flex aspect-square w-full items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-500">
          No {slot} picture
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase text-gray-500">{label} picture</p>
      <div className="mt-1">
        {!isUploaded ? (
          <QuestionImage image={image} slot={slot} size="sm" />
        ) : blob.status === "ready" ? (
          <button
            ref={thumbRef}
            type="button"
            aria-label={`Enlarge ${slot} picture`}
            aria-haspopup="dialog"
            onClick={() => setZoomOpen(true)}
            className="block w-full cursor-zoom-in rounded border border-gray-200 bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <img src={blob.url} alt={image.altText} className="aspect-square w-full rounded object-cover" />
          </button>
        ) : blob.status === "error" ? (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-center">
            <p role="status" className="text-sm text-gray-700">
              Picture could not be loaded
            </p>
            <button
              type="button"
              onClick={() => {
                setBlob({ status: "loading" });
                setAttempt((current) => current + 1);
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="aspect-square w-full rounded bg-gray-200 motion-safe:animate-pulse" aria-label={`Loading ${slot} picture`} />
        )}
      </div>
      <p className={`mt-2 break-words text-sm ${image.altText ? "text-gray-700" : "text-amber-700"}`}>
        Alt text: {image.altText || "none provided"}
      </p>
      {image.attribution ? <p className="mt-1 break-words text-xs text-gray-500">Attribution: {image.attribution}</p> : null}
      {zoomOpen && blob.status === "ready" ? (
        <PictureZoomDialog
          url={blob.url}
          title={`${label} picture`}
          altText={image.altText}
          attribution={image.attribution}
          onClose={closeZoom}
          returnFocusRef={thumbRef}
        />
      ) : null}
    </div>
  );
}

function ImageReviewCard({
  item,
  onDecided,
}: {
  item: ImageReviewQueueItem;
  onDecided: (message: string, itemId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<DecisionError>(null);
  const [slotLoads, setSlotLoads] = useState<Record<Slot, SlotLoad>>({
    question: item.questionImage?.key.startsWith("media:") ? "loading" : "none",
    explanation: item.explanationImage?.key.startsWith("media:") ? "loading" : "none",
  });
  const revision = item.imageReview.revision;

  const mutation = useMutation({
    mutationFn: (request: { decision: "approve" | "reject"; reason?: string }) =>
      adminApi.setImageReview(item.id, { decision: request.decision, expectedRevision: revision, reason: request.reason }),
    onSuccess: (_data, request) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: IMAGE_REVIEW_QUEUE_KEY });
      void queryClient.invalidateQueries({ queryKey: ["admin", "analytics-overview"] });
      onDecided(request.decision === "approve" ? "Pictures approved." : "Pictures rejected.", item.id);
    },
    onError: (err) => {
      const kind = classifyError(err);
      setError(kind);
      if (kind === "stale") {
        void queryClient.invalidateQueries({ queryKey: IMAGE_REVIEW_QUEUE_KEY });
      }
    },
  });

  const handleSlotLoad = useCallback((slot: Slot, load: SlotLoad) => {
    setSlotLoads((current) => (current[slot] === load ? current : { ...current, [slot]: load }));
  }, []);

  const parsedReason = rejectReasonSchema.safeParse(reason);
  const stale = error === "stale";
  const busy = mutation.isPending;
  const approving = busy && mutation.variables?.decision === "approve";
  const rejecting = busy && mutation.variables?.decision === "reject";
  const slotStates = [slotLoads.question, slotLoads.explanation];
  const anyLoadFailure = slotStates.includes("error");
  const picturesNotReady = slotStates.includes("loading") || anyLoadFailure;
  const submittedBy = item.imageReview.submittedByDisplay ?? item.imageReview.submittedBy ?? null;
  const submittedAt = item.imageReview.submittedAt ?? null;
  const reasonId = `reason-${item.id}`;
  const counterId = `reason-count-${item.id}`;

  return (
    <li data-card-id={item.id} className="rounded-lg bg-white p-4 shadow sm:p-6">
      <div className="space-y-3">
        <div>
          <h3 className="text-lg font-medium text-gray-900">{item.question}</h3>
          <p className="mt-1 text-sm text-gray-500">Answer: {item.correctAnswer}</p>
          <p className="mt-1 text-sm text-gray-500">{item.category}</p>
          <p className="mt-1 text-sm text-gray-500">
            {submittedBy ? `Submitted by ${submittedBy}` : "Submitter unknown"}
            {submittedAt ? (
              <>
                {" · "}
                <span title={new Date(submittedAt).toLocaleString()}>{formatAge(secondsSince(submittedAt))} ago</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-gray-500">Picture revision {revision}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-4">
          <PictureSlot itemId={item.id} slot="question" image={item.questionImage} onLoadChange={handleSlotLoad} />
          <PictureSlot itemId={item.id} slot="explanation" image={item.explanationImage} onLoadChange={handleSlotLoad} />
        </div>

        <p className="text-sm text-gray-700">{intentText(item)}</p>
        {anyLoadFailure ? (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">Picture not loaded; reload it before deciding.</p>
        ) : null}

        {stale ? (
          <div role="alert" className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span>This item changed — reload</span>
            <button
              type="button"
              onClick={() => void queryClient.refetchQueries({ queryKey: IMAGE_REVIEW_QUEUE_KEY })}
              className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
            >
              Reload
            </button>
          </div>
        ) : null}
        {error === "unavailable" ? (
          <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            A picture is no longer available; it can&apos;t be approved.
          </p>
        ) : null}
        {error === "other" ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Could not save your decision. Try again.
          </p>
        ) : null}

        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700">
            Reason for rejection (required, shown to the owner)
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={MAX_REASON_LENGTH}
            disabled={stale || busy}
            aria-describedby={counterId}
            placeholder="Explain what needs to change, e.g. unclear source or wrong subject."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
          />
          <p id={counterId} className={`mt-1 text-right text-xs ${reason.length >= MAX_REASON_LENGTH ? "text-red-600" : "text-gray-500"}`}>
            {reason.length}/{MAX_REASON_LENGTH}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={stale || busy || picturesNotReady}
            onClick={() => mutation.mutate({ decision: "approve" })}
            className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 sm:w-auto"
          >
            {approving ? (
              <>
                <Spinner />
                Approving...
              </>
            ) : (
              "Approve pictures"
            )}
          </button>
          <button
            type="button"
            disabled={stale || busy || !parsedReason.success}
            onClick={() => {
              if (parsedReason.success) mutation.mutate({ decision: "reject", reason: parsedReason.data });
            }}
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 sm:w-auto"
          >
            {rejecting ? (
              <>
                <Spinner />
                Rejecting...
              </>
            ) : (
              "Reject pictures"
            )}
          </button>
        </div>
      </div>
    </li>
  );
}

/** The "Pictures" tab of the review board: pending uploaded-picture submissions, oldest first (AC 3.26.3). */
export function ImageReviewQueue() {
  const { data, isLoading, error, refetch } = useImageReviewQueue(true);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<{ decidedId: string; nextId: string | null } | null>(null);

  // After a decision the card leaves the queue: move focus to the next card's first button, else to the Pictures tab.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !data || data.items.some((item) => item.id === pending.decidedId)) return;
    pendingFocus.current = null;
    const nextButton = pending.nextId
      ? listRef.current?.querySelector<HTMLElement>(`[data-card-id="${pending.nextId}"] button:not([disabled])`)
      : null;
    (nextButton ?? document.getElementById("review-board-tab-pictures"))?.focus();
  }, [data]);

  const handleDecided = (message: string, itemId: string) => {
    setAnnouncement(message);
    const items = data?.items ?? [];
    const index = items.findIndex((item) => item.id === itemId);
    pendingFocus.current = { decidedId: itemId, nextId: index >= 0 ? (items[index + 1]?.id ?? null) : null };
  };

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) {
    return <ErrorMessage message="Failed to load the picture review queue" onRetry={() => void refetch()} />;
  }

  const count = data.totalCount;
  const oldest = data.oldestSubmittedAt ?? null;

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="mb-4">
        <p className="text-lg font-medium text-gray-900">
          {count === 1 ? "1 picture submission waiting for review" : `${count} picture submissions waiting for review`}
        </p>
        {oldest ? <p className="text-sm text-gray-500">Oldest submitted {formatAge(secondsSince(oldest))} ago</p> : null}
        <p className="mt-1 text-sm text-gray-600">
          Review against the{" "}
          <a href={PICTURE_POLICY_URL} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">
            Picture policy (opens GitHub)
          </a>{" "}
          (version {PICTURE_POLICY_VERSION}). Approving pictures does not publish the item.
        </p>
      </div>
      {data.items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-500">No pictures waiting for review</p>
        </div>
      ) : (
        <>
          <ul ref={listRef} className="space-y-4">
            {data.items.map((item) => (
              <ImageReviewCard key={`${item.id}-${item.imageReview.revision}`} item={item} onDecided={handleDecided} />
            ))}
          </ul>
          {count > data.items.length ? (
            <p className="mt-4 text-sm text-gray-500">
              Showing the oldest {data.items.length} of {count}. Decide these to load the next ones.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export default ImageReviewQueue;
