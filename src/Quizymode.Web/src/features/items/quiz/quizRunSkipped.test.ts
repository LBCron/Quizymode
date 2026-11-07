import { describe, expect, it } from "vitest";
import {
  createQuizRun,
  reduceQuizRun,
  restoreQuizRun,
  summarizeQuizRun,
  toCompletionSnapshot,
  type QuizRunScope,
  type QuizRunState,
} from "./quizRun";
import { getTestPalette, paletteEntryLabel } from "./test/paletteSelectors";

const scope: QuizRunScope = { kind: "global", category: null, navigationKeywords: [], filterKeywords: [], quizSize: 4 };
const ids = ["a", "b", "c", "d"];
const START = "2026-10-20T10:00:00.000Z";
const T = (seconds: number): string => new Date(Date.parse(START) + seconds * 1000).toISOString();

function answer(run: QuizRunState, itemId: string, isCorrect: boolean, at = 5): QuizRunState {
  return reduceQuizRun(run, {
    type: "answer",
    itemId,
    selectedAnswer: isCorrect ? "right" : "wrong",
    isCorrect,
    completedAt: T(at),
  });
}

function skip(run: QuizRunState, itemId: string, at = 6): QuizRunState {
  return reduceQuizRun(run, { type: "skip-unavailable", itemId, completedAt: T(at) });
}

function startedTest(): QuizRunState {
  return reduceQuizRun(createQuizRun(scope, ids, "guest", "test"), { type: "start-test", startedAt: START, timeLimitSec: 600 });
}

describe("Practice skip for an unavailable picture (#403)", () => {
  it("leaves a skipped item out of correct, scored total and missed, keeping total as the roster size", () => {
    let run = createQuizRun(scope, ids, "guest");
    run = answer(run, "a", true);
    run = answer(run, "b", false);
    run = skip(run, "c");

    expect(summarizeQuizRun(run)).toMatchObject({
      answered: 2,
      correct: 1,
      total: 4,
      skipped: 1,
      scoredTotal: 3,
      missedItemIds: ["b"],
      notAnswered: 1,
      percentage: 33,
      isComplete: false,
    });
    expect(run.skipped).toEqual(["c"]);
  });

  it("completes once every item is answered or skipped, and ignores answers to a skipped item", () => {
    let run = createQuizRun(scope, ["a", "b"], "guest");
    run = skip(run, "a");
    expect(answer(run, "a", true)).toBe(run);
    run = answer(run, "b", true, 9);

    const summary = summarizeQuizRun(run);
    expect(summary).toMatchObject({ isComplete: true, total: 2, scoredTotal: 1, correct: 1, percentage: 100 });
    expect(run.completedAt).toBe(T(9));
    expect(toCompletionSnapshot(run)).toMatchObject({ correct: 1, total: 1, missedItemIds: [] });
  });

  it("completes with nothing scored when every item is skipped and saves no session", () => {
    let run = createQuizRun(scope, ["a", "b"], "guest");
    run = skip(run, "a");
    run = skip(run, "b", 7);

    expect(summarizeQuizRun(run)).toMatchObject({ isComplete: true, scoredTotal: 0, percentage: 0, correct: 0, skipped: 2 });
    expect(run.completedAt).toBe(T(7));
    expect(toCompletionSnapshot(run)).toBeNull();
  });

  it("ignores skips for answered, repeated or unknown items, and in Test mode", () => {
    let run = createQuizRun(scope, ids, "guest");
    run = answer(run, "a", true);
    expect(skip(run, "a")).toBe(run);
    expect(skip(run, "zzz")).toBe(run);
    run = skip(run, "b");
    expect(skip(run, "b")).toBe(run);

    const notStarted = createQuizRun(scope, ids, "guest", "test");
    expect(skip(notStarted, "a")).toBe(notStarted);
    // A started Test accepts skips for unavailable pictures (picture pause, #403).
    expect(skip(startedTest(), "a").skipped).toEqual(["a"]);
  });
});

describe("Test submit with unavailable pictures (#403)", () => {
  it("skips unanswered unavailable items at submit but keeps outcomes that were recorded", () => {
    let run = startedTest();
    run = answer(run, "a", true);
    run = answer(run, "b", false);
    run = reduceQuizRun(run, {
      type: "submit",
      submittedAt: T(60),
      reason: "manual",
      unavailableItemIds: ["b", "c", "zzz"],
    });

    expect(run.skipped).toEqual(["c"]);
    expect(summarizeQuizRun(run)).toMatchObject({
      total: 4,
      scoredTotal: 3,
      skipped: 1,
      correct: 1,
      notAnswered: 1,
      missedItemIds: ["b", "d"],
      percentage: 33,
      isComplete: true,
    });
  });

  it("leaves the timer alone: a timeout submit at the deadline still merges the unavailable items", () => {
    const run = reduceQuizRun(startedTest(), {
      type: "submit",
      submittedAt: T(9999),
      reason: "manual",
      unavailableItemIds: ["d"],
    });
    expect(run.submitReason).toBe("timeout");
    expect(run.submittedAt).toBe(T(600));
    expect(run.skipped).toEqual(["d"]);
  });

  it("marks palette entries as not scored: before submit from the unavailable ids, after submit from the run", () => {
    let run = startedTest();
    run = answer(run, "a", true);
    const before = getTestPalette(run, 0, ["a", "c"]);
    expect(before.entries.map((entry) => entry.notScored)).toEqual([false, false, true, false]);
    expect(before.notScored).toBe(1);
    expect(paletteEntryLabel(before.entries[2])).toBe("Question 3, unanswered, not scored (picture unavailable)");

    run = reduceQuizRun(run, { type: "submit", submittedAt: T(30), reason: "manual", unavailableItemIds: ["c"] });
    const after = getTestPalette(run, 0);
    expect(after.entries.map((entry) => entry.result)).toEqual(["correct", "unanswered", "not-scored", "unanswered"]);
  });
});

describe("restoring runs with skipped items (#403)", () => {
  const baseSnapshot = (run: QuizRunState): Record<string, unknown> => JSON.parse(JSON.stringify(run));

  it("restores a v3 snapshot and a v2 snapshot that carry no skipped field", () => {
    const run = answer(createQuizRun(scope, ids, "guest"), "a", true);
    const v3 = baseSnapshot(run);
    delete v3.skipped;
    expect(restoreQuizRun(v3, scope, ids, "guest")?.skipped).toEqual([]);

    const v2 = baseSnapshot(run);
    delete v2.skipped;
    v2.schemaVersion = 2;
    delete (v2.outcomes as Record<string, Record<string, unknown>>).a.inputMode;
    const restored = restoreQuizRun(v2, scope, ids, "guest");
    expect(restored).toMatchObject({ schemaVersion: 3, skipped: [] });
    expect(restored?.outcomes.a.inputMode).toBe("choice");
  });

  it("round-trips skipped items, including a completed all-skipped run", () => {
    let run = createQuizRun(scope, ["a", "b"], "guest");
    run = skip(run, "a");
    expect(restoreQuizRun(baseSnapshot(run), scope, ["a", "b"], "guest")?.skipped).toEqual(["a"]);
    run = skip(run, "b", 8);
    const restored = restoreQuizRun(baseSnapshot(run), scope, ["a", "b"], "guest");
    expect(restored && summarizeQuizRun(restored)).toMatchObject({ isComplete: true, scoredTotal: 0 });
  });

  it("rejects skipped ids outside the roster, duplicates, overlap with outcomes and inconsistent completion", () => {
    const run = skip(answer(createQuizRun(scope, ids, "guest"), "a", true), "b");
    const mutate = (patch: Record<string, unknown>) => restoreQuizRun({ ...baseSnapshot(run), ...patch }, scope, ids, "guest");

    expect(mutate({})).not.toBeNull();
    expect(mutate({ skipped: ["zzz"] })).toBeNull();
    expect(mutate({ skipped: ["b", "b"] })).toBeNull();
    expect(mutate({ skipped: ["a"] })).toBeNull();
    expect(mutate({ skipped: "b" })).toBeNull();
    // Every item handled but no completion time: the summary says complete, the snapshot says not.
    expect(mutate({ skipped: ["b", "c", "d"] })).toBeNull();
  });

  it("accepts skipped items in a started Test and after it was submitted", () => {
    const test = startedTest();
    const open = { ...baseSnapshot(test), skipped: ["c"] };
    expect(restoreQuizRun(open, scope, ids, "guest", "test")?.skipped).toEqual(["c"]);

    const submitted = reduceQuizRun(test, { type: "submit", submittedAt: T(30), reason: "manual", unavailableItemIds: ["c"] });
    expect(restoreQuizRun(baseSnapshot(submitted), scope, ids, "guest", "test")?.skipped).toEqual(["c"]);
  });
});
