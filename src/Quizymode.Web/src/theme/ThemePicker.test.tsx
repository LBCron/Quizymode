import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { ThemePicker } from "./ThemePicker";
import { THEME_STORAGE_KEY, resetThemePreferenceForTests } from "./themePreference";

describe("ThemePicker", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetThemePreferenceForTests();
  });

  it("offers Dark and Light only, with Dark selected by default", () => {
    render(<ThemePicker />);
    expect(screen.getByRole("group", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });

  it("saves the chosen theme", async () => {
    render(<ThemePicker />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("reflects a theme that was already saved", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemePicker />);
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  });
});
