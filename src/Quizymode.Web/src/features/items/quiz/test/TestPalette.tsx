import { useRef, useState } from "react";
import { CheckIcon, ExclamationTriangleIcon, FlagIcon } from "@heroicons/react/24/solid";
import { dialogSecondaryButton, TestDialog } from "./TestDialog";
import { paletteEntryLabel, type TestPalette as TestPaletteData } from "./paletteSelectors";

interface PaletteGridProps {
  palette: TestPaletteData;
  onSelect: (index: number) => void;
}

function PaletteGrid({ palette, onSelect }: PaletteGridProps) {
  return (
    <>
      <div className="grid grid-cols-5 gap-2">
        {palette.entries.map((entry, index) => (
          <button
            key={entry.itemId}
            type="button"
            onClick={() => onSelect(index)}
            aria-label={paletteEntryLabel(entry)}
            aria-current={entry.current ? "step" : undefined}
            className={`relative flex h-11 w-11 items-center justify-center rounded-md border text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              entry.notScored
                ? "border-dashed border-amber-500 bg-amber-50 text-amber-900"
                : entry.answered
                  ? "border-panel-raised bg-panel-raised text-white"
                  : "border-gray-300 bg-surface text-gray-800"
            } ${entry.current ? "ring-2 ring-indigo-500 ring-offset-2" : ""}`}
          >
            <span aria-hidden="true">{entry.position}</span>
            {entry.answered && (
              <CheckIcon className="absolute bottom-0.5 right-0.5 h-3 w-3 text-white" aria-hidden="true" />
            )}
            {entry.notScored && (
              <ExclamationTriangleIcon className="absolute bottom-0.5 right-0.5 h-3 w-3 text-amber-700" aria-hidden="true" />
            )}
            {entry.flagged && (
              <FlagIcon
                className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-amber-100 p-0.5 text-amber-700"
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-600">
        <span className="font-medium">Answered</span> (check) · <span className="font-medium">Unanswered</span> (number only) ·{" "}
        <span className="font-medium">Flagged</span> (flag)
        {palette.notScored > 0 && (
          <>
            {" "}
            · <span className="font-medium">Not scored (picture unavailable)</span> (warning)
          </>
        )}
      </p>
    </>
  );
}

function counts(palette: TestPaletteData): string {
  const text = `${palette.answered} answered · ${palette.unanswered} unanswered · ${palette.flagged} flagged`;
  return palette.notScored > 0 ? `${text} · ${palette.notScored} not scored` : text;
}

interface TestPalettePanelProps {
  palette: TestPaletteData;
  currentIndex: number;
  onSelect: (index: number) => void;
}

/** AC 3.18.4. Wide screens show a card; narrow screens show a summary bar that opens a modal sheet. */
export function TestPalettePanel({ palette, currentIndex, onSelect }: TestPalettePanelProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeSheet = (): void => {
    setSheetOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-300 px-3 py-2 text-left text-sm text-gray-800 sm:hidden"
      >
        <span>
          Questions {currentIndex + 1} of {palette.entries.length} · {palette.answered} answered · {palette.flagged} flagged
        </span>
        <span className="font-semibold text-indigo-ink">Show</span>
      </button>

      <section aria-label="Question palette" className="hidden rounded-lg border border-gray-200 p-3 sm:block">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Questions</h3>
        <p className="mb-3 text-xs text-gray-600">{counts(palette)}</p>
        <PaletteGrid palette={palette} onSelect={onSelect} />
      </section>

      {sheetOpen && (
        <TestDialog titleId="test-palette-title" title="Questions" initialFocusRef={closeRef} onEscape={closeSheet}>
          <p className="mt-2 text-xs text-gray-600">{counts(palette)}</p>
          <div className="mt-3">
            <PaletteGrid
              palette={palette}
              onSelect={(index) => {
                onSelect(index);
                closeSheet();
              }}
            />
          </div>
          <div className="mt-5 flex justify-end">
            <button ref={closeRef} type="button" onClick={closeSheet} className={dialogSecondaryButton}>
              Close
            </button>
          </div>
        </TestDialog>
      )}
    </>
  );
}
