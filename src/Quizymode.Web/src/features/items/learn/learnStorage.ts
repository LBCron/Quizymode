import type { ItemResponse } from "@/types/api";
import { isItemImageReference } from "@/media/curatedImages";
import { isQuizPlayable, type QuizRunScope } from "@/features/items/quiz/quizRun";
import { LEARN_MAX_ITEMS, restoreLearnRun, type LearnRunState } from "./learnRun";

/**
 * Browser-local Learn progress (AC 3.17.7, 3.17.8). One localStorage document holds at most 3 runs (LRU), each for
 * 7 days, within 256 KB. Only guest category/global runs keep an item snapshot (their random roster cannot be
 * refetched and guests only see public items); signed-in runs keep ids and progress and refetch items on restore.
 */
export const LEARN_STORAGE_KEY = "quizymode.learn.v1";
export const LEARN_STORAGE_VERSION = 1;
export const LEARN_MAX_RUNS = 3;
export const LEARN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LEARN_MAX_DOCUMENT_BYTES = 256 * 1024;
export const GUEST_IDENTITY_KEY = "guest";

export interface StoredLearnRun {
  scopeKey: string;
  identityKey: string;
  /** Epoch milliseconds of the last write; drives LRU order and the TTL. */
  savedAt: number;
  state: LearnRunState;
  /** Guest category/global runs only. */
  items?: ItemResponse[];
}

export type LearnRestoreResult =
  | { status: "none" }
  /** A stored run exists for this scope and identity but cannot be trusted. */
  | { status: "invalid" }
  | { status: "restored"; state: LearnRunState; items: ItemResponse[] | null };

/** Stable key for a normalized scope: two scopes with the same key are the same Learn set. */
export function learnScopeKey(scope: QuizRunScope): string {
  if (scope.kind === "collection") return `collection:${scope.collectionId.toLowerCase()}`;
  return [
    scope.kind,
    (scope.category ?? "").toLowerCase(),
    `nav=${scope.navigationKeywords.map((keyword) => keyword.toLowerCase()).join(",")}`,
    `filter=${scope.filterKeywords.map((keyword) => keyword.toLowerCase()).join(",")}`,
    `size=${scope.quizSize}`,
  ].join("|");
}

/** True when the stored run may keep question and answer text (AC 3.17.8). */
export function keepsItemSnapshot(scope: QuizRunScope, identityKey: string): boolean {
  return scope.kind !== "collection" && identityKey === GUEST_IDENTITY_KEY;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStoredItem(value: unknown): value is ItemResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ItemResponse>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.question === "string" &&
    typeof item.correctAnswer === "string" &&
    isStringArray(item.incorrectAnswers) &&
    // A picture question without its picture is unanswerable, so a malformed image invalidates the snapshot (#407).
    (item.questionImage === undefined || item.questionImage === null || isItemImageReference(item.questionImage)) &&
    item.isPrivate !== true
  );
}

/**
 * A malformed explanation picture is dropped rather than discarding the whole snapshot (#403): the question is still
 * answerable without it, unlike a malformed question picture.
 */
function withoutMalformedExplanationImage(item: ItemResponse): ItemResponse {
  if (item.explanationImage === undefined || item.explanationImage === null || isItemImageReference(item.explanationImage)) {
    return item;
  }
  const { explanationImage: _dropped, ...rest } = item;
  void _dropped;
  return rest;
}

/** Keeps only what the Learn page renders; never stores private items. */
export function toItemSnapshot(item: ItemResponse): ItemResponse {
  return {
    id: item.id,
    category: item.category,
    isPrivate: false,
    question: item.question,
    questionSpeech: item.questionSpeech,
    correctAnswer: item.correctAnswer,
    correctAnswerSpeech: item.correctAnswerSpeech,
    incorrectAnswers: [...item.incorrectAnswers],
    incorrectAnswerSpeech: item.incorrectAnswerSpeech,
    ...(item.incorrectAnswerRationale ? { incorrectAnswerRationale: item.incorrectAnswerRationale } : {}),
    ...(item.questionImage ? { questionImage: item.questionImage } : {}),
    ...(item.explanationImage ? { explanationImage: item.explanationImage } : {}),
    explanation: item.explanation ?? "",
    createdAt: item.createdAt,
    keywords: [],
    collections: [],
  };
}

interface ParsedDocument {
  runs: StoredLearnRun[];
  /** False when the document existed but could not be read. */
  wellFormed: boolean;
}

function parseDocument(raw: string | null): ParsedDocument {
  if (raw === null || raw.length === 0) return { runs: [], wellFormed: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { runs: [], wellFormed: false };
    const document = parsed as { version?: unknown; runs?: unknown };
    if (document.version !== LEARN_STORAGE_VERSION || !Array.isArray(document.runs)) {
      return { runs: [], wellFormed: false };
    }
    const runs: StoredLearnRun[] = [];
    let wellFormed = true;
    for (const entry of document.runs as unknown[]) {
      const candidate = entry as Partial<StoredLearnRun> | null;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof candidate.scopeKey !== "string" ||
        typeof candidate.identityKey !== "string" ||
        typeof candidate.savedAt !== "number" ||
        !Number.isFinite(candidate.savedAt)
      ) {
        wellFormed = false;
        continue;
      }
      // State is validated by restoreLearnRun when a run is read; here it is carried through opaquely.
      runs.push(candidate as StoredLearnRun);
    }
    return { runs, wellFormed };
  } catch {
    return { runs: [], wellFormed: false };
  }
}

function readDocument(storage: Storage): ParsedDocument {
  try {
    return parseDocument(storage.getItem(LEARN_STORAGE_KEY));
  } catch {
    return { runs: [], wellFormed: false };
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function sortNewestFirst(runs: StoredLearnRun[]): StoredLearnRun[] {
  return [...runs].sort((left, right) => right.savedAt - left.savedAt);
}

function isFresh(run: StoredLearnRun, now: number): boolean {
  return now - run.savedAt <= LEARN_TTL_MS && run.savedAt <= now + 5 * 60 * 1000;
}

/**
 * Finds the stored run for this scope and identity. Expired and other-identity runs are ignored silently;
 * a run that fails validation (or an unreadable document) is "invalid" so the page can explain the restart.
 */
export function readLearnRun(scope: QuizRunScope, identityKey: string, now: number = Date.now()): LearnRestoreResult {
  const storage = getStorage();
  if (!storage) return { status: "none" };
  const document = readDocument(storage);
  if (!document.wellFormed) return { status: "invalid" };

  const scopeKey = learnScopeKey(scope);
  const entry = document.runs.find((run) => run.scopeKey === scopeKey && run.identityKey === identityKey);
  if (!entry || !isFresh(entry, now)) return { status: "none" };

  const state = restoreLearnRun(entry.state, scope, identityKey);
  if (!state) return { status: "invalid" };

  if (!keepsItemSnapshot(scope, identityKey)) {
    return { status: "restored", state, items: null };
  }

  const items = Array.isArray(entry.items)
    ? entry.items.map((item) => (item && typeof item === "object" ? withoutMalformedExplanationImage(item) : item))
    : null;
  if (
    !items ||
    items.length !== state.itemIds.length ||
    !items.every(isStoredItem) ||
    !items.every(isQuizPlayable) ||
    !state.itemIds.every((id) => items.some((item) => item.id === id)) ||
    items.length > LEARN_MAX_ITEMS
  ) {
    return { status: "invalid" };
  }
  return { status: "restored", state, items };
}

/**
 * Upserts the run (most recently used first), keeps at most 3 runs within the size cap, evicting the oldest run
 * before a write is allowed to fail. Returns false when nothing could be written.
 */
export function writeLearnRun(
  scope: QuizRunScope,
  state: LearnRunState,
  items: ItemResponse[] | null,
  now: number = Date.now(),
): boolean {
  const storage = getStorage();
  if (!storage) return false;

  const scopeKey = learnScopeKey(scope);
  const entry: StoredLearnRun = {
    scopeKey,
    identityKey: state.identityKey,
    savedAt: now,
    state,
    ...(items && keepsItemSnapshot(scope, state.identityKey) ? { items: items.map(toItemSnapshot) } : {}),
  };
  const others = sortNewestFirst(
    readDocument(storage).runs.filter(
      (run) => isFresh(run, now) && !(run.scopeKey === scopeKey && run.identityKey === state.identityKey),
    ),
  );
  const kept = others.slice(0, LEARN_MAX_RUNS - 1);

  while (true) {
    const serialized = JSON.stringify({ version: LEARN_STORAGE_VERSION, runs: [entry, ...kept] });
    if (utf8Length(serialized) <= LEARN_MAX_DOCUMENT_BYTES) {
      try {
        storage.setItem(LEARN_STORAGE_KEY, serialized);
        return true;
      } catch {
        // Quota or access failure: evict below and retry.
      }
    }
    if (kept.length === 0) return false;
    kept.pop();
  }
}

export function removeLearnRun(scope: QuizRunScope, identityKey: string): void {
  const storage = getStorage();
  if (!storage) return;
  const scopeKey = learnScopeKey(scope);
  const document = readDocument(storage);
  const remaining = document.runs.filter((run) => !(run.scopeKey === scopeKey && run.identityKey === identityKey));
  writeRuns(storage, remaining);
}

function writeRuns(storage: Storage, runs: StoredLearnRun[]): void {
  try {
    if (runs.length === 0) {
      storage.removeItem(LEARN_STORAGE_KEY);
    } else {
      storage.setItem(LEARN_STORAGE_KEY, JSON.stringify({ version: LEARN_STORAGE_VERSION, runs }));
    }
  } catch {
    // Purging is best effort; in-memory state is already discarded.
  }
}

/**
 * Drops every stored run that does not belong to `keepIdentityKey` (AC 3.17.8). Called on sign-out, before the
 * Cognito/Google redirect, and when auth settles on app load. A corrupt document is removed outright.
 */
export function purgeLearnRunsExcept(keepIdentityKey: string): void {
  const storage = getStorage();
  if (!storage) return;
  const document = readDocument(storage);
  if (!document.wellFormed) {
    writeRuns(storage, []);
    return;
  }
  const remaining = document.runs.filter((run) => run.identityKey === keepIdentityKey);
  if (remaining.length !== document.runs.length) writeRuns(storage, remaining);
}
