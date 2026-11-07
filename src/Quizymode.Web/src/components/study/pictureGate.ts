import { useCallback, useState } from "react";
import type { ItemResponse } from "@/types/api";
import type { PictureStatus } from "@/components/study/QuestionImage";

/**
 * Per-item state of the question picture (#403). A picture item is "blocked" until its picture has loaded, so answers
 * are never enabled for a paint. Statuses are keyed by item id; the picture component reports "loading" before paint
 * every time it mounts, which also resets a stale "loaded" for an item the learner comes back to.
 */
export interface QuestionPictureControls {
  /** True while the item has a question picture that has not loaded: answering is off. */
  blocked: boolean;
  /** Last reported status of this item's picture; "error", "stuck" and "unknown" are the problem states. */
  status?: PictureStatus;
  onStatusChange: (status: PictureStatus) => void;
  /** Offered with Retry when the picture failed or is stuck; absent where a question cannot be skipped. */
  onSkip?: () => void;
}

export const PICTURE_REQUIRED_NOTE_ID = "picture-required-note";

export interface QuestionPictureStatuses {
  /** True when the item has a question picture that is not loaded (including never reported). */
  isBlocked: (item: Pick<ItemResponse, "id" | "questionImage"> | null | undefined) => boolean;
  controlsFor: (item: ItemResponse, onSkip?: () => void) => QuestionPictureControls;
  /** Items whose picture failed, is stuck or is unknown right now. Initial, unknown and still-loading pictures are excluded too. */
  unavailableIds: (items: ReadonlyArray<Pick<ItemResponse, "id" | "questionImage">>) => string[];
  statusOf: (itemId: string) => PictureStatus | undefined;
}

export function useQuestionPictureStatuses(): QuestionPictureStatuses {
  const [statuses, setStatuses] = useState<Record<string, PictureStatus>>({});

  const report = useCallback((itemId: string, status: PictureStatus) => {
    setStatuses((previous) => (previous[itemId] === status ? previous : { ...previous, [itemId]: status }));
  }, []);

  const isBlocked = useCallback<QuestionPictureStatuses["isBlocked"]>(
    (item) => Boolean(item?.questionImage) && statuses[item!.id] !== "loaded",
    [statuses],
  );

  const controlsFor = useCallback<QuestionPictureStatuses["controlsFor"]>(
    (item, onSkip) => ({
      blocked: isBlocked(item),
      status: statuses[item.id],
      onStatusChange: (status) => report(item.id, status),
      onSkip,
    }),
    [isBlocked, report, statuses],
  );

  const unavailableIds = useCallback<QuestionPictureStatuses["unavailableIds"]>(
    (items) =>
      items
        .filter((item) => Boolean(item.questionImage) && statuses[item.id] !== "loaded")
        .map((item) => item.id),
    [statuses],
  );

  const statusOf = useCallback((itemId: string) => statuses[itemId], [statuses]);

  return { isBlocked, controlsFor, unavailableIds, statusOf };
}
