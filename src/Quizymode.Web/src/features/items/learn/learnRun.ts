import type { ItemResponse } from "@/types/api";
import {
  getQuizOptions,
  sameQuizScope,
  type QuizCompletionSnapshot,
  type QuizRunScope,
} from "@/features/items/quiz/quizRun";

export const LEARN_RUN_SCHEMA_VERSION = 1;
/** Scope cap (AC 3.17.1). */
export const LEARN_MAX_ITEMS = 50;
/** Most items in one round (AC 3.17.2). */
export const LEARN_ROUND_SIZE = 7;
/** Consecutive correct answers needed after a miss (AC 3.17.3). */
export const LEARN_STREAK_TO_MASTER = 2;

export type LearnView = "active" | "recap" | "finished";

/** String union so a typed-answer format can be added later with a schema bump. */
export type LearnAnswerFormat = "multiple-choice";

export interface LearnAttempt {
  round: number;
  /** Index into the seeded option order of that attempt; never the answer text (AC 3.17.8). */
  selectedIndex: number;
  isCorrect: boolean;
  answerFormat: LearnAnswerFormat;
}

export interface LearnItemProgress {
  attempts: LearnAttempt[];
  streak: number;
  mastered: boolean;
}

export interface LearnRound {
  number: number;
  itemIds: string[];
  position: number;
}

export interface LearnRunState {
  schemaVersion: typeof LEARN_RUN_SCHEMA_VERSION;
  runId: string;
  identityKey: string;
  scope: QuizRunScope;
  /** Roster in shuffled order, at most LEARN_MAX_ITEMS. */
  itemIds: string[];
  /**
   * Items skipped because their picture was unavailable (#403). Later rounds leave them out and completion counts
   * only the other items. A missing field in a stored run reads as empty (no schema bump).
   */
  skipped: string[];
  skippedReasons?: Record<string, "picture-unavailable" | "picture-inaccessible">;
  round: LearnRound;
  progress: Record<string, LearnItemProgress>;
  view: LearnView;
  completedAt: string | null;
  completionEmitted: boolean;
}

export type LearnRunAction =
  | { type: "answer"; itemId: string; selectedIndex: number; isCorrect: boolean; completedAt: string }
  | { type: "advance" }
  /** Leave the current, unanswered item because its picture is unavailable: no attempt and no miss are recorded. */
  | { type: "skip-unavailable"; itemId: string; completedAt: string; reason?: "picture-unavailable" | "picture-inaccessible" }
  | { type: "next-round" }
  | { type: "mark-completion-emitted" };

export interface LearnRunSummary {
  /** Roster size minus skipped items. */
  total: number;
  /** Items skipped because their picture was unavailable (#403). */
  skipped: number;
  mastered: number;
  /** Items whose first attempt was correct. */
  firstTryCorrect: number;
  /** Items whose first attempt was wrong, in roster order. */
  missedItemIds: string[];
  /** Share of items right first time, 0-100. */
  firstTryPercentage: number;
  isComplete: boolean;
}

function newRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic Fisher-Yates shuffle; the same seed always gives the same order. */
export function seededShuffle<T>(values: readonly T[], seedText: string): T[] {
  const result = [...values];
  let seed = hashSeed(seedText);
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/** Replays attempts into streak and mastery: a correct first attempt masters, otherwise 2 correct in a row. */
export function deriveLearnProgress(attempts: readonly LearnAttempt[]): { streak: number; mastered: boolean } {
  let streak = 0;
  let mastered = false;
  attempts.forEach((attempt, index) => {
    if (mastered) return;
    if (!attempt.isCorrect) {
      streak = 0;
      return;
    }
    streak += 1;
    if (index === 0 || streak >= LEARN_STREAK_TO_MASTER) mastered = true;
  });
  return { streak, mastered };
}

function progressOf(run: LearnRunState, itemId: string): LearnItemProgress {
  return run.progress[itemId] ?? { attempts: [], streak: 0, mastered: false };
}

export function isLearnItemMastered(run: LearnRunState, itemId: string): boolean {
  return progressOf(run, itemId).mastered;
}

export function getLearnAttemptInRound(run: LearnRunState, itemId: string, roundNumber = run.round.number): LearnAttempt | undefined {
  return progressOf(run, itemId).attempts.find((attempt) => attempt.round === roundNumber);
}

export function getCurrentLearnItemId(run: LearnRunState): string | undefined {
  return run.round.itemIds[run.round.position];
}

/** Roster items that are still in play: everything except items skipped for an unavailable picture. */
export function activeLearnItemIds(run: LearnRunState): string[] {
  return run.itemIds.filter((itemId) => !run.skipped.includes(itemId));
}

export function countMastered(run: LearnRunState): number {
  return activeLearnItemIds(run).filter((itemId) => progressOf(run, itemId).mastered).length;
}

/** True when the item was answered in this round or skipped (it is done as far as the round position goes). */
export function isLearnItemHandled(run: LearnRunState, itemId: string): boolean {
  return getLearnAttemptInRound(run, itemId) !== undefined || run.skipped.includes(itemId);
}

export function summarizeLearnRun(run: LearnRunState): LearnRunSummary {
  const roster = activeLearnItemIds(run);
  const total = roster.length;
  const mastered = countMastered(run);
  const firstAttempts = roster
    .map((itemId) => ({ itemId, first: progressOf(run, itemId).attempts[0] }))
    .filter((entry): entry is { itemId: string; first: LearnAttempt } => Boolean(entry.first));
  const firstTryCorrect = firstAttempts.filter((entry) => entry.first.isCorrect).length;

  return {
    total,
    skipped: run.skipped.length,
    mastered,
    firstTryCorrect,
    missedItemIds: firstAttempts.filter((entry) => !entry.first.isCorrect).map((entry) => entry.itemId),
    firstTryPercentage: total === 0 ? 0 : Math.round((firstTryCorrect / total) * 100),
    // Every item skipped is complete with nothing to master (the caller saves no session for it).
    isComplete: total > 0 ? mastered === total : run.skipped.length > 0,
  };
}

/**
 * Option seed for the next (or just answered) attempt at this item. The seed is the run id plus the attempt
 * number, so options are stable on reload and re-seeded on each re-ask (AC 3.17.5). Quiz keeps passing the bare
 * run id, so its order is unchanged.
 */
export function getLearnOptions(run: LearnRunState, item: ItemResponse): string[] {
  const attempts = progressOf(run, item.id).attempts;
  const answeredThisRound = getLearnAttemptInRound(run, item.id) !== undefined;
  const attemptNumber = answeredThisRound ? attempts.length : attempts.length + 1;
  return getQuizOptions(item, `${run.runId}:${attemptNumber}`);
}

/**
 * Picks the next round (AC 3.17.2): attempted-but-unmastered items first (oldest attempt first), then unseen
 * items in roster order, at most 7, in a seeded order that never starts with the previous round's last item.
 */
function composeRound(run: LearnRunState, number: number, previousLastItemId: string | null): string[] {
  const unmastered = activeLearnItemIds(run).filter((itemId) => !progressOf(run, itemId).mastered);
  const attempted = unmastered
    .filter((itemId) => progressOf(run, itemId).attempts.length > 0)
    .map((itemId, rosterIndex) => {
      const attempts = progressOf(run, itemId).attempts;
      return { itemId, lastRound: attempts[attempts.length - 1].round, rosterIndex };
    })
    .sort((left, right) => left.lastRound - right.lastRound || left.rosterIndex - right.rosterIndex)
    .map((entry) => entry.itemId);
  const unseen = unmastered.filter((itemId) => progressOf(run, itemId).attempts.length === 0);
  const picked = [...attempted, ...unseen].slice(0, LEARN_ROUND_SIZE);
  const ordered = seededShuffle(picked, `${run.runId}:round:${number}`);
  if (ordered.length >= 2 && previousLastItemId !== null && ordered[0] === previousLastItemId) {
    [ordered[0], ordered[1]] = [ordered[1], ordered[0]];
  }
  return ordered;
}

/**
 * Starts a run over the playable items of a scope: de-duplicated, shuffled by the new run id and capped at 50.
 * Callers pass the whole playable pool so "Learn again" reshuffles it.
 */
export function createLearnRun(scope: QuizRunScope, playableItemIds: readonly string[], identityKey: string): LearnRunState {
  const runId = newRunId();
  const pool = Array.from(new Set(playableItemIds.filter(Boolean)));
  const itemIds = seededShuffle(pool, `${runId}:roster`).slice(0, LEARN_MAX_ITEMS);
  const base: LearnRunState = {
    schemaVersion: LEARN_RUN_SCHEMA_VERSION,
    runId,
    identityKey,
    scope,
    itemIds,
    skipped: [],
    round: { number: 1, itemIds: [], position: 0 },
    progress: {},
    view: "active",
    completedAt: null,
    completionEmitted: false,
  };

  return { ...base, round: { number: 1, itemIds: composeRound(base, 1, null), position: 0 } };
}

export function reduceLearnRun(run: LearnRunState, action: LearnRunAction): LearnRunState {
  if (action.type === "answer") {
    if (run.view !== "active" || action.itemId !== getCurrentLearnItemId(run)) return run;
    if (getLearnAttemptInRound(run, action.itemId)) return run;

    const attempts: LearnAttempt[] = [
      ...progressOf(run, action.itemId).attempts,
      {
        round: run.round.number,
        selectedIndex: action.selectedIndex,
        isCorrect: action.isCorrect,
        answerFormat: "multiple-choice",
      },
    ];
    const progress = { ...run.progress, [action.itemId]: { attempts, ...deriveLearnProgress(attempts) } };
    const updated: LearnRunState = { ...run, progress };
    const isComplete = summarizeLearnRun(updated).isComplete;

    return { ...updated, completedAt: isComplete ? action.completedAt : null };
  }

  if (action.type === "skip-unavailable") {
    if (run.view !== "active" || action.itemId !== getCurrentLearnItemId(run)) return run;
    if (getLearnAttemptInRound(run, action.itemId) || run.skipped.includes(action.itemId)) return run;
    const skipped = run.itemIds.filter((itemId) => itemId === action.itemId || run.skipped.includes(itemId));
    const updated: LearnRunState = { ...run, skipped, skippedReasons: { ...run.skippedReasons, [action.itemId]: action.reason ?? "picture-unavailable" } };
    const completedAt = summarizeLearnRun(updated).isComplete ? action.completedAt : null;
    const completed: LearnRunState = { ...updated, completedAt };
    if (completedAt) return { ...completed, view: "finished" };
    const nextPosition = run.round.position + 1;
    return nextPosition < run.round.itemIds.length
      ? { ...completed, round: { ...run.round, position: nextPosition } }
      : { ...completed, view: "recap" };
  }

  if (action.type === "advance") {
    const currentId = getCurrentLearnItemId(run);
    if (run.view !== "active" || !currentId || !getLearnAttemptInRound(run, currentId)) return run;
    if (run.completedAt) return { ...run, view: "finished" };

    const nextPosition = run.round.position + 1;
    return nextPosition < run.round.itemIds.length
      ? { ...run, round: { ...run.round, position: nextPosition } }
      : { ...run, view: "recap" };
  }

  if (action.type === "next-round") {
    if (run.view !== "recap" || run.completedAt) return run;
    const number = run.round.number + 1;
    const lastItemId = run.round.itemIds[run.round.itemIds.length - 1] ?? null;
    return { ...run, view: "active", round: { number, itemIds: composeRound(run, number, lastItemId), position: 0 } };
  }

  return run.completedAt && !run.completionEmitted ? { ...run, completionEmitted: true } : run;
}

/** Study-session snapshot: first-try correct out of the roster, first-try misses as missedItemIds (AC 3.17.9). */
export function toLearnCompletionSnapshot(run: LearnRunState): QuizCompletionSnapshot | null {
  const summary = summarizeLearnRun(run);
  // Nothing scored (every question skipped for an unavailable picture) leaves nothing to save (#403).
  if (!summary.isComplete || !run.completedAt || summary.total === 0) return null;
  const scope = { ...run.scope };
  if (scope.kind !== "collection") {
    scope.navigationKeywords = Object.freeze([...scope.navigationKeywords]) as string[];
    scope.filterKeywords = Object.freeze([...scope.filterKeywords]) as string[];
  }
  Object.freeze(scope);
  return Object.freeze({
    runId: run.runId,
    scope,
    completedAt: run.completedAt,
    correct: summary.firstTryCorrect,
    total: summary.total,
    missedItemIds: Object.freeze([...summary.missedItemIds]),
    mode: "learn",
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readAttempts(value: unknown): LearnAttempt[] | null {
  if (!Array.isArray(value)) return null;
  const attempts: LearnAttempt[] = [];
  let previousRound = 0;
  for (const raw of value) {
    if (!isPlainRecord(raw)) return null;
    const { round, selectedIndex, isCorrect, answerFormat } = raw;
    if (
      typeof round !== "number" ||
      !Number.isInteger(round) ||
      round <= previousRound ||
      typeof selectedIndex !== "number" ||
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex > 3 ||
      typeof isCorrect !== "boolean" ||
      answerFormat !== "multiple-choice"
    ) {
      return null;
    }
    previousRound = round;
    attempts.push({ round, selectedIndex, isCorrect, answerFormat });
  }
  return attempts;
}

/**
 * Validated restore (AC 3.17.7). Returns null for any state that the reducer could not have produced: wrong
 * schema, identity or scope, progress keys outside the roster, malformed attempts, inconsistent streak or mastery,
 * a finished view before every item is mastered, or a completion marker without a completion time.
 */
export function restoreLearnRun(value: unknown, expectedScope: QuizRunScope, identityKey: string): LearnRunState | null {
  if (!isPlainRecord(value)) return null;
  const candidate = value;
  if (
    candidate.schemaVersion !== LEARN_RUN_SCHEMA_VERSION ||
    typeof candidate.runId !== "string" ||
    candidate.runId.length === 0 ||
    candidate.runId.length > 128 ||
    candidate.identityKey !== identityKey ||
    !sameQuizScope(candidate.scope, expectedScope) ||
    !Array.isArray(candidate.itemIds) ||
    candidate.itemIds.length === 0 ||
    candidate.itemIds.length > LEARN_MAX_ITEMS ||
    !candidate.itemIds.every((id): id is string => typeof id === "string" && id.length > 0) ||
    new Set(candidate.itemIds).size !== candidate.itemIds.length ||
    !["active", "recap", "finished"].includes(String(candidate.view)) ||
    typeof candidate.completionEmitted !== "boolean" ||
    !isPlainRecord(candidate.progress) ||
    !isPlainRecord(candidate.round)
  ) {
    return null;
  }

  const itemIds = candidate.itemIds as string[];
  const rosterIds = new Set(itemIds);
  // `skipped` is optional in stored runs (#403): a missing field reads as empty.
  const rawSkipped: unknown = candidate.skipped ?? [];
  if (
    !Array.isArray(rawSkipped) ||
    rawSkipped.some((id) => typeof id !== "string" || !rosterIds.has(id)) ||
    new Set(rawSkipped).size !== rawSkipped.length
  ) {
    return null;
  }
  const skipped = itemIds.filter((id) => rawSkipped.includes(id));
  const roundRaw = candidate.round;
  const roundIds = roundRaw.itemIds;
  if (
    typeof roundRaw.number !== "number" ||
    !Number.isInteger(roundRaw.number) ||
    roundRaw.number < 1 ||
    !Array.isArray(roundIds) ||
    roundIds.length === 0 ||
    roundIds.length > LEARN_ROUND_SIZE ||
    !roundIds.every((id): id is string => typeof id === "string" && rosterIds.has(id)) ||
    new Set(roundIds).size !== roundIds.length ||
    typeof roundRaw.position !== "number" ||
    !Number.isInteger(roundRaw.position) ||
    roundRaw.position < 0 ||
    roundRaw.position >= roundIds.length
  ) {
    return null;
  }
  const round: LearnRound = { number: roundRaw.number, itemIds: roundIds as string[], position: roundRaw.position };

  if (Object.keys(candidate.progress).some((id) => !rosterIds.has(id))) return null;
  const progress: Record<string, LearnItemProgress> = {};
  for (const itemId of itemIds) {
    const raw = candidate.progress[itemId];
    if (raw === undefined) continue;
    if (!isPlainRecord(raw)) return null;
    const attempts = readAttempts(raw.attempts);
    if (!attempts || attempts.length === 0 || attempts[attempts.length - 1].round > round.number) return null;
    const derived = deriveLearnProgress(attempts);
    // Nothing is recorded after an item is mastered, so a mastered item's last attempt is the mastering one.
    if (raw.streak !== derived.streak || raw.mastered !== derived.mastered) return null;
    if (attempts.length > 1 && deriveLearnProgress(attempts.slice(0, -1)).mastered) return null;
    progress[itemId] = { attempts, ...derived };
  }

  const completedAt = candidate.completedAt;
  if (completedAt !== null && (typeof completedAt !== "string" || Number.isNaN(Date.parse(completedAt)))) return null;

  const reasons = candidate.skippedReasons;
  if (reasons !== undefined && (!reasons || typeof reasons !== "object" || Object.entries(reasons).some(([id, reason]) => !skipped.includes(id) || !["picture-unavailable", "picture-inaccessible"].includes(String(reason))))) return null;
  const restored: LearnRunState = {
    schemaVersion: LEARN_RUN_SCHEMA_VERSION,
    runId: candidate.runId,
    identityKey,
    scope: expectedScope,
    itemIds: [...itemIds],
    skipped,
    skippedReasons: reasons as LearnRunState["skippedReasons"],
    round,
    progress,
    view: candidate.view as LearnView,
    completedAt: completedAt ?? null,
    completionEmitted: candidate.completionEmitted,
  };

  const isComplete = summarizeLearnRun(restored).isComplete;
  if (isComplete !== Boolean(restored.completedAt)) return null;
  if (restored.view === "finished" && !isComplete) return null;
  if (restored.completionEmitted && !restored.completedAt) return null;

  // Attempts tagged with the current round must belong to items in it, and every attempted-but-unmastered item
  // must be in it (the reducer puts them all in every round).
  const roundSet = new Set(round.itemIds);
  for (const itemId of itemIds) {
    const entry = progress[itemId];
    if (!entry) continue;
    const taggedCurrent = entry.attempts.some((attempt) => attempt.round === round.number);
    if (taggedCurrent && !roundSet.has(itemId)) return null;
    if (!entry.mastered && !skipped.includes(itemId) && !roundSet.has(itemId)) return null;
  }

  // The current round must agree with what has been answered in it.
  const answeredInRound = round.itemIds.map((id) => isLearnItemHandled(restored, id));
  if (restored.view === "recap" && (isComplete || !answeredInRound.every(Boolean))) return null;
  if (restored.view === "active") {
    if (!answeredInRound.slice(0, round.position).every(Boolean)) return null;
    if (answeredInRound.slice(round.position + 1).some(Boolean)) return null;
  }

  return restored;
}
