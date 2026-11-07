import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { z } from "zod";
import { adminApi, type BulkImageReviewRequest, type ImageReviewQueueItem } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { QuestionImage } from "@/components/study/QuestionImage";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { ItemImageReference } from "@/types/api";
import { IMAGE_REVIEW_QUEUE_KEY, useImageReviewQueue } from "../hooks/useImageReviewQueue";
import { MediaOperations } from "./MediaOperations";
import { formatAge, secondsSince } from "./overviewFormatting";

/** The repo is public; this opens the policy the reviewer judges against. Keep the version in step with docs/picture-policy.md. */
export const PICTURE_POLICY_URL = "https://github.com/yanis-kr/Quizymode/blob/main/docs/picture-policy.md";
export const PICTURE_POLICY_VERSION = "pictures-v1";
const MAX_REASON_LENGTH = 500;

const rejectReasonSchema = z.string().trim().min(1).max(MAX_REASON_LENGTH);

type Slot = "question" | "explanation";
const SLOT_LABEL: Record<Slot, string> = { question: "Question", explanation: "Explanation" };
type BulkDecision = BulkImageReviewRequest["decision"];

/** The first picture an item carries: the question picture, else the explanation picture. */
function pictureFor(item: ImageReviewQueueItem): { slot: Slot; image: ItemImageReference } | null {
  if (item.questionImage) return { slot: "question", image: item.questionImage };
  if (item.explanationImage) return { slot: "explanation", image: item.explanationImage };
  return null;
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

type ThumbState = { status: "loading" } | { status: "ready"; url: string } | { status: "error" };

/** A square thumbnail. Uploaded pictures are fetched with the admin token; click enlarges them in a dialog. */
function PictureThumb({ itemId, slot, image }: { itemId: string; slot: Slot; image: ItemImageReference }) {
  const isUploaded = image.key.startsWith("media:");
  const [blob, setBlob] = useState<ThumbState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  const closeZoom = useCallback(() => setZoomOpen(false), []);

  useEffect(() => {
    if (!isUploaded) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    adminApi
      .fetchItemImageBlob(itemId, slot, image.revision ?? 0)
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
  }, [itemId, slot, isUploaded, image.revision, attempt]);

  if (!isUploaded) return <QuestionImage image={image} slot={slot} size="sm" />;
  if (blob.status === "loading") {
    return <div className="aspect-square w-full rounded bg-gray-200 motion-safe:animate-pulse" aria-label="Loading picture" />;
  }
  if (blob.status === "error") {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-center">
        <p role="status" className="text-xs text-gray-700">Picture could not be loaded</p>
        <button
          type="button"
          onClick={() => {
            setBlob({ status: "loading" });
            setAttempt((current) => current + 1);
          }}
          className="min-h-[44px] rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }
  const altText = image.altText || `${SLOT_LABEL[slot]} picture`;
  return (
    <>
      <button
        ref={thumbRef}
        type="button"
        aria-label={`Enlarge ${SLOT_LABEL[slot].toLowerCase()} picture`}
        aria-haspopup="dialog"
        onClick={() => setZoomOpen(true)}
        className="block w-full cursor-zoom-in rounded border border-gray-200 bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <img src={blob.url} alt={altText} className="aspect-square w-full rounded object-contain" />
      </button>
      {zoomOpen ? (
        <PictureZoomDialog
          url={blob.url}
          title={`${SLOT_LABEL[slot]} picture`}
          altText={image.altText}
          attribution={image.attribution}
          onClose={closeZoom}
          returnFocusRef={thumbRef}
        />
      ) : null}
    </>
  );
}

function PictureTile({
  item,
  selected,
  onToggle,
}: {
  item: ImageReviewQueueItem;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const picture = pictureFor(item);
  return (
    <li
      className={`relative flex flex-col gap-2 rounded-lg border p-2 ${selected ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white"}`}
    >
      <label className="absolute left-2 top-2 z-10 flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded bg-white/90 shadow">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
          aria-label={`Select picture for: ${item.question}`}
          className="h-5 w-5 cursor-pointer accent-indigo-600"
        />
      </label>
      {picture ? (
        <PictureThumb itemId={item.id} slot={picture.slot} image={picture.image} />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-500">
          No picture
        </div>
      )}
      <p className="line-clamp-2 text-xs font-medium text-gray-900" title={item.question}>
        {item.question}
      </p>
      <p className="text-xs text-gray-500">
        {item.imageReview.submittedByDisplay}
        {item.imageReview.submittedAt ? ` · ${formatAge(secondsSince(item.imageReview.submittedAt))} ago` : ""}
      </p>
      {item.isPrivate ? <p className="text-xs text-gray-500">Private item</p> : null}
    </li>
  );
}

/**
 * The "Pictures" tab of the review board (AC 3.26.3, AC 3.26.4): pending picture submissions, oldest first, five per row,
 * 25 per page. Admins tick the pictures to decide, then approve or reject all ticked ones at once.
 */
export function ImageReviewBulkQueue() {
  const { data, isLoading, error, refetch } = useImageReviewQueue(true);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");

  const items = data?.items ?? [];
  const selectedItems = items.filter((item) => selected.has(item.id));
  const count = selectedItems.length;
  const reasonValid = rejectReasonSchema.safeParse(reason).success;

  const decide = useMutation({
    mutationFn: (decision: BulkDecision) =>
      adminApi.setImageReviewBulk({
        decision,
        reason: decision === "reject" ? reason.trim() : undefined,
        items: selectedItems.map((item) => ({ id: item.id, expectedRevision: item.imageReview.revision })),
      }),
    onSuccess: (result, decision) => {
      setSelected(new Set());
      setReason("");
      const verb = decision === "approve" ? "Approved" : "Rejected";
      setMessage(
        result.failed > 0
          ? `${verb} ${result.applied}. ${result.failed} could not be applied because the picture changed or is unavailable; they are still in the queue.`
          : `${verb} ${result.applied}.`,
      );
      void queryClient.invalidateQueries({ queryKey: IMAGE_REVIEW_QUEUE_KEY });
    },
    onError: () => setMessage("Could not save the decisions. Your selection is kept; try again."),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) {
    return <ErrorMessage message="Failed to load the picture review queue" onRetry={() => void refetch()} />;
  }

  const total = data.totalCount;
  const oldest = data.oldestSubmittedAt ?? null;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div>
      <MediaOperations />
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
      <div className="mb-4">
        <p className="text-lg font-medium text-gray-900">
          {total === 1 ? "1 picture submission waiting for review" : `${total} picture submissions waiting for review`}
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

      {items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-500">No pictures waiting for review</p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set(items.map((item) => item.id)))}
              className="min-h-[44px] rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Select all on this page
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-[44px] rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Deselect all
            </button>
            <span className="text-sm text-gray-600">{count} selected</span>
          </div>

          <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {items.map((item) => (
              <PictureTile key={`${item.id}-${item.imageReview.revision}`} item={item} selected={selected.has(item.id)} onToggle={toggle} />
            ))}
          </ul>

          {total > items.length ? (
            <p className="mt-4 text-sm text-gray-500">Showing the oldest {items.length} of {total}. Decide these to load the next ones.</p>
          ) : null}

          <div className="sticky bottom-0 mt-4 space-y-2 rounded-lg border border-gray-200 bg-white p-3 shadow">
            <label htmlFor="bulk-reject-reason" className="block text-sm font-medium text-gray-700">
              Reason for rejection (required to reject; shown to the owner)
            </label>
            <textarea
              id="bulk-reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={MAX_REASON_LENGTH}
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={count === 0 || decide.isPending}
                onClick={() => decide.mutate("approve")}
                className="min-h-[44px] rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {decide.isPending && decide.variables === "approve" ? "Approving..." : `Approve selected (${count})`}
              </button>
              <button
                type="button"
                disabled={count === 0 || !reasonValid || decide.isPending}
                onClick={() => decide.mutate("reject")}
                className="min-h-[44px] rounded-md bg-rose-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {decide.isPending && decide.variables === "reject" ? "Rejecting..." : `Reject selected (${count})`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ImageReviewBulkQueue;
