import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyTheme,
  getThemePreference,
  resetThemePreferenceForTests,
  setThemePreference,
  useThemePersistFailed,
  useThemePreference,
} from "./themePreference";

describe("themePreference", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetThemePreferenceForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exposes a stable storage key and attribute for the user-guide capture", () => {
    expect(THEME_STORAGE_KEY).toBe("quizymode.theme.v1");
    expect(THEME_ATTRIBUTE).toBe("data-theme");
  });

  it("defaults to dark and persists the choice", () => {
    expect(getThemePreference()).toBe("dark");
    setThemePreference("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getThemePreference()).toBe("light");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "playful");
    expect(getThemePreference()).toBe("dark");
  });

  it("falls back to dark when storage cannot be read", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getThemePreference()).toBe("dark");
  });

  it("keeps the choice for the tab and reports the failure when storage throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => ({ theme: useThemePreference(), failed: useThemePersistFailed() }));
    act(() => setThemePreference("light"));
    expect(result.current).toEqual({ theme: "light", failed: true });
  });

  it("follows another tab through the storage event", () => {
    const { result } = renderHook(() => useThemePreference());
    expect(result.current).toBe("dark");
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    });
    expect(result.current).toBe("light");
  });

  it("ignores storage events for other keys", () => {
    const { result } = renderHook(() => useThemePreference());
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    });
    expect(result.current).toBe("dark");
  });

  it("writes the theme to the html element", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    applyTheme("dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });
});
