import { THEME_NAMES, setThemePreference, useThemePersistFailed, useThemePreference, type ThemeName } from "./themePreference";

const LABELS: Record<ThemeName, string> = { dark: "Dark", light: "Light" };

/** "Appearance" radio group for the signed-in profile dialog (#504). Guests never see it. */
export function ThemePicker() {
  const theme = useThemePreference();
  const persistFailed = useThemePersistFailed();
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700 mb-1">Appearance</legend>
      <p className="text-xs text-gray-500 mb-2">Choose how Quizymode looks. Dark is the default.</p>
      <div className="flex gap-3">
        {THEME_NAMES.map((name) => (
          <label
            key={name}
            className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 has-[:checked]:border-indigo-600 has-[:checked]:bg-indigo-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500"
          >
            <input
              type="radio"
              name="appearance"
              value={name}
              checked={theme === name}
              onChange={() => setThemePreference(name)}
              className="h-4 w-4 accent-indigo-600"
            />
            {LABELS[name]}
          </label>
        ))}
      </div>
      {persistFailed && (
        <p role="status" className="mt-1 text-xs text-gray-500">
          Your browser blocked saving this choice. It applies until you close this tab.
        </p>
      )}
    </fieldset>
  );
}
