import { describe, expect, it } from "vitest";
import {
  parseSessionIdParam,
  parseTabParam,
  parseVisitorIdParam,
  sessionFilterHref,
  toSafeRelativeHref,
} from "./sessionFilter";

describe("sessionFilter", () => {
  it("trims and accepts a session id up to 128 characters", () => {
    expect(parseSessionIdParam("  abc ")).toBe("abc");
    expect(parseSessionIdParam("x".repeat(128))).toHaveLength(128);
  });

  it("rejects empty and over-length session ids", () => {
    expect(parseSessionIdParam("")).toBeUndefined();
    expect(parseSessionIdParam(null)).toBeUndefined();
    expect(parseSessionIdParam("x".repeat(129))).toBeUndefined();
  });

  it("accepts only GUID visitor ids", () => {
    expect(parseVisitorIdParam("8f14e45f-ceea-4672-9a3b-1f2d3c4b5a69")).toBe(
      "8f14e45f-ceea-4672-9a3b-1f2d3c4b5a69"
    );
    expect(parseVisitorIdParam("not-a-guid")).toBeUndefined();
  });

  it("falls back to the sessions tab for unknown tabs", () => {
    expect(parseTabParam("pages")).toBe("pages");
    expect(parseTabParam("nonsense")).toBe("sessions");
    expect(parseTabParam(null)).toBe("sessions");
  });

  it("builds an encoded deep link to the sessions tab", () => {
    expect(sessionFilterHref("a b/c")).toBe(
      "/admin/page-views?tab=sessions&session=a%20b%2Fc"
    );
  });

  it("links only relative same-origin paths", () => {
    expect(toSafeRelativeHref("/quiz", "?x=1")).toBe("/quiz?x=1");
    expect(toSafeRelativeHref("//evil.test/x", "")).toBeNull();
    expect(toSafeRelativeHref("https://evil.test/x", "")).toBeNull();
    expect(toSafeRelativeHref("javascript:alert(1)", "")).toBeNull();
  });
});
