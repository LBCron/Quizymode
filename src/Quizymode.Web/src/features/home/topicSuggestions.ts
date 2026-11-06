import { topicsOverlap } from "@/features/interests/topicPaths";
import type { ActivityRun } from "./personalization";

/** Activity suggestions (#385): at least 2 completed runs in 30 days, rolled up to L1, top 3. Inference never saves anything. */
export const SUGGESTION_MIN_RUNS = 2;
export const SUGGESTION_WINDOW_DAYS = 30;
export const SUGGESTION_LIMIT = 3;
export const SUPPRESSIONS_STORAGE_KEY = "quizymode.topicSuppressions.v1";

export interface TopicSuggestion {
  /** category or category/l1 path. */
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
  return [...byPath.values()]
    .filter((s) => s.runs >= SUGGESTION_MIN_RUNS)
    .filter((s) => !explicit.some((topic) => topicsOverlap(topic, s.path)))
    .filter((s) => !suppressed.includes(s.path))
    .sort((a, b) => b.runs - a.runs || Date.parse(b.lastCompletedAt) - Date.parse(a.lastCompletedAt) || a.path.localeCompare(b.path))
    .slice(0, SUGGESTION_LIMIT);
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
