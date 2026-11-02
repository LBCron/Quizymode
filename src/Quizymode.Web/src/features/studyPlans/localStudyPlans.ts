import { LEARNING_STATE_CHANGED_EVENT } from "@/features/learningLoop/localLearningState";
import { MAX_PLANS, daysUntil, parseDateOnly } from "./studyPlanSteps";

/**
 * Browser-local test-date plans for anonymous visitors (#364, AC 3.23.8): `quizymode.study-plans.v1`.
 * Separate from `quizymode.guest.v1`, so "Clear guest history" (AC 3.0.17) leaves plans alone. Reads tolerate missing,
 * corrupt or oversized data by returning an empty list. Signed-in mode ignores this key except for the sign-in claim.
 */
export const STUDY_PLANS_STORAGE_KEY = "quizymode.study-plans.v1";
const MAX_DOCUMENT_LENGTH = 4 * 1024;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LocalStudyPlan {
  collectionId: string;
  /** yyyy-MM-dd local calendar day. */
  testDate: string;
  /** ISO timestamp. */
  createdAt: string;
}

export type LocalPlanWrite = "ok" | "limit" | "storage";

function isPlan(value: unknown): value is LocalStudyPlan {
  if (!value || typeof value !== "object") return false;
  const { collectionId, testDate, createdAt } = value as Record<string, unknown>;
  return (
    typeof collectionId === "string" &&
    GUID_PATTERN.test(collectionId) &&
    typeof testDate === "string" &&
    parseDateOnly(testDate) !== null &&
    typeof createdAt === "string" &&
    Number.isFinite(Date.parse(createdAt))
  );
}

/** Valid stored plans, one per collection, at most 5, in stored order. Never throws. */
export function readLocalStudyPlans(): LocalStudyPlan[] {
  try {
    const raw = window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY);
    if (!raw || raw.length > MAX_DOCUMENT_LENGTH) return [];
    const doc = JSON.parse(raw) as { version?: unknown; plans?: unknown };
    if (!doc || doc.version !== 1 || !Array.isArray(doc.plans)) return [];
    const seen = new Set<string>();
    const plans: LocalStudyPlan[] = [];
    for (const entry of doc.plans.slice(0, MAX_PLANS * 2)) {
      if (!isPlan(entry) || seen.has(entry.collectionId.toLowerCase())) continue;
      seen.add(entry.collectionId.toLowerCase());
      plans.push({ collectionId: entry.collectionId, testDate: entry.testDate, createdAt: entry.createdAt });
      if (plans.length === MAX_PLANS) break;
    }
    return plans;
  } catch {
    return [];
  }
}

function write(plans: LocalStudyPlan[]): boolean {
  try {
    window.localStorage.setItem(STUDY_PLANS_STORAGE_KEY, JSON.stringify({ version: 1, plans }));
    window.dispatchEvent(new Event(LEARNING_STATE_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

function upcoming(plans: LocalStudyPlan[], now: Date): LocalStudyPlan[] {
  return plans.filter((plan) => (daysUntil(plan.testDate, now) ?? -1) >= 0);
}

/** Creates or changes the plan for a collection (keeps the original createdAt). Past plans are dropped on every write. */
export function upsertLocalStudyPlan(collectionId: string, testDate: string, now: Date = new Date()): LocalPlanWrite {
  const current = upcoming(readLocalStudyPlans(), now);
  const existing = current.find((plan) => plan.collectionId.toLowerCase() === collectionId.toLowerCase());
  if (!existing && current.length >= MAX_PLANS) return "limit";
  const next: LocalStudyPlan = { collectionId, testDate, createdAt: existing?.createdAt ?? now.toISOString() };
  const plans = existing
    ? current.map((plan) => (plan === existing ? next : plan))
    : [...current, next];
  return write(plans) ? "ok" : "storage";
}

/** Removes the plan for a collection. Returns false when storage could not be written. */
export function removeLocalStudyPlan(collectionId: string, now: Date = new Date()): boolean {
  const remaining = upcoming(readLocalStudyPlans(), now).filter(
    (plan) => plan.collectionId.toLowerCase() !== collectionId.toLowerCase(),
  );
  return write(remaining);
}

/** Removes the whole document (after the sign-in claim). */
export function clearLocalStudyPlans(): void {
  try {
    window.localStorage.removeItem(STUDY_PLANS_STORAGE_KEY);
    window.dispatchEvent(new Event(LEARNING_STATE_CHANGED_EVENT));
  } catch {
    // The claim retries on the next page session.
  }
}
