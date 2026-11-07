import { Link } from "react-router-dom";
import type { ItemImageReviewInfo } from "@/types/api";

interface ImageReviewStatusProps {
  itemId: string;
  imageReview?: ItemImageReviewInfo | null;
}

/** Owner-facing picture review status (AC 3.26.5). Renders nothing when the item has no review state to show. */
export function ImageReviewStatus({ itemId, imageReview }: ImageReviewStatusProps) {
  if (!imageReview) return null;

  switch (imageReview.state) {
    case "PendingReview":
      return <p className="mt-1 text-xs text-amber-700">Pictures: Pending review</p>;
    case "Approved":
      return <p className="mt-1 text-xs text-green-700">Pictures: Approved</p>;
    case "Processing":
      return <p className="mt-1 text-xs text-amber-700">Pictures: Processing</p>;
    case "Failed":
      return (
        <div className="mt-1 text-xs">
          <p className="text-red-700">Pictures: Failed</p>
          <Link to={`/items/${itemId}/edit`} className="mt-1 block text-indigo-ink underline">
            Edit to resubmit
          </Link>
        </div>
      );
    case "Withdrawn":
      return <p className="mt-1 text-xs text-gray-600">Pictures: Withdrawn</p>;
    case "Rejected": {
      const reason = imageReview.reason?.trim();
      return (
        <div className="mt-1 text-xs">
          <p className="break-words text-red-700">
            {reason ? `Pictures: Rejected — ${reason}` : "Pictures: Rejected"}
          </p>
          <Link to={`/items/${itemId}/edit`} className="mt-1 block text-indigo-ink underline">
            Edit to resubmit
          </Link>
        </div>
      );
    }
    default:
      return null;
  }
}
