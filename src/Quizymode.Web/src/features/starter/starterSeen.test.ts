import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { markStarterSeen, readStarterSeen, STARTER_SEEN_MAX, STARTER_SEEN_STORAGE_KEY } from "./starterSeen";
import { guid } from "./starterTestUtils";
import { GUEST_HISTORY_STORAGE_KEY, clearGuestHistory } from "@/features/guestHistory/guestHistoryStorage";

describe("starterSeen", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("starts empty and records ids oldest first, moving repeats to the end", () => {
    expect(readStarterSeen()).toEqual([]);
    markStarterSeen([guid(1), guid(2)]);
    markStarterSeen([guid(1)]);
    expect(readStarterSeen()).toEqual([guid(2), guid(1)]);
  });

  it("keeps only the newest 100 ids", () => {
    for (let n = 1; n <= STARTER_SEEN_MAX + 5; n += 1) markStarterSeen([guid(n)]);
    const seen = readStarterSeen();
    expect(seen).toHaveLength(STARTER_SEEN_MAX);
    expect(seen[0]).toBe(guid(6));
    expect(seen[seen.length - 1]).toBe(guid(STARTER_SEEN_MAX + 5));
  });

  it("tolerates corrupt, wrong-version and oversized data", () => {
    for (const raw of ["not json", "{}", JSON.stringify({ version: 2, seen: [guid(1)] }), "x".repeat(20000)]) {
      window.localStorage.setItem(STARTER_SEEN_STORAGE_KEY, raw);
      expect(readStarterSeen()).toEqual([]);
    }
    window.localStorage.setItem(
      STARTER_SEEN_STORAGE_KEY,
      JSON.stringify({ version: 1, seen: [guid(1), 5, "nope", guid(1)] }),
    );
    expect(readStarterSeen()).toEqual([guid(1)]);
  });

  it("never throws when storage is unavailable", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
    });
    try {
      expect(readStarterSeen()).toEqual([]);
      expect(markStarterSeen([guid(1)])).toBe(false);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  });

  it("is not cleared by Clear guest history", () => {
    markStarterSeen([guid(1)]);
    window.localStorage.setItem(GUEST_HISTORY_STORAGE_KEY, "{}");
    clearGuestHistory();
    expect(readStarterSeen()).toEqual([guid(1)]);
  });
});
