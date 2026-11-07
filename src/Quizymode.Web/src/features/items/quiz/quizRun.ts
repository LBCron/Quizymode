import type { ItemResponse } from "@/types/api";
import { categoryNameToSlug } from "@/utils/categorySlug";

export const QUIZ_RUN_SCHEMA_VERSION = 3;
/** Snapshot versions restore accepts: v2 predates per-answer inputMode and restores as multiple choice (AC 3.6.12). */
const RESTORABLE_SCHEMA_VERSIONS: readonly number[] = [2, QUIZ_RUN_SCHEMA_VERSION];
export const QUIZ_COMPLETED_EVENT = "quizymode:quiz-completed";
/** Test (AC 3.18): time limit bounds in seconds, and the Test roster cap (quiz analytics position/total stay at 500). */
export const TEST_MIN_LIMIT_SEC = 60;
export const TEST_MAX_LIMIT_SEC = 36000;
export const TEST_MAX_QUESTIONS = 500;

export type QuizRunView = "active" | "summary" | "review" | "review-all";
export type QuizRunMode = "practice" | "test";
export type QuizInputMode = "choice" | "typed";
export type TestSubmitReason = "manual" | "timeout";

export type QuizRunScope =
  | { kind: "collection"; collectionId: string }
  | {
      kind: "category" | "global";
      category: string | null;
      navigationKeywords: string[];
      filterKeywords: string[];
      quizSize: number;
    };

export interface QuizAnswerOutcome {
  itemId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  /** How the answer was given: a multiple-choice option or a typed answer (AC 3.6.19). */
  inputMode: QuizInputMode;
}

export interface QuizRunState {
  schemaVersion: typeof QUIZ_RUN_SCHEMA_VERSION;
  runId: string;
  identityKey: string;
  scope: QuizRunScope;
  itemIds: string[];
  outcomes: Record<string, QuizAnswerOutcome>;
  /** Practice reveals feedback per answer; Test hides it until submit (AC 3.18). */
  mode: QuizRunMode;
  /**
   * Items skipped because their picture was unavailable (#403), in roster order. They are not scored: they count in
   * neither correct, scored total nor missed. Optional in stored v3 snapshots (read as empty).
   */
  skipped: string[];
  skippedReasons?: Record<string, "picture-unavailable" | "picture-inaccessible">;
  /** Test only: flagged item ids in roster order. Always empty in Practice. */
  flagged: string[];
  /** Test only: ISO time of Start test; null on the setup card and in Practice. */
  startedAt: string | null;
  picturePausedAt?: string | null;
  picturePausedMs?: number;
  /** Test only: overall limit in seconds, or null for no limit. */
  timeLimitSec: number | null;
  /** Test only: ISO time of submit (the deadline for a timeout). */
  submittedAt: string | null;
  submitReason: TestSubmitReason | null;
  view: QuizRunView;
  completedAt: string | null;
  completionEmitted: boolean;
}

export interface QuizRunSummary {
  answered: number;
  correct: number;
  /** Roster size, including skipped items (Daily posts this as its total). */
  total: number;
  /** Items skipped because their picture was unavailable (#403). */
  skipped: number;
  /** Roster size minus skipped: what correct is scored against. 0 means nothing was scored. */
  scoredTotal: number;
  /** Wrong answers first, then (submitted Test) unanswered items in roster order. */
  missedItemIds: string[];
  /** Roster items with no answer that were not skipped. */
  notAnswered: number;
  percentage: number;
  isComplete: boolean;
}

/** Study mode a completed run was played in (issue #306). */
export type StudySessionMode = "quiz" | "learn";

export interface QuizCompletionSnapshot {
  readonly runId: string;
  readonly scope: QuizRunScope;
  readonly completedAt: string;
  readonly correct: number;
  readonly total: number;
  readonly missedItemIds: readonly string[];
  /** Defaults to "quiz" when omitted (issue #306). */
  readonly mode?: StudySessionMode;
}

export type QuizRunAction =
  | { type: "picture-pause"; paused: boolean; at: string }
  | { type: "answer"; itemId: string; selectedAnswer: string; isCorrect: boolean; completedAt: string; inputMode?: QuizInputMode }
  | { type: "start-test"; startedAt: string; timeLimitSec: number | null }
  | { type: "toggle-flag"; itemId: string }
  /** `unavailableItemIds`: items whose picture was unavailable at submit; they become skipped (unanswered ones only). */
  | { type: "submit"; submittedAt: string; reason: TestSubmitReason; unavailableItemIds?: string[] }
  /** Practice: skip an unanswered item whose picture is unavailable (#403); it is not scored. */
  | { type: "skip-unavailable"; itemId: string; completedAt: string; reason?: "picture-unavailable" | "picture-inaccessible" }
  | { type: "show-summary" }
  | { type: "review-mistakes" }
  | { type: "review-all" }
  | { type: "mark-completion-emitted" };

function newRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function uniqueItemIds(items: Pick<ItemResponse, "id">[]): string[] {
  return Array.from(new Set(items.map((item) => item.id).filter(Boolean)));
}

export function createQuizRun(
  scope: QuizRunScope,
  itemIds: string[],
  identityKey: string,
  mode: QuizRunMode = "practice",
): QuizRunState {
  return {
    schemaVersion: QUIZ_RUN_SCHEMA_VERSION,
    runId: newRunId(),
    identityKey,
    scope,
    itemIds: Array.from(new Set(itemIds.filter(Boolean))),
    outcomes: {},
    mode,
    skipped: [],
    flagged: [],
    startedAt: null,
    timeLimitSec: null,
    submittedAt: null,
    submitReason: null,
    view: "active",
    completedAt: null,
    completionEmitted: false,
  };
}

/** Test deadline in epoch ms, or null when the Test has no limit or has not started. */
export function getTestDeadlineMs(run: Pick<QuizRunState, "startedAt" | "timeLimitSec" | "picturePausedMs">): number | null {
  if (!run.startedAt || run.timeLimitSec === null) return null;
  const started = Date.parse(run.startedAt);
  return Number.isNaN(started) ? null : started + run.timeLimitSec * 1000 + (run.picturePausedMs ?? 0);
}

/** True once a Test has been started and not yet submitted. */
export function isTestInProgress(run: Pick<QuizRunState, "mode" | "startedAt" | "submittedAt">): boolean {
  return run.mode === "test" && run.startedAt !== null && run.submittedAt === null;
}

export function summarizeQuizRun(run: QuizRunState): QuizRunSummary {
  const outcomes = run.itemIds
    .map((itemId) => run.outcomes[itemId])
    .filter((outcome): outcome is QuizAnswerOutcome => Boolean(outcome));
  const correct = outcomes.filter((outcome) => outcome.isCorrect).length;
  const total = run.itemIds.length;
  const skippedIds = new Set(run.skipped.filter((itemId) => !run.outcomes[itemId]));
  const scoredTotal = total - skippedIds.size;
  const wrong = outcomes.filter((outcome) => !outcome.isCorrect).map((outcome) => outcome.itemId);
  const unanswered = run.itemIds.filter((itemId) => !run.outcomes[itemId] && !skippedIds.has(itemId));
  const isTest = run.mode === "test";

  return {
    answered: outcomes.length,
    correct,
    total,
    skipped: skippedIds.size,
    scoredTotal,
    // A submitted Test scores unanswered questions as wrong (AC 3.18.8), listed after the wrong answers.
    // Skipped items (unavailable picture) are in neither list (#403).
    missedItemIds: isTest && run.submittedAt !== null ? [...wrong, ...unanswered] : wrong,
    notAnswered: unanswered.length,
    percentage: scoredTotal === 0 ? 0 : Math.round((correct / scoredTotal) * 100),
    // Practice is complete once every item is answered or skipped; all skipped is complete with nothing scored.
    isComplete: isTest ? total > 0 && run.submittedAt !== null : total > 0 && outcomes.length + skippedIds.size === total,
  };
}

export function reduceQuizRun(run: QuizRunState, action: QuizRunAction): QuizRunState {
  if (action.type === "picture-pause") {
    if (!isTestInProgress(run) || run.timeLimitSec === null || Number.isNaN(Date.parse(action.at))) return run;
    if (action.paused) return run.picturePausedAt ? run : { ...run, picturePausedAt: action.at };
    if (!run.picturePausedAt) return run;
    return { ...run, picturePausedMs: (run.picturePausedMs ?? 0) + Math.max(0, Date.parse(action.at) - Date.parse(run.picturePausedAt)), picturePausedAt: null };
  }
  if (action.type === "start-test") {
    if (run.mode !== "test" || run.startedAt !== null || Number.isNaN(Date.parse(action.startedAt))) return run;
    if (
      action.timeLimitSec !== null &&
      (!Number.isInteger(action.timeLimitSec) ||
        action.timeLimitSec < TEST_MIN_LIMIT_SEC ||
        action.timeLimitSec > TEST_MAX_LIMIT_SEC)
    ) {
      return run;
    }
    return { ...run, startedAt: action.startedAt, timeLimitSec: action.timeLimitSec };
  }

  if (action.type === "toggle-flag") {
    if (!isTestInProgress(run) || !run.itemIds.includes(action.itemId)) return run;
    const flagged = new Set(run.flagged);
    if (!flagged.delete(action.itemId)) flagged.add(action.itemId);
    return { ...run, flagged: run.itemIds.filter((itemId) => flagged.has(itemId)) };
  }

  if (action.type === "submit") {
    if (!isTestInProgress(run)) return run;
    const submittedMs = Date.parse(action.submittedAt);
    if (Number.isNaN(submittedMs)) return run;
    let submittedAt = action.submittedAt;
    let reason = action.reason;
    const activePauseMs = run.picturePausedAt ? Math.max(0, submittedMs - Date.parse(run.picturePausedAt)) : 0;
    const deadline = getTestDeadlineMs({ ...run, picturePausedMs: (run.picturePausedMs ?? 0) + activePauseMs });
    if (deadline !== null && submittedMs >= deadline) {
      // The deadline is the completion time, however late the submit arrives (AC 3.18.6).
      submittedAt = new Date(deadline).toISOString();
      reason = "timeout";
    }
    const unavailable = new Set(action.unavailableItemIds ?? []);
    const skipped = run.itemIds.filter((itemId) => !run.outcomes[itemId] && (unavailable.has(itemId) || run.skipped.includes(itemId)));
    return { ...run, skipped, submittedAt, submitReason: reason, completedAt: submittedAt, view: "summary", picturePausedAt: null, picturePausedMs: (run.picturePausedMs ?? 0) + activePauseMs };
  }

  if (action.type === "skip-unavailable") {
    if (run.view !== "active" || (run.mode === "test" && !isTestInProgress(run)) || !run.itemIds.includes(action.itemId)) return run;
    if (run.outcomes[action.itemId] || run.skipped.includes(action.itemId)) return run;
    const skipped = run.itemIds.filter((itemId) => itemId === action.itemId || run.skipped.includes(itemId));
    const updated: QuizRunState = { ...run, skipped, skippedReasons: { ...run.skippedReasons, [action.itemId]: action.reason ?? "picture-unavailable" } };
    if (run.mode === "test") return updated;
    return { ...updated, completedAt: summarizeQuizRun(updated).isComplete ? action.completedAt : null };
  }

  if (action.type === "review-all") {
    return run.mode === "test" && run.submittedAt !== null ? { ...run, view: "review-all" } : run;
  }

  if (action.type === "answer") {
    if (!run.itemIds.includes(action.itemId) || run.skipped.includes(action.itemId)) return run;

    if (run.mode === "test") {
      // Test: the last answer before submit counts; answers at or after the deadline are ignored.
      if (!isTestInProgress(run)) return run;
      const answeredAt = Date.parse(action.completedAt);
      const deadline = getTestDeadlineMs(run);
      if (Number.isNaN(answeredAt) || (deadline !== null && answeredAt >= deadline)) return run;
      return {
        ...run,
        outcomes: {
          ...run.outcomes,
          [action.itemId]: {
            itemId: action.itemId,
            selectedAnswer: action.selectedAnswer,
            isCorrect: action.isCorrect,
            inputMode: action.inputMode ?? "choice",
          },
        },
      };
    }

    if (run.outcomes[action.itemId] || run.skipped.includes(action.itemId)) return run;

    const outcomes = {
      ...run.outcomes,
      [action.itemId]: {
        itemId: action.itemId,
        selectedAnswer: action.selectedAnswer,
        isCorrect: action.isCorrect,
        inputMode: action.inputMode ?? "choice",
      },
    };
    const isComplete = run.itemIds.every((itemId) => Boolean(outcomes[itemId]) || run.skipped.includes(itemId));

    return {
      ...run,
      outcomes,
      completedAt: isComplete ? action.completedAt : null,
    };
  }

  if (action.type === "show-summary") {
    return summarizeQuizRun(run).isComplete ? { ...run, view: "summary" } : run;
  }

  if (action.type === "review-mistakes") {
    return summarizeQuizRun(run).missedItemIds.length > 0 ? { ...run, view: "review" } : run;
  }

  return run.completionEmitted ? run : { ...run, completionEmitted: true };
}

function sameStringArray(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameQuizScope(left: unknown, right: QuizRunScope): boolean {
  if (!left || typeof left !== "object") return false;
  const candidate = left as Partial<QuizRunScope>;
  if (candidate.kind !== right.kind) return false;
  if (right.kind === "collection") {
    return "collectionId" in candidate && candidate.collectionId === right.collectionId;
  }

  return (
    "category" in candidate &&
    candidate.category === right.category &&
    "quizSize" in candidate &&
    candidate.quizSize === right.quizSize &&
    "navigationKeywords" in candidate &&
    sameStringArray(candidate.navigationKeywords, right.navigationKeywords) &&
    "filterKeywords" in candidate &&
    sameStringArray(candidate.filterKeywords, right.filterKeywords)
  );
}

/**
 * Size the saved category/global run was started with, so a reload seeds the size control with it
 * (AC 3.6.12, 3.18.7). Null unless the saved run belongs to this identity and URL scope.
 */
export function readPersistedQuizSize(
  context: unknown,
  identityKey: string,
  categorySlug: string | undefined,
): number | null {
  if (!context || typeof context !== "object") return null;
  const candidate = context as { mode?: unknown; quizRun?: unknown };
  if (candidate.mode !== "quiz") return null;
  if (!candidate.quizRun || typeof candidate.quizRun !== "object") return null;
  const savedRun = candidate.quizRun as { identityKey?: unknown; scope?: unknown };
  if (savedRun.identityKey !== identityKey) return null;
  if (!savedRun.scope || typeof savedRun.scope !== "object") return null;
  const scope = savedRun.scope as {
    kind?: unknown;
    category?: unknown;
    quizSize?: unknown;
  };

  if (scope.kind === "global") {
    if (categorySlug) return null;
  } else if (scope.kind === "category") {
    if (
      !categorySlug ||
      typeof scope.category !== "string" ||
      categoryNameToSlug(scope.category).toLowerCase() !== categorySlug.toLowerCase()
    ) {
      return null;
    }
  } else {
    return null;
  }

  const size = scope.quizSize;
  return typeof size === "number" && Number.isInteger(size) && size >= 1 && size <= 1000
    ? size
    : null;
}

export function restoreQuizRun(
  value: unknown,
  expectedScope: QuizRunScope,
  expectedItemIds: string[],
  identityKey: string,
  expectedMode: QuizRunMode = "practice",
): QuizRunState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<QuizRunState>;
  if (
    typeof candidate.schemaVersion !== "number" ||
    !RESTORABLE_SCHEMA_VERSIONS.includes(candidate.schemaVersion) ||
    candidate.mode !== expectedMode ||
    typeof candidate.runId !== "string" ||
    candidate.runId.length === 0 ||
    candidate.runId.length > 128 ||
    candidate.identityKey !== identityKey ||
    !sameQuizScope(candidate.scope, expectedScope) ||
    !sameStringArray(candidate.itemIds, expectedItemIds) ||
    !candidate.outcomes ||
    typeof candidate.outcomes !== "object" ||
    !["active", "summary", "review", "review-all"].includes(candidate.view ?? "") ||
    typeof candidate.completionEmitted !== "boolean"
  ) {
    return null;
  }

  const testFields = restoreTestFields(candidate, expectedMode, expectedItemIds);
  if (!testFields) return null;

  const outcomes: Record<string, QuizAnswerOutcome> = {};
  if (Object.keys(candidate.outcomes).some((itemId) => !expectedItemIds.includes(itemId))) {
    return null;
  }
  for (const itemId of expectedItemIds) {
    const outcome = candidate.outcomes[itemId];
    if (outcome === undefined) continue;
    if (
      !outcome ||
      outcome.itemId !== itemId ||
      typeof outcome.selectedAnswer !== "string" ||
      typeof outcome.isCorrect !== "boolean"
    ) {
      return null;
    }
    // v2 snapshots carry no inputMode: those answers were multiple choice. In v3 it is required and validated.
    const inputMode: unknown = outcome.inputMode ?? ((candidate.schemaVersion as number) === 2 ? "choice" : undefined);
    if (inputMode !== "choice" && inputMode !== "typed") return null;
    // Test hides the answer until submit and has no typed input (AC 3.18.3).
    if (inputMode === "typed" && expectedMode === "test") return null;
    outcomes[itemId] = {
      itemId,
      selectedAnswer: outcome.selectedAnswer,
      isCorrect: outcome.isCorrect,
      inputMode,
    };
  }

  // `skipped` (#403) is optional in stored snapshots (v2 and early v3 predate it) and must be a clean subset otherwise.
  const rawSkipped: unknown = candidate.skipped ?? [];
  if (
    !Array.isArray(rawSkipped) ||
    rawSkipped.some((id) => typeof id !== "string" || !expectedItemIds.includes(id) || Boolean(outcomes[id])) ||
    new Set(rawSkipped).size !== rawSkipped.length
  ) {
    return null;
  }
  const skipped = expectedItemIds.filter((id) => rawSkipped.includes(id));
  const rawReasons = candidate.skippedReasons;
  if (rawReasons !== undefined && (!rawReasons || typeof rawReasons !== "object" || Object.entries(rawReasons).some(([id, reason]) => !skipped.includes(id) || !["picture-unavailable", "picture-inaccessible"].includes(String(reason))))) return null;

  const completedAt = candidate.completedAt;
  if (completedAt !== null && (typeof completedAt !== "string" || Number.isNaN(Date.parse(completedAt)))) {
    return null;
  }

  const restored: QuizRunState = {
    schemaVersion: QUIZ_RUN_SCHEMA_VERSION,
    runId: candidate.runId,
    identityKey,
    scope: expectedScope,
    itemIds: [...expectedItemIds],
    outcomes,
    mode: expectedMode,
    skipped,
    skippedReasons: rawReasons as QuizRunState["skippedReasons"],
    ...testFields,
    ...(candidate.picturePausedAt !== undefined ? { picturePausedAt: typeof candidate.picturePausedAt === "string" && !Number.isNaN(Date.parse(candidate.picturePausedAt)) ? candidate.picturePausedAt : null } : {}),
    ...(candidate.picturePausedMs !== undefined ? { picturePausedMs: typeof candidate.picturePausedMs === "number" && Number.isFinite(candidate.picturePausedMs) && candidate.picturePausedMs >= 0 ? candidate.picturePausedMs : 0 } : {}),
    view: candidate.view as QuizRunView,
    completedAt: completedAt ?? null,
    completionEmitted: candidate.completionEmitted,
  };

  const summary = summarizeQuizRun(restored);
  if (summary.isComplete !== Boolean(restored.completedAt)) return null;
  if (!summary.isComplete && restored.view !== "active") return null;
  if (!summary.isComplete && restored.completionEmitted) return null;
  if (restored.view === "review" && summary.missedItemIds.length === 0) return null;
  if (restored.view === "review-all" && expectedMode !== "test") return null;
  if (restored.mode === "test" && restored.submittedAt !== null && restored.view === "active") return null;
  if (restored.mode === "test" && restored.submittedAt !== null && restored.completedAt !== restored.submittedAt) {
    return null;
  }
  return restored;
}

type RestoredTestFields = Pick<
  QuizRunState,
  "flagged" | "startedAt" | "timeLimitSec" | "submittedAt" | "submitReason"
>;

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** AC 3.18.7: validates the Test fields of a stored snapshot; null rejects the whole snapshot. */
function restoreTestFields(
  candidate: Partial<QuizRunState>,
  mode: QuizRunMode,
  itemIds: string[],
): RestoredTestFields | null {
  const { flagged, startedAt, timeLimitSec, submittedAt, submitReason } = candidate;
  const none: RestoredTestFields = { flagged: [], startedAt: null, timeLimitSec: null, submittedAt: null, submitReason: null };

  if (mode === "practice") {
    const carriesTestFields =
      !Array.isArray(flagged) ||
      flagged.length > 0 ||
      startedAt !== null ||
      timeLimitSec !== null ||
      submittedAt !== null ||
      submitReason !== null;
    return carriesTestFields ? null : none;
  }

  if (!Array.isArray(flagged) || flagged.some((id) => typeof id !== "string" || !itemIds.includes(id))) return null;
  if (new Set(flagged).size !== flagged.length) return null;

  if (startedAt === null) {
    // Setup card: nothing may have happened yet.
    const untouched =
      flagged.length === 0 &&
      timeLimitSec === null &&
      submittedAt === null &&
      submitReason === null &&
      candidate.view === "active" &&
      candidate.completedAt === null &&
      candidate.completionEmitted === false &&
      Object.keys(candidate.outcomes ?? {}).length === 0;
    return untouched ? none : null;
  }

  const startedMs = parseTimestamp(startedAt);
  if (startedMs === null || typeof startedAt !== "string") return null;
  if (timeLimitSec !== null) {
    if (
      typeof timeLimitSec !== "number" ||
      !Number.isInteger(timeLimitSec) ||
      timeLimitSec < TEST_MIN_LIMIT_SEC ||
      timeLimitSec > TEST_MAX_LIMIT_SEC
    ) {
      return null;
    }
  }

  if (submittedAt === null) {
    if (submitReason !== null || candidate.view !== "active" || candidate.completionEmitted) return null;
  } else {
    const submittedMs = parseTimestamp(submittedAt);
    if (submittedMs === null || submittedMs < startedMs) return null;
    if (submitReason !== "manual" && submitReason !== "timeout") return null;
  }

  return {
    flagged: itemIds.filter((id) => flagged.includes(id)),
    startedAt,
    timeLimitSec: timeLimitSec ?? null,
    submittedAt: submittedAt ?? null,
    submitReason: submitReason ?? null,
  };
}

export function toCompletionSnapshot(run: QuizRunState): QuizCompletionSnapshot | null {
  const summary = summarizeQuizRun(run);
  // Nothing scored (every question skipped for an unavailable picture) leaves nothing to save (#403).
  if (!summary.isComplete || !run.completedAt || summary.scoredTotal === 0) return null;
  const scope = { ...run.scope };
  if (scope.kind !== "collection") {
    scope.navigationKeywords = [...scope.navigationKeywords];
    scope.filterKeywords = [...scope.filterKeywords];
    Object.freeze(scope.navigationKeywords);
    Object.freeze(scope.filterKeywords);
  }
  Object.freeze(scope);
  return Object.freeze({
    runId: run.runId,
    scope,
    completedAt: run.completedAt,
    correct: summary.correct,
    total: summary.scoredTotal,
    missedItemIds: Object.freeze([...summary.missedItemIds]),
  });
}

export function publishQuizCompletion(snapshot: QuizCompletionSnapshot): void {
  window.dispatchEvent(new CustomEvent<QuizCompletionSnapshot>(QUIZ_COMPLETED_EVENT, { detail: snapshot }));
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Single playability filter (#250): trim, drop blanks, drop case-insensitive duplicates and drop values equal to the
 * correct answer. Mirrored server-side by QuizPlayability.GetDistractors (Daily selection, review queue).
 */
export function getQuizDistractors(item: Pick<ItemResponse, "correctAnswer" | "incorrectAnswers">): string[] {
  const correct = (item.correctAnswer ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of item.incorrectAnswers ?? []) {
    const value = (raw ?? "").trim();
    const key = value.toLowerCase();
    if (!value || key === correct || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** An item can be quizzed when at least one usable distractor remains. */
export function isQuizPlayable(item: Pick<ItemResponse, "correctAnswer" | "incorrectAnswers">): boolean {
  return getQuizDistractors(item).length > 0;
}

export function getQuizOptions(item: ItemResponse, runId: string): string[] {
  const options = [item.correctAnswer, ...getQuizDistractors(item).slice(0, 3)];
  let seed = hashSeed(`${runId}:${item.id}`);
  for (let index = options.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [options[index], options[target]] = [options[target], options[index]];
  }
  return options;
}

interface SeedQuizRosterOptions {
  /** Category slug from the URL (not the resolved name); undefined for a global quiz. */
  categorySlug?: string;
  navigationKeywords: readonly string[];
  filterKeywords: readonly string[];
  quizSize: number;
}

/**
 * AC 3.6.17 (#278): a cold deep link starts the run on the entry item when that item is
 * quiz-playable, public and in the quiz's scope; the random items follow without duplicates.
 * Otherwise the random roster is returned unchanged (the #275 rewrite then applies).
 */
export function seedQuizRoster<T extends ItemResponse>(
  randomItems: readonly T[],
  linked: T | null | undefined,
  options: SeedQuizRosterOptions
): T[] {
  const random = [...randomItems];
  if (!linked || !linked.id || linked.isPrivate || !isQuizPlayable(linked)) return random;
  if (options.filterKeywords.length > 0) return random;
  if (options.categorySlug) {
    if (options.navigationKeywords.length > 0) return random;
    if (!linked.category) return random;
    if (
      categoryNameToSlug(linked.category).toLowerCase() !==
      options.categorySlug.toLowerCase()
    ) {
      return random;
    }
  }
  return [linked, ...random.filter((item) => item.id !== linked.id)].slice(
    0,
    options.quizSize
  );
}
