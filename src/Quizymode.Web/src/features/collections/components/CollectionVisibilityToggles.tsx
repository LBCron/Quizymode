import * as React from "react";

export interface CollectionVisibilityPatch {
  isPublic: boolean;
  isDiscoverable: boolean;
}

interface CollectionVisibilityTogglesProps {
  isPublic: boolean;
  isDiscoverable: boolean;
  disabled?: boolean;
  onChange: (patch: CollectionVisibilityPatch) => void;
}

interface SwitchRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function SwitchRow({ label, description, checked, disabled, onToggle }: SwitchRowProps) {
  const labelId = React.useId();
  const descriptionId = React.useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span id={labelId} className={`text-sm font-medium ${disabled ? "text-slate-400" : "text-slate-700"}`}>
          {label}
        </span>
        <p id={descriptionId} className="text-xs text-slate-600">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onClick={onToggle}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-indigo-600" : "bg-gray-200"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Link access and Discover listing switches (AC 1.7). Turning link access off also turns Discover off;
 * Discover can only be turned on while link access is on.
 */
export function CollectionVisibilityToggles({
  isPublic,
  isDiscoverable,
  disabled = false,
  onChange,
}: CollectionVisibilityTogglesProps) {
  const discoverable = isPublic && isDiscoverable;
  return (
    <div className="space-y-3">
      <SwitchRow
        label="Anyone with the link can view"
        description="People you send the link to can open, study, and quiz this collection without signing in."
        checked={isPublic}
        disabled={disabled}
        onToggle={() => onChange({ isPublic: !isPublic, isDiscoverable: isPublic ? false : discoverable })}
      />
      <SwitchRow
        label="List in Discover"
        description={
          isPublic
            ? "Also show this collection in Discover search so anyone can find it."
            : "Turn on link access first to list this collection in Discover."
        }
        checked={discoverable}
        disabled={disabled || !isPublic}
        onToggle={() => onChange({ isPublic, isDiscoverable: !discoverable })}
      />
    </div>
  );
}
