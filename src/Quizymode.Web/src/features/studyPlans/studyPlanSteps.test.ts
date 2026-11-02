import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addLocalDays,
  countdownLabel,
  daysUntil,
  deriveToday,
  estimateMinutes,
  forecastPlan,
  localDateString,
  type PlanInput,
} from "./studyPlanSteps";

const originalTz = process.env.TZ;
function useTimeZone(tz: string) {
  process.env.TZ = tz;
}
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** A local-time Date in the pinned zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

function plan(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    testDate: "2026-11-10",
    createdAt: at(2026, 11, 1).toISOString(),
    itemCount: 20,
    firstLearnAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("studyPlanSteps in Pacific/Auckland", () => {
  beforeEach(() => useTimeZone("Pacific/Auckland"));

  it("derives days left from local calendar days, not UTC", () => {
    // 00:30 on Nov 3 in Auckland is still Nov 2 in UTC.
    const now = at(2026, 11, 3, 0, 30);
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(localDateString(now)).toBe("2026-11-03");
    expect(daysUntil("2026-11-04", now)).toBe(1);
    expect(deriveToday(plan({ testDate: "2026-11-04" }), now)?.step).toBe("practice-test");
  });

  it("a Learn run just before local midnight counts as before today, one just after does not", () => {
    const now = at(2026, 11, 3, 0, 10);
    const before = deriveToday(plan({ testDate: "2026-11-09", firstLearnAt: at(2026, 11, 2, 23, 50).toISOString() }), now);
    const after = deriveToday(plan({ testDate: "2026-11-09", firstLearnAt: at(2026, 11, 3, 0, 5).toISOString() }), now);
    expect(before?.learnedBefore).toBe(true);
    expect(before?.step).toBe("review");
    expect(after?.learnedBefore).toBe(false);
    expect(after?.step).toBe("learn");
  });

  it("counts days across the September DST start", () => {
    // Clocks go forward on Sun Sep 27, 2026, so Sep 27 is a 23-hour day.
    expect(daysUntil("2026-09-28", at(2026, 9, 26, 12))).toBe(2);
    expect(daysUntil("2026-09-28", at(2026, 9, 26, 0, 5))).toBe(2);
    expect(daysUntil("2026-09-28", at(2026, 9, 27, 23, 55))).toBe(1);
  });
});

describe("studyPlanSteps in America/Los_Angeles", () => {
  beforeEach(() => useTimeZone("America/Los_Angeles"));

  it("counts days across the November DST end", () => {
    // Clocks go back on Sun Nov 1, 2026, so Nov 1 is a 25-hour day.
    expect(daysUntil("2026-11-02", at(2026, 10, 31, 12))).toBe(2);
    expect(daysUntil("2026-11-02", at(2026, 11, 1, 23, 30))).toBe(1);
    expect(daysUntil("2026-11-02", at(2026, 11, 2, 0, 0))).toBe(0);
  });

  it("addLocalDays and localDateString stay on local calendar days", () => {
    expect(addLocalDays(at(2026, 10, 31, 23, 30), 1)).toBe("2026-11-01");
    expect(addLocalDays(at(2026, 10, 31, 23, 30), 2)).toBe("2026-11-02");
    // 17:30 local on Nov 2 is already Nov 3 in UTC.
    expect(localDateString(at(2026, 11, 2, 17, 30))).toBe("2026-11-02");
  });

  it("activity late in the evening local time counts as today even though UTC is tomorrow", () => {
    const now = at(2026, 11, 2, 21, 0);
    const result = deriveToday(
      plan({ testDate: "2026-11-05", firstLearnAt: at(2026, 11, 1).toISOString(), lastActivityAt: at(2026, 11, 2, 20, 30).toISOString() }),
      now,
    );
    expect(result?.done).toBe(true);
  });
});

describe("deriveToday step rules", () => {
  beforeEach(() => useTimeZone("UTC"));
  const now = at(2026, 11, 2);
  const learned = at(2026, 10, 30).toISOString();
  const withDays = (days: number, extra: Partial<PlanInput> = {}) => plan({ testDate: addLocalDays(now, days), ...extra });

  it("hides plans whose test date has passed", () => {
    expect(deriveToday(withDays(-1), now)).toBeNull();
    expect(deriveToday(plan({ testDate: "not-a-date" }), now)).toBeNull();
  });

  it("test day: Test today, never done even after activity today", () => {
    const result = deriveToday(withDays(0, { firstLearnAt: learned, lastActivityAt: now.toISOString() }), now);
    expect(result).toMatchObject({ daysLeft: 0, step: "test-day", done: false, countdown: "Test today", tomorrow: null });
  });

  it("day before: practice test with Test tomorrow", () => {
    expect(deriveToday(withDays(1), now)).toMatchObject({ step: "practice-test", learnedBefore: false, countdown: "Test tomorrow" });
    expect(deriveToday(withDays(1, { firstLearnAt: learned }), now)).toMatchObject({ step: "practice-test", learnedBefore: true });
  });

  it.each([2, 5, 7, 8, 30])("%i days out and not yet learned: learn", (days) => {
    expect(deriveToday(withDays(days), now)?.step).toBe("learn");
  });

  it.each([2, 5, 7])("%i days out and learned before today: review", (days) => {
    expect(deriveToday(withDays(days, { firstLearnAt: learned }), now)).toMatchObject({ step: "review", countdown: `Test in ${days} days` });
  });

  it.each([8, 30])("%i days out and learned before today: rest, next step 7 days before the test", (days) => {
    const result = deriveToday(withDays(days, { firstLearnAt: learned }), now);
    expect(result?.step).toBe("rest");
    expect(result?.nextStepDate).toBe(addLocalDays(now, days - 7));
    expect(result?.done).toBe(false);
  });

  it("a rest day is not made Done by a run", () => {
    const result = deriveToday(withDays(10, { firstLearnAt: learned, lastActivityAt: now.toISOString() }), now);
    expect(result).toMatchObject({ step: "rest", done: false });
  });

  it("learn today marks the learn step done, and tomorrow's step assumes it was learned", () => {
    const today = now.toISOString();
    const result = deriveToday(withDays(5, { firstLearnAt: today, lastActivityAt: today }), now);
    expect(result).toMatchObject({ step: "learn", learnedBefore: false, done: true, tomorrow: "review" });
  });

  it("any Learn or Quiz run today marks review and practice-test done", () => {
    const today = now.toISOString();
    expect(deriveToday(withDays(4, { firstLearnAt: learned, lastActivityAt: today }), now)).toMatchObject({ step: "review", done: true });
    expect(deriveToday(withDays(1, { firstLearnAt: learned, lastActivityAt: today }), now)).toMatchObject({
      step: "practice-test",
      done: true,
      tomorrow: "test-day",
    });
  });

  it("activity on an earlier day is not done today", () => {
    expect(deriveToday(withDays(4, { firstLearnAt: learned, lastActivityAt: learned }), now)?.done).toBe(false);
  });

  it("tomorrow after a done review 8 days out is a rest day", () => {
    const today = now.toISOString();
    expect(deriveToday(withDays(9, { firstLearnAt: today, lastActivityAt: today }), now)?.tomorrow).toBe("rest");
  });
});

describe("countdownLabel", () => {
  it("covers each range", () => {
    expect(countdownLabel(0, "2026-11-02")).toBe("Test today");
    expect(countdownLabel(1, "2026-11-03")).toBe("Test tomorrow");
    expect(countdownLabel(2, "2026-11-04")).toBe("Test in 2 days");
    expect(countdownLabel(7, "2026-11-09")).toBe("Test in 7 days");
    expect(countdownLabel(8, "2026-11-10")).toMatch(/^Test on \w+, \w+ 10$/);
  });
});

describe("estimateMinutes", () => {
  it("learn is 30 seconds per question for at most 50, practice 20 seconds for at most 500, minimum 1", () => {
    expect(estimateMinutes("learn", 0)).toBe(1);
    expect(estimateMinutes("learn", 1)).toBe(1);
    expect(estimateMinutes("learn", 10)).toBe(5);
    expect(estimateMinutes("learn", 50)).toBe(25);
    expect(estimateMinutes("learn", 600)).toBe(25);
    expect(estimateMinutes("review", 1)).toBe(1);
    expect(estimateMinutes("review", 20)).toBe(7);
    expect(estimateMinutes("practice-test", 500)).toBe(167);
    expect(estimateMinutes("practice-test", 600)).toBe(167);
  });
});

describe("forecastPlan", () => {
  beforeEach(() => useTimeZone("UTC"));
  // Mon Nov 2, 2026
  const now = at(2026, 11, 2);

  it("test today is a single Today row", () => {
    expect(forecastPlan("2026-11-02", false, now)).toEqual([{ label: "Today", text: "Test day" }]);
  });

  it("a short plan lists every day with Today first", () => {
    expect(forecastPlan("2026-11-05", false, now)).toEqual([
      { label: "Today", text: "Learn" },
      { label: "Tue", text: "Review" },
      { label: "Wed", text: "Timed practice test" },
      { label: "Thu", text: "Test day" },
    ]);
  });

  it("collapses the rest days after Today into one line, then lists the last 7 days", () => {
    const rows = forecastPlan("2026-11-20", false, now);
    expect(rows[0]).toEqual({ label: "Today", text: "Learn" });
    expect(rows[1]).toMatchObject({ label: "", text: expect.stringMatching(/^Rest until \w+, Nov 12$/) });
    expect(rows).toHaveLength(2 + 8);
    expect(rows.at(-1)).toEqual({ label: expect.any(String), text: "Test day" });
    expect(rows.at(-2)).toMatchObject({ text: "Timed practice test" });
    expect(rows[2]).toMatchObject({ text: "Review" });
  });

  it("Today shows Rest day when already learned and the test is more than a week out", () => {
    expect(forecastPlan("2026-11-12", true, now)[0]).toEqual({ label: "Today", text: "Rest day" });
  });

  it("is empty for a past or malformed date", () => {
    expect(forecastPlan("2026-11-01", false, now)).toEqual([]);
    expect(forecastPlan("nope", false, now)).toEqual([]);
  });
});
