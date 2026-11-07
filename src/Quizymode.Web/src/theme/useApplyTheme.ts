import { useLayoutEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { applyTheme, DEFAULT_THEME, useThemePreference, type ThemeName } from "./themePreference";

/** Guests always get the default theme; signed-in users get their saved choice. */
export function resolveAppliedTheme(isAuthenticated: boolean, preference: ThemeName): ThemeName {
  return isAuthenticated ? preference : DEFAULT_THEME;
}

/**
 * Keeps `<html data-theme>` correct once auth resolves. The inline script in index.html applies the saved theme
 * before first paint; this layout effect corrects it for guests and follows picker / cross-tab changes.
 */
export function useApplyTheme(): ThemeName {
  const { isAuthenticated, isLoading } = useAuth();
  const preference = useThemePreference();
  const applied = resolveAppliedTheme(isAuthenticated, preference);
  useLayoutEffect(() => {
    // While auth is still resolving keep what the first-paint script applied, to avoid a flash.
    if (isLoading) return;
    applyTheme(applied);
  }, [applied, isLoading]);
  return applied;
}
