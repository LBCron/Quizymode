import { useRef } from "react";
import { dialogPrimaryButton, dialogSecondaryButton, TestDialog } from "./TestDialog";

interface SubmitTestDialogProps {
  total: number;
  unanswered: number;
  flagged: number;
  /** Unanswered questions whose picture is unavailable; they will not be scored (#403). */
  notScored?: number;
  onReturn: () => void;
  onShowUnanswered: () => void;
  onShowFlagged: () => void;
  onSubmit: () => void;
}

/** AC 3.18.5: confirmation before Submit. Initial focus is Return to test; Escape also returns. */
export function SubmitTestDialog({
  total,
  unanswered,
  flagged,
  notScored = 0,
  onReturn,
  onShowUnanswered,
  onShowFlagged,
  onSubmit,
}: SubmitTestDialogProps) {
  const returnRef = useRef<HTMLButtonElement>(null);

  return (
    <TestDialog titleId="submit-test-title" title="Submit test?" initialFocusRef={returnRef} onEscape={onReturn}>
      <p className="mt-3 text-sm">
        {unanswered > 0
          ? `${unanswered} unanswered and ${flagged} flagged.`
          : `All ${total} questions are answered.${flagged > 0 ? ` ${flagged} flagged.` : ""}`}
      </p>
      {unanswered > notScored && <p className="mt-1 text-sm">Unanswered questions count as wrong.</p>}
      {notScored > 0 && (
        <p className="mt-1 text-sm">
          {notScored === 1
            ? "1 question with an unavailable picture will not be scored."
            : `${notScored} questions with an unavailable picture will not be scored.`}
        </p>
      )}
      {(unanswered > 0 || flagged > 0) && (
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {unanswered > 0 && (
            <button type="button" onClick={onShowUnanswered} className="font-medium text-indigo-ink underline hover:text-indigo-ink">
              Show unanswered
            </button>
          )}
          {flagged > 0 && (
            <button type="button" onClick={onShowFlagged} className="font-medium text-indigo-ink underline hover:text-indigo-ink">
              Show flagged
            </button>
          )}
        </div>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button ref={returnRef} type="button" onClick={onReturn} className={dialogSecondaryButton}>
          Return to test
        </button>
        <button type="button" onClick={onSubmit} className={dialogPrimaryButton}>
          Submit test
        </button>
      </div>
    </TestDialog>
  );
}
