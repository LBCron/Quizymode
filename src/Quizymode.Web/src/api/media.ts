import { isAxiosError } from "axios";
import { apiClient } from "./client";
export interface ImageSlotInput { assetId?: string; altText?: string; attribution?: string | null; longDescription?: string | null; remove?: boolean }
export interface UploadedImage { id: string; state: string; width: number; height: number; bytes: number; sha256: string }
export const mediaApi = {
  upload: async (file: File, key: string, signal: AbortSignal) => {
    const body = new FormData(); body.append("file", file, "picture");
    return (await apiClient.post<UploadedImage>("/media/images", body, { signal, headers: { "Content-Type": undefined, "Idempotency-Key": key } })).data;
  },
  preview: async (id: string, signal: AbortSignal) => (await apiClient.get<Blob>(`/media/images/${id}/content`, { signal, responseType: "blob" })).data,
  content: async (itemId: string, slot: string, collectionId: string | undefined, signal: AbortSignal, expectedRevision: number) => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) throw new Error("Picture revision unavailable");
    const route = collectionId ? `/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}/images/${slot}` : `/items/${encodeURIComponent(itemId)}/images/${slot}`;
    return (await apiClient.get<Blob>(route, { signal, responseType: "blob", params: { expectedRevision } })).data;
  },
};

/** Stable author-facing messages; never surface provider/storage internals or invent a reset countdown. */
export function mediaUploadErrorMessage(error: unknown): string {
  if (!isAxiosError(error)) return "Picture could not upload. Check your connection and retry.";
  const code = error.response?.data?.title as string | undefined;
  const messages: Record<string, string> = {
    "Media.TooLarge": "Pictures can be up to 2 MiB. Choose a smaller file.",
    "Media.UnsupportedFormat": "Choose a still JPEG, PNG or WebP picture.",
    "Media.Animated": "Choose a still JPEG, PNG or WebP picture; animations are not supported.",
    "Media.Unreadable": "This picture could not be read. Choose another file.",
    "Media.TooManyPixels": "Use at most 16 million pixels and 8192 pixels on either side.",
    "Media.CannotOptimize": "This picture could not be optimized. Choose a simpler or smaller picture.",
    "Media.Busy": "Picture processing is busy. Retry shortly.",
    "Media.ProcessingTimeout": "Picture processing took too long. Retry with a smaller picture.",
    "Media.StorageUnavailable": "Picture storage is unavailable. Retry later.",
    "Media.StorageFailed": "Picture storage failed. Retry later; your other fields are kept.",
    "Media.PendingReviewQuota": "Resolve pending picture reviews before uploading more pictures.",
    "Media.StorageQuota": "Your picture storage allowance is full. Remove unused pictures or resolve reviews; cleanup does not free space immediately.",
    "Media.GlobalStorageQuota": "Picture storage allowance reached. Retry after maintenance.",
    "Media.UploadQuota": "Upload allowance reached. Wait for the upload window to reset before retrying.",
    "Media.GlobalBusy": "Picture processing is busy. Retry shortly.",
    "Media.UploadInProgress": "This upload is still processing. Retry shortly with the same picture.",
    "Media.RequestKeyReused": "Choose the picture again to start a new upload.",
    "Media.RetryLimit": "Choose the picture again to start a new upload.",
    "Media.Withdrawn": "This picture was withdrawn. Choose a different picture and submit it for review.",
  };
  const message = code && messages[code] ? messages[code] : error.response?.status === 413 ? messages["Media.TooLarge"] : error.response?.status === 429 ? "Upload allowance reached. Wait before retrying." : "Picture could not upload. Check your connection and retry.";
  const retryAfter = Number(error.response?.headers?.["retry-after"]);
  return Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 86400 ? `${message} Retry after ${Math.ceil(retryAfter)} seconds.` : message;
}
