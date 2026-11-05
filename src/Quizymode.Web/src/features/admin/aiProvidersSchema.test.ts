import { describe, expect, it } from "vitest";
import { formatAttemptOutcome, routeHasKeyedVendor } from "./aiProvidersSchema";

describe("routeHasKeyedVendor", () => {
  const keys = { OpenRouter: false, OpenAI: false, Gemini: true };

  it("is true when any vendor in the route has a key", () => {
    expect(routeHasKeyedVendor(["OpenRouter", "Gemini"], keys)).toBe(true);
  });

  it("is false when no vendor in the route has a key", () => {
    expect(routeHasKeyedVendor(["OpenRouter", "OpenAI"], keys)).toBe(false);
  });

  it("is false for an empty route and for vendors the server did not report", () => {
    expect(routeHasKeyedVendor([], keys)).toBe(false);
    expect(routeHasKeyedVendor(["Mistral"], keys)).toBe(false);
  });
});

describe("formatAttemptOutcome", () => {
  it("labels auth errors and leaves other outcomes as-is", () => {
    expect(formatAttemptOutcome("AuthError")).toBe("Auth error (check key)");
    expect(formatAttemptOutcome("RateLimited")).toBe("Rate limited (429)");
    expect(formatAttemptOutcome("LowQuoteYield")).toBe("LowQuoteYield");
    expect(formatAttemptOutcome("SomethingNew")).toBe("SomethingNew");
  });
});
