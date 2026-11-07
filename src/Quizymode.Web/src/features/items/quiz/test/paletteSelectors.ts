import { summarizeQuizRun, type QuizRunState } from "../quizRun";

export type TestPaletteResult = "correct" | "incorrect" | "unanswered" | "not-scored";

export interface TestPaletteEntry {
  itemId: string;
  /** 1-based roster position. */
  position: number;
  answered: boolean;
  flagged: boolean;
  current: boolean;
  /** Unanswered and its picture is unavailable (now, or skipped at submit): not scored (#403). */
  notScored: boolean;
  /** Set after submit. */
  result?: TestPaletteResult;
}

export interface TestPalette {
  entries: TestPaletteEntry[];
  answered: number;
  unanswered: number;
  flagged: number;
  /** Unanswered questions whose picture is unavailable; they will not be scored. */
  notScored: number;
}

/** Pure selector behind the question palette and the Submit confirmation counts (AC 3.18.4, 3.18.5). */
export function getTestPalette(
  run: QuizRunState,
  currentIndex: number,
  unavailableItemIds: readonly string[] = [],
): TestPalette {
  const submitted = run.submittedAt !== null;
  const flagged = new Set(run.flagged);
  const unavailable = new Set([...unavailableItemIds, ...run.skipped]);
  const entries = run.itemIds.map((itemId, index): TestPaletteEntry => {
    const outcome = run.outcomes[itemId];
    const entry: TestPaletteEntry = {
      itemId,
      position: index + 1,
      answered: Boolean(outcome),
      flagged: flagged.has(itemId),
      current: index === currentIndex,
      notScored: !outcome && (submitted ? run.skipped.includes(itemId) : unavailable.has(itemId)),
    };
    if (submitted) {
      entry.result = outcome ? (outcome.isCorrect ? "correct" : "incorrect") : entry.notScored ? "not-scored" : "unanswered";
    }
    return entry;
  });
  const answered = summarizeQuizRun(run).answered;
  return {
    entries,
    answered,
    unanswered: run.itemIds.length - answered,
    flagged: run.flagged.length,
    notScored: entries.filter((entry) => entry.notScored).length,
  };
}

/** Screen-reader name, for example "Question 7, answered, flagged, current". */
export function paletteEntryLabel(entry: TestPaletteEntry): string {
  const parts = [`Question ${entry.position}`, entry.answered ? "answered" : "unanswered"];
  if (entry.flagged) parts.push("flagged");
  if (entry.current) parts.push("current");
  if (entry.notScored) parts.push("not scored (picture unavailable)");
  return parts.join(", ");
}
