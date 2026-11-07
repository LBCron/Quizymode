import { useSyncExternalStore } from "react";

/**
 * Visual theme preference (#504, AC "Visual theme"). Dark is the default; signed-in users can choose Light.
 * The choice is remembered in localStorage under THEME_STORAGE_KEY and synced across tabs. When storage is
 * unavailable the choice still applies to this tab. The applied theme is exposed as `<html data-theme="dark|light">`
 * (THEME_ATTRIBUTE), which the user-guide capture (#506) relies on, together with the storage key.
 */
export type ThemeName = "dark" | "light";

export const THEME_STORAGE_KEY = "quizymode.theme.v1";
export const THEME_ATTRIBUTE = "data-theme";
export const DEFAULT_THEME: ThemeName = "dark";
export const THEME_NAMES: readonly ThemeName[] = ["dark", "light"];

let memoryValue: ThemeName | null = null;
let persistFailed = false;
let storageListenerAttached = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

export function getThemePreference(): ThemeName {
  if (memoryValue !== null) return memoryValue;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function getThemePersistFailed(): boolean {
  return persistFailed;
}

export function setThemePreference(theme: ThemeName): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    memoryValue = null;
    persistFailed = false;
  } catch {
    memoryValue = theme;
    persistFailed = true;
  }
  emit();
}

/** Writes the theme to `<html data-theme>`. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  memoryValue = null;
  persistFailed = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerAttached) {
    window.addEventListener("storage", onStorage);
    storageListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListenerAttached) {
      window.removeEventListener("storage", onStorage);
      storageListenerAttached = false;
    }
  };
}

export function useThemePreference(): ThemeName {
  return useSyncExternalStore(subscribe, getThemePreference, () => DEFAULT_THEME);
}

export function useThemePersistFailed(): boolean {
  return useSyncExternalStore(subscribe, getThemePersistFailed, () => false);
}

/** Test-only: forgets in-memory state. */
export function resetThemePreferenceForTests(): void {
  memoryValue = null;
  persistFailed = false;
}
