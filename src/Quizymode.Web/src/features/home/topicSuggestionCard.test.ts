import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import {
  EMPTY_SUGGESTION_CARD_STATE,
  chooseSuggestionCard,
  readSuggestionCardState,
  suggestFromActivity,
  writeSuggestionCardState,
  type TopicSuggestion,
} from "./topicSuggestions";

const at = "2026-11-06T10:00:00.000Z";
const card = (path: string, runs = 2): TopicSuggestion => ({ path, runs, lastCompletedAt: at });

describe("suggestFromActivity", () => {
  it("keeps 2+ run topics, drops chosen, overlapping and suppressed paths, and keeps 3", () => {
    const rows = [card("a", 5), card("b", 4), card("c", 3), card("d", 2), card("e", 1), card("languages/french", 6)];
    expect(suggestFromActivity(rows, ["languages"], ["b"]).map((s) => s.path)).toEqual(["a", "c", "d"]);
  });

  it("ranks by runs, then most recent completion, then path", () => {
    const rows = [
      { path: "z", runs: 2, lastCompletedAt: "2026-11-05T10:00:00.000Z" },
      { path: "y", runs: 2, lastCompletedAt: "2026-11-06T10:00:00.000Z" },
      { path: "x", runs: 2, lastCompletedAt: "2026-11-06T10:00:00.000Z" },
    ];
    expect(suggestFromActivity(rows, [], []).map((s) => s.path)).toEqual(["x", "y", "z"]);
  });
});

describe("chooseSuggestionCard", () => {
  it("shows the top candidate as a new card and records it for today", () => {
    const choice = chooseSuggestionCard([card("a"), card("b")], EMPTY_SUGGESTION_CARD_STATE, "2026-11-06");
    expect(choice.card?.path).toBe("a");
    expect(choice.next).toEqual({ newCardDate: "2026-11-06", shown: ["a"] });
  });

  it("allows no second new card on the same day, even after the first is dismissed", () => {
    const state = { newCardDate: "2026-11-06", shown: ["a"] };
    expect(chooseSuggestionCard([card("b")], state, "2026-11-06").card).toBeUndefined();
  });

  it("allows a new card on the next UTC day", () => {
    const state = { newCardDate: "2026-11-06", shown: ["a"] };
    const choice = chooseSuggestionCard([card("b")], state, "2026-11-07");
    expect(choice.card?.path).toBe("b");
    expect(choice.next).toEqual({ newCardDate: "2026-11-07", shown: ["a", "b"] });
  });

  it("keeps an already-shown card on screen all day, even when a new candidate ranks first", () => {
    const state = { newCardDate: "2026-11-06", shown: ["a"] };
    const choice = chooseSuggestionCard([card("b", 9), card("a")], state, "2026-11-06");
    expect(choice.card?.path).toBe("a");
    expect(choice.next).toBe(state);
  });

  it("returns the same state object when nothing changes", () => {
    const state = { newCardDate: "2026-11-06", shown: ["a"] };
    expect(chooseSuggestionCard([], state, "2026-11-06").next).toBe(state);
  });
});

describe("suggestion card storage", () => {
  beforeEach(() => installMemoryLocalStorage());

  it("round-trips the state and ignores malformed storage", () => {
    writeSuggestionCardState({ newCardDate: "2026-11-06", shown: ["a"] });
    expect(readSuggestionCardState()).toEqual({ newCardDate: "2026-11-06", shown: ["a"] });
    localStorage.setItem("quizymode.topicSuggestionCard.v1", "not json");
    expect(readSuggestionCardState()).toEqual(EMPTY_SUGGESTION_CARD_STATE);
  });
});
