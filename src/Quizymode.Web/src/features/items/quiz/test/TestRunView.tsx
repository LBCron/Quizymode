import { useMemo, useState } from "react";
import { FlagIcon as FlagOutlineIcon } from "@heroicons/react/24/outline";
import { FlagIcon as FlagSolidIcon } from "@heroicons/react/24/solid";
import type { ItemResponse } from "@/types/api";
import { QuizRenderer } from "@/components/study/QuizRenderer";
import type { QuestionPictureStatuses } from "@/components/study/pictureGate";
import { StudyShell, type StudyShellProps } from "@/components/study/StudyShell";
import { getQuizOptions, type QuizRunState } from "../quizRun";
import { SubmitTestDialog } from "./SubmitTestDialog";
import { TestPalettePanel } from "./TestPalette";
import { TestTimer } from "./TestTimer";
import { getTestPalette } from "./paletteSelectors";

type PassThroughShellProps = Pick<
  StudyShellProps,
  | "backContent"
  | "description"
  | "headerExtra"
  | "navigationContext"
  | "onOpenComments"
  | "onOpenManageCollections"
  | "isAuthenticated"
  | "onOpenShortcuts"
  | "footerContent"
>;

interface TestRunViewProps {
  run: QuizRunState;
  items: ItemResponse[];
  currentIndex: number;
  /** Seconds left, or null when the test has no time limit. */
  remainingSec: number | null;
  shell: PassThroughShellProps;
  /** Question picture statuses, owned by the page so its answer handlers and hotkeys share the same gate (#403). */
  pictures: QuestionPictureStatuses;
  onPrev: () => void;
  onNext: () => void;
  onSkip?: () => void;
  onJump: (index: number) => void;
  onAnswer: (answer: string) => void;
  onToggleFlag: () => void;
  /** Called with the ids of questions whose picture is unavailable right now; they are left out of the score. */
  onSubmit: (unavailableItemIds: string[]) => void;
}

/**
 * A started, unsubmitted Test (AC 3.18.3-3.18.5): the question with deferred feedback, flag, palette, timer
 * and the Submit confirmation. Lifecycle, persistence and analytics stay in the page.
 */
export function TestRunView({
  run,
  items,
  currentIndex,
  remainingSec,
  shell,
  pictures,
  onPrev,
  onNext,
  onSkip,
  onJump,
  onAnswer,
  onToggleFlag,
  onSubmit,
}: TestRunViewProps) {
  const [submitOpen, setSubmitOpen] = useState(false);
  const currentItem = items[currentIndex];
  const unavailableIds = pictures.unavailableIds(items);
  const palette = getTestPalette(run, currentIndex, unavailableIds);
  const options = useMemo(() => (currentItem ? getQuizOptions(currentItem, run.runId) : []), [currentItem, run.runId]);
  const isFlagged = currentItem ? run.flagged.includes(currentItem.id) : false;
  const selectedAnswer = currentItem ? (run.outcomes[currentItem.id]?.selectedAnswer ?? null) : null;

  const jumpToFirst = (predicate: (entry: (typeof palette.entries)[number]) => boolean): void => {
    const index = palette.entries.findIndex(predicate);
    setSubmitOpen(false);
    if (index !== -1) onJump(index);
  };

  return (
    <>
      <StudyShell
        {...shell}
        currentIndex={currentIndex}
        totalCount={items.length}
        onPrev={onPrev}
        onNext={onNext}
        isPrevDisabled={currentIndex === 0}
        isNextDisabled={currentIndex >= items.length - 1}
        currentItem={currentItem}
        showRatingsAndCollections={false}
        hideItemDetailsLink
      >
        {currentItem && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {remainingSec !== null ? <TestTimer remainingSec={remainingSec} /> : <span className="text-sm font-semibold text-gray-800">Test in progress</span>}
              <button
                type="button"
                onClick={() => setSubmitOpen(true)}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Submit test
              </button>
            </div>

            {currentItem.questionImage && pictures.isBlocked(currentItem) && <p role="status" className="text-sm text-amber-800">Timer paused while this required picture is unavailable. Retry or skip; unresolved pictures are not scored.</p>}
            <TestPalettePanel palette={palette} currentIndex={currentIndex} onSelect={onJump} />

            <QuizRenderer
              item={currentItem}
              options={options}
              selectedAnswer={selectedAnswer}
              showAnswer={false}
              revealFeedback={false}
              onAnswerSelect={onAnswer}
              stats={{ total: palette.answered, correct: 0 }}
              questionPicture={{ ...pictures.controlsFor(currentItem, run.skipped.includes(currentItem.id) ? undefined : onSkip), blocked: run.skipped.includes(currentItem.id) || pictures.isBlocked(currentItem) }}
            />

            <button
              type="button"
              onClick={onToggleFlag}
              aria-pressed={isFlagged}
              aria-keyshortcuts="F"
              className={`inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:w-auto ${
                isFlagged ? "border-amber-500 bg-amber-50 text-amber-800" : "border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {isFlagged ? <FlagSolidIcon className="h-4 w-4" aria-hidden="true" /> : <FlagOutlineIcon className="h-4 w-4" aria-hidden="true" />}
              Flag for review
            </button>
          </>
        )}
      </StudyShell>

      {submitOpen && (
        <SubmitTestDialog
          total={items.length}
          unanswered={palette.unanswered}
          flagged={palette.flagged}
          notScored={palette.notScored}
          onReturn={() => setSubmitOpen(false)}
          onShowUnanswered={() => jumpToFirst((entry) => !entry.answered)}
          onShowFlagged={() => jumpToFirst((entry) => entry.flagged)}
          onSubmit={() => {
            setSubmitOpen(false);
            onSubmit(unavailableIds);
          }}
        />
      )}
    </>
  );
}
