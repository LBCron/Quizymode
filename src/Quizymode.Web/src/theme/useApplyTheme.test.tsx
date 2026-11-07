import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { resetThemePreferenceForTests, setThemePreference } from "./themePreference";
import { resolveAppliedTheme, useApplyTheme } from "./useApplyTheme";

const auth = { isAuthenticated: false, isLoading: false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

describe("useApplyTheme", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetThemePreferenceForTests();
    auth.isAuthenticated = false;
    auth.isLoading = false;
    document.documentElement.removeAttribute("data-theme");
  });

  it("gives guests dark even when light is saved", () => {
    setThemePreference("light");
    renderHook(() => useApplyTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("applies the saved theme for signed-in users and follows changes", () => {
    auth.isAuthenticated = true;
    setThemePreference("light");
    renderHook(() => useApplyTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    act(() => setThemePreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("leaves the first-paint theme alone while auth is loading", () => {
    auth.isLoading = true;
    document.documentElement.setAttribute("data-theme", "light");
    renderHook(() => useApplyTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("resolves guest and signed-in themes", () => {
    expect(resolveAppliedTheme(false, "light")).toBe("dark");
    expect(resolveAppliedTheme(true, "light")).toBe("light");
    expect(resolveAppliedTheme(true, "dark")).toBe("dark");
  });
});
