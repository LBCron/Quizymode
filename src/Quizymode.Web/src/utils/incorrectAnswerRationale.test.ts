import { describe, expect, it } from "vitest";
import {
  INCORRECT_ANSWER_RATIONALE_MAX,
  compactIncorrectAnswerRationale,
  getOptionRationale,
} from "./itemSpeech";

describe("compactIncorrectAnswerRationale", () => {
  it("re-indexes rationales when blank answers are removed", () => {
    const result = compactIncorrectAnswerRationale(["A", "", "C"], { 0: "why A", 1: "dropped", 2: "why C" });

    expect(result).toEqual({ 0: "why A", 1: "why C" });
  });

  it("drops blank rationales and trims the rest", () => {
    const result = compactIncorrectAnswerRationale(["A", "B"], { 0: "   ", 1: "  why B  " });

    expect(result).toEqual({ 1: "why B" });
  });

  it("caps text at the API maximum", () => {
    const result = compactIncorrectAnswerRationale(["A"], { 0: "x".repeat(INCORRECT_ANSWER_RATIONALE_MAX + 20) });

    expect(result?.[0]).toHaveLength(INCORRECT_ANSWER_RATIONALE_MAX);
  });

  it("returns undefined when nothing is left", () => {
    expect(compactIncorrectAnswerRationale(["A"], {})).toBeUndefined();
    expect(compactIncorrectAnswerRationale(["A"], null)).toBeUndefined();
  });
});

describe("getOptionRationale", () => {
  it("returns the rationale of an incorrect option", () => {
    expect(getOptionRationale(["X", "Y"], { 1: "Y is a symptom, not a cause." }, "Y")).toBe(
      "Y is a symptom, not a cause."
    );
  });

  it("returns undefined for an option with no rationale", () => {
    expect(getOptionRationale(["X", "Y"], { 1: "why" }, "X")).toBeUndefined();
  });

  it("returns undefined for an answer that is not an incorrect option", () => {
    expect(getOptionRationale(["X"], { 0: "why" }, "Correct answer")).toBeUndefined();
    expect(getOptionRationale(["X"], { 0: "why" }, null)).toBeUndefined();
  });
});
