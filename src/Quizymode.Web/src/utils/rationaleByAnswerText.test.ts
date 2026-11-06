import { describe, expect, it } from "vitest";
import { compactIncorrectAnswerRationale, rationaleByAnswerText } from "./itemSpeech";

describe("rationaleByAnswerText (#485 upload JSON)", () => {
  it("maps answer-text keys to index keys, ignoring case and surrounding spaces", () => {
    const result = rationaleByAnswerText(
      { " capital is nice ": "Paris, not Nice.", "Capital is Lyon": "Lyon is not the capital." },
      ["Capital is Lyon", "Capital is Nice"]
    );

    expect(result).toEqual({ 0: "Lyon is not the capital.", 1: "Paris, not Nice." });
  });

  it("ignores unmatched keys and non-string values", () => {
    const result = rationaleByAnswerText({ Unknown: "x", "Capital is Lyon": 42 }, ["Capital is Lyon"]);

    expect(result).toEqual({});
  });

  it("returns null for anything that is not a plain object", () => {
    expect(rationaleByAnswerText(null, ["A"])).toBeNull();
    expect(rationaleByAnswerText(["why A"], ["A"])).toBeNull();
    expect(rationaleByAnswerText("why A", ["A"])).toBeNull();
    expect(rationaleByAnswerText(undefined, ["A"])).toBeNull();
  });

  it("feeds compactIncorrectAnswerRationale so the upload keeps the matched text", () => {
    const answers = ["A", "B"];
    const byIndex = rationaleByAnswerText({ B: "why B" }, answers);

    expect(compactIncorrectAnswerRationale(answers, byIndex)).toEqual({ 1: "why B" });
  });
});
