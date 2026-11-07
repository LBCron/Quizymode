import { topicsOverlap } from "@/features/interests/topicPaths";
import type { ActivityRun } from "./personalization";

/** Activity suggestions (#385): at least 2 completed runs in 30 days, rolled up to L1, top 3. Inference never saves anything. */
export const SUGGESTION_MIN_RUNS = 2;
export const SUGGESTION_WINDOW_DAYS = 30;
export const SUGGESTION_LIMIT = 3;
export const SUPPRESSIONS_STORAGE_KEY = "quizymode.topicSuppressions.v1";
export const SUGGESTION_CARD_STORAGE_KEY = "quizymode.topicSuggestionCard.v1";
const SHOWN_LIMIT = 100;

export interface TopicSuggestion {
  /** category or category/l1 path. */
  path: string;
  runs: number;
  lastCompletedAt: string;
}

/** One row of GET /users/me/topic-activity (already rolled up to L1 and filtered to 2+ runs by the server). */
export interface TopicActivityRow {
  path: string;
  runs: number;
  lastCompletedAt: string;
}

/** Roll a category run up to its L1 path; other sources (collections, global, daily, review) are not attributable. */
function rollUp(run: ActivityRun): string | null {
  if (run.source?.kind !== "category") return null;
  const { categorySlug, navigationKeywords } = run.source;
  return navigationKeywords.length > 0 ? `${categorySlug}/${navigationKeywords[0]}` : categorySlug;
}

/** Shared ordering and exclusions: chosen or overlapping topics and suppressed paths never suggest. */
function rankSuggestions(candidates: TopicSuggestion[], explicit: string[], suppressed: string[]): TopicSuggestion[] {
  return candidates
    .filter((s) => s.runs >= SUGGESTION_MIN_RUNS)
    .filter((s) => !explicit.some((topic) => topicsOverlap(topic, s.path)))
    .filter((s) => !suppressed.includes(s.path))
    .sort((a, b) => b.runs - a.runs || Date.parse(b.lastCompletedAt) - Date.parse(a.lastCompletedAt) || a.path.localeCompare(b.path))
    .slice(0, SUGGESTION_LIMIT);
}

/** Guest path: rolls this browser's run summaries up locally. */
export function suggestTopics(
  runs: ActivityRun[],
  explicit: string[],
  suppressed: string[],
  now: Date = new Date(),
): TopicSuggestion[] {
  const cutoff = now.getTime() - SUGGESTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const byPath = new Map<string, TopicSuggestion>();
  for (const run of runs) {
    const at = Date.parse(run.completedAt);
    if (Number.isNaN(at) || at < cutoff || at > now.getTime()) continue;
    const path = rollUp(run);
    if (!path) continue;
    const current = byPath.get(path);
    if (!current) byPath.set(path, { path, runs: 1, lastCompletedAt: run.completedAt });
    else {
      current.runs += 1;
      if (at > Date.parse(current.lastCompletedAt)) current.lastCompletedAt = run.completedAt;
    }
  }
  return rankSuggestions([...byPath.values()], explicit, suppressed);
}

/** Signed-in path: the server aggregate (GET /users/me/topic-activity) with the same exclusions applied on the client. */
export function suggestFromActivity(rows: TopicActivityRow[], explicit: string[], suppressed: string[]): TopicSuggestion[] {
  return rankSuggestions(rows, explicit, suppressed);
}

export function readSuppressions(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SUPPRESSIONS_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function addSuppression(path: string): void {
  try {
    const next = Array.from(new Set([...readSuppressions(), path])).slice(-100);
    localStorage.setItem(SUPPRESSIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the card is hidden for this page view only.
  }
}

/**
 * What this device has shown as a suggestion card (AC 3.15.6). `newCardDate` is the UTC day a card was first shown
 * as a new suggestion; at most one new card is shown per day. Shown paths may stay on screen all day.
 */
export interface SuggestionCardState {
  newCardDate: string | null;
  shown: string[];
}

export const EMPTY_SUGGESTION_CARD_STATE: SuggestionCardState = { newCardDate: null, shown: [] };

export interface SuggestionCardChoice {
  card: TopicSuggestion | undefined;
  /** Same object as the input state when nothing changed, so callers can compare by reference. */
  next: SuggestionCardState;
}

/**
 * Pick the one card to show. A candidate already shown on this device keeps its card (earlier candidates win). Otherwise
 * the top candidate becomes a new card, unless a new card was already shown today, in which case nothing new appears.
 */
export function chooseSuggestionCard(
  candidates: TopicSuggestion[],
  state: SuggestionCardState,
  today: string,
): SuggestionCardChoice {
  const previouslyShown = candidates.find((candidate) => state.shown.includes(candidate.path));
  if (previouslyShown) return { card: previouslyShown, next: state };
  const first = candidates[0];
  if (!first || state.newCardDate === today) return { card: undefined, next: state };
  return {
    card: first,
    next: { newCardDate: today, shown: [...state.shown, first.path].slice(-SHOWN_LIMIT) },
  };
}

export function readSuggestionCardState(): SuggestionCardState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SUGGESTION_CARD_STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return EMPTY_SUGGESTION_CARD_STATE;
    const record = parsed as { newCardDate?: unknown; shown?: unknown };
    const shown = Array.isArray(record.shown) ? record.shown.filter((v): v is string => typeof v === "string") : [];
    const newCardDate = typeof record.newCardDate === "string" ? record.newCardDate : null;
    return { newCardDate, shown };
  } catch {
    return EMPTY_SUGGESTION_CARD_STATE;
  }
}

export function writeSuggestionCardState(state: SuggestionCardState): void {
  try {
    localStorage.setItem(SUGGESTION_CARD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the cap is not remembered, so the card may reappear on reload.
  }
}
