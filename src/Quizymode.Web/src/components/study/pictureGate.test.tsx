import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useQuestionPictureStatuses } from "./pictureGate";
import { createQuizRun, reduceQuizRun, summarizeQuizRun } from "@/features/items/quiz/quizRun";
import { getTestPalette } from "@/features/items/quiz/test/paletteSelectors";

const picture = { key: "curated:flags/fr", altText: "x" };
const items = [
  { id: "a", questionImage: picture },
  { id: "b", questionImage: picture },
  { id: "c", questionImage: picture },
  { id: "d", questionImage: picture },
  { id: "e", questionImage: null },
  { id: "f", questionImage: picture },
  { id: "g", questionImage: picture },
];

describe("unavailableIds (#403)", () => {
  it("excludes every unresolved required picture including initial loading and never reported, while retaining loaded/text items", () => {
    const { result } = renderHook(() => useQuestionPictureStatuses());
    act(() => {
      result.current.controlsFor(items[0] as never).onStatusChange("loading");
      result.current.controlsFor(items[1] as never).onStatusChange("error");
      result.current.controlsFor(items[2] as never).onStatusChange("stuck");
      result.current.controlsFor(items[3] as never).onStatusChange("unknown");
      result.current.controlsFor(items[5] as never).onStatusChange("loaded");
    });
    expect(result.current.unavailableIds(items)).toEqual(["a", "b", "c", "d", "g"]);
  });

  it("marks an initially loading required picture not scored at submit and still scores the text question", () => {
    const { result } = renderHook(() => useQuestionPictureStatuses());
    act(() => result.current.controlsFor(items[0] as never).onStatusChange("loading"));
    let run = createQuizRun(
      { kind: "global", category: null, navigationKeywords: [], filterKeywords: [], quizSize: 2 },
      ["a", "e"],
      "guest",
      "test",
    );
    run = reduceQuizRun(run, { type: "start-test", startedAt: "2026-01-01T00:00:00Z", timeLimitSec: null });
    const unavailable = result.current.unavailableIds(items);

    expect(getTestPalette(run, 0, unavailable).notScored).toBe(1);
    run = reduceQuizRun(run, { type: "submit", submittedAt: "2026-01-01T00:01:00Z", reason: "manual", unavailableItemIds: unavailable });
    expect(run.skipped).toEqual(["a"]);
    expect(summarizeQuizRun(run).scoredTotal).toBe(1);
    expect(summarizeQuizRun(run).missedItemIds).toEqual(["e"]);
  });
});
