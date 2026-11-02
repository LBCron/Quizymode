/**
 * Test-date plan step rules (#364, AC 3.23.6). One pure derivation shared by signed-in and guest plans. "Today" is the
 * browser's local calendar day (unlike the UTC daily quiz), and day counts use calendar dates so DST never shifts them.
 */
export const MAX_PLAN_DAYS_AHEAD = 30;
export const MAX_PLANS = 5;
export const MAX_LANE_PLANS = 3;
export const ACTIVITY_LOOKBACK_DAYS = 14;
export const REVIEW_WINDOW_DAYS = 7;

export type StepKind = "learn" | "review" | "practice-test" | "test-day" | "rest";

export interface PlanInput {
  /** yyyy-MM-dd */
  testDate: string;
  /** ISO timestamp the plan was created. */
  createdAt: string;
  itemCount: number;
  /** ISO timestamp of the first Learn run in the plan window, or null. */
  firstLearnAt: string | null;
  /** ISO timestamp of the latest Learn or Quiz run in the plan window, or null. */
  lastActivityAt: string | null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** yyyy-MM-dd of the local calendar day (never toISOString, which is UTC). */
export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateOnly(value: string): { y: number; m: number; d: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** A local-time Date at noon of the given calendar day (noon avoids DST edge cases at midnight). */
export function localDateFromString(value: string): Date | null {
  const parts = parseDateOnly(value);
  return parts ? new Date(parts.y, parts.m - 1, parts.d, 12) : null;
}

/** Local calendar day `days` after `from` as yyyy-MM-dd. */
export function addLocalDays(from: Date, days: number): string {
  return localDateString(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, 12));
}

/** Whole calendar days from the local today to the test date (negative once passed); null when the date is malformed. */
export function daysUntil(testDate: string, now: Date): number | null {
  const test = parseDateOnly(testDate);
  if (!test) return null;
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(test.y, test.m - 1, test.d) - todayUtc) / 86_400_000);
}

export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export function countdownLabel(daysLeft: number, testDate: string): string {
  if (daysLeft <= 0) return "Test today";
  if (daysLeft === 1) return "Test tomorrow";
  if (daysLeft <= REVIEW_WINDOW_DAYS) return `Test in ${daysLeft} days`;
  const date = localDateFromString(testDate);
  return date ? `Test on ${formatShortDate(date)}` : "Test date set";
}

function stepFor(daysLeft: number, learnedBefore: boolean): StepKind {
  if (daysLeft <= 0) return "test-day";
  if (daysLeft === 1) return "practice-test";
  if (!learnedBefore) return "learn";
  return daysLeft <= REVIEW_WINDOW_DAYS ? "review" : "rest";
}

/** Minutes for the step: Learn reads 30 s a question (first 50), practice runs 20 s a question (first 500); at least 1. */
export function estimateMinutes(kind: StepKind, itemCount: number): number {
  const seconds = kind === "learn" ? Math.min(itemCount, 50) * 30 : Math.min(itemCount, 500) * 20;
  return Math.max(1, Math.ceil(seconds / 60));
}

export const NEXT_STEP_NAME: Record<StepKind, string> = {
  learn: "Learn the basics",
  review: "Practice quiz",
  "practice-test": "Timed practice test",
  "test-day": "Test day",
  rest: "Rest day",
};

export interface TodayStep {
  daysLeft: number;
  countdown: string;
  step: StepKind;
  learnedBefore: boolean;
  /** A Learn or Quiz run of the collection finished today on a Learn, Practice quiz or Practice test step (never test day or rest). */
  done: boolean;
  /** Tomorrow's step, assuming today's step is done. Null on test day. */
  tomorrow: StepKind | null;
  /** Local date (yyyy-MM-dd) of the first step after a rest day, which is 7 days before the test. Null unless resting. */
  nextStepDate: string | null;
}

/** Today's step for a plan, or null once the test date has passed or the date is malformed. */
export function deriveToday(plan: PlanInput, now: Date): TodayStep | null {
  const daysLeft = daysUntil(plan.testDate, now);
  if (daysLeft === null || daysLeft < 0) return null;
  const today = localDateString(now);
  const learnedBefore = plan.firstLearnAt !== null && localDateString(new Date(plan.firstLearnAt)) < today;
  const activeToday = plan.lastActivityAt !== null && localDateString(new Date(plan.lastActivityAt)) === today;
  const step = stepFor(daysLeft, learnedBefore);
  const counts = step === "learn" || step === "review" || step === "practice-test";
  return {
    daysLeft,
    countdown: countdownLabel(daysLeft, plan.testDate),
    step,
    learnedBefore,
    done: counts && activeToday,
    tomorrow: daysLeft === 0 ? null : stepFor(daysLeft - 1, true),
    nextStepDate: step === "rest" ? addLocalDays(now, daysLeft - REVIEW_WINDOW_DAYS) : null,
  };
}

export interface ForecastRow {
  label: string;
  text: string;
}

const FORECAST_NAME: Record<StepKind, string> = {
  learn: "Learn",
  review: "Review",
  "practice-test": "Timed practice test",
  "test-day": "Test day",
  rest: "Rest day",
};

/**
 * Per-day preview for the plan dialog, assuming each earlier day is done. The Today row is always first, then one
 * "Rest until {date}" line for the run of rest days after it, then each remaining day. `learnedBefore` is today's state.
 */
export function forecastPlan(testDate: string, learnedBefore: boolean, now: Date): ForecastRow[] {
  const total = daysUntil(testDate, now);
  if (total === null || total < 0) return [];
  const rows: ForecastRow[] = [];
  let restRunEnd: Date | null = null;
  for (let offset = 0; offset <= total; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
    const step = stepFor(total - offset, offset === 0 ? learnedBefore : true);
    if (offset > 0 && step === "rest") {
      restRunEnd = day;
      continue;
    }
    if (restRunEnd) {
      rows.push({ label: "", text: `Rest until ${formatShortDate(restRunEnd)}` });
      restRunEnd = null;
    }
    const label =
      offset === 0
        ? "Today"
        : offset <= 6
          ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)
          : formatShortDate(day);
    rows.push({ label, text: FORECAST_NAME[step] });
  }
  return rows;
}
