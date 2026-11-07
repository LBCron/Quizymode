/**
 * Combobox for adding keyword tag filters.
 * Resets the input after each selection so users can add multiple keywords.
 * Shows up to 5 matching suggestions from the provided in-memory options.
 */
import { useState, useMemo } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

const MAX_SUGGESTIONS = 5;

interface KeywordFilterComboboxProps {
  /** All available keywords (should already exclude already-selected ones). */
  options: string[];
  onAdd: (keyword: string) => void;
  placeholder?: string;
}

export function KeywordFilterCombobox({
  options,
  onAdd,
  placeholder = "Type to search keywords…",
}: KeywordFilterComboboxProps) {
  const [inputText, setInputText] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const suggestions = useMemo(() => {
    const q = inputText.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((o) => o.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [options, inputText]);

  const handleSelect = (opt: string) => {
    onAdd(opt);
    setInputText("");
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && inputText.trim()) {
              const exact = options.find((o) => o.toLowerCase() === inputText.trim().toLowerCase());
              handleSelect(exact ?? inputText.trim());
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-0"
        />
      </div>
      {isOpen && suggestions.length > 0 && (
        <ul
          className="absolute z-20 mt-0.5 w-full rounded-md border border-gray-200 bg-surface py-1 shadow-lg text-sm"
          role="listbox"
        >
          {suggestions.map((opt) => (
            <li
              key={opt}
              role="option"
              aria-selected={false}
              onMouseDown={() => handleSelect(opt)}
              className="cursor-pointer px-3 py-1.5 hover:bg-indigo-50 hover:text-indigo-ink"
            >
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
