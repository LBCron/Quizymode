/**
 * Combobox for scope filter: shows top 5 options, filters as user types.
 * Includes "All" option; keeps dropdown responsive by limiting visible items.
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

const MAX_VISIBLE = 5;

export interface ScopeFilterComboboxProps {
  /** Current value (keyword name or "" for All). */
  value: string;
  /** All available options (e.g. rank1 or rank2 keywords). */
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  disabled?: boolean;
  /** Optional: exclude "Other" from options. */
  excludeOther?: boolean;
}

export function ScopeFilterCombobox({
  value,
  options,
  onChange,
  placeholder = "All",
  label,
  disabled = false,
  excludeOther = true,
}: ScopeFilterComboboxProps) {
  const [inputText, setInputText] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const list = excludeOther
      ? options.filter((o) => o.toLowerCase() !== "other")
      : options;
    const q = inputText.trim().toLowerCase();
    if (!q) return list.slice(0, MAX_VISIBLE);
    return list
      .filter((opt) => opt.toLowerCase().includes(q))
      .slice(0, MAX_VISIBLE);
  }, [options, inputText, excludeOther]);

  useEffect(() => {
    setInputText(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (opt: string) => {
    onChange(opt);
    setInputText(opt);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setInputText("");
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputText(v);
    setIsOpen(true);
    if (!v.trim()) onChange("");
  };

  const handleInputFocus = () => setIsOpen(true);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setInputText(value || "");
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="rounded border border-gray-300 text-sm px-2 py-1.5 pr-7 w-40 bg-surface disabled:bg-gray-100"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls="scope-combobox-list"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
          <ChevronDownIcon className="h-4 w-4" />
        </span>
      </div>
      {isOpen && (
        <ul
          id="scope-combobox-list"
          className="absolute z-10 mt-0.5 w-56 max-h-48 overflow-auto rounded border border-gray-200 bg-surface shadow-lg py-1 text-sm"
          role="listbox"
        >
          <li
            role="option"
            aria-selected={!value}
            onClick={handleClear}
            className="px-3 py-1.5 cursor-pointer hover:bg-gray-100 text-gray-600"
          >
            {placeholder}
          </li>
          {filtered.map((opt) => (
            <li
              key={opt}
              role="option"
              aria-selected={value === opt}
              onClick={() => handleSelect(opt)}
              className="px-3 py-1.5 cursor-pointer hover:bg-gray-100 truncate"
            >
              {opt}
            </li>
          ))}
          {filtered.length === 0 && inputText.trim() && (
            <li className="px-3 py-1.5 text-gray-500">No match</li>
          )}
        </ul>
      )}
    </div>
  );
}
