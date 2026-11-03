import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";

export const IMAGE_REVIEW_QUEUE_KEY = ["admin", "image-review-queue"] as const;

/** The pending picture review queue (first page, oldest submission first); shared by the tab label and the queue. */
export function useImageReviewQueue(enabled: boolean) {
  return useQuery({
    queryKey: IMAGE_REVIEW_QUEUE_KEY,
    queryFn: () => adminApi.getImageReviewQueue("PendingReview", 1, 25),
    enabled,
  });
}
