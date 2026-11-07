import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import TopicBreadcrumb from "./TopicBreadcrumb";
import {
  filterTopicPaths,
  MAX_TOPIC_OPTIONS,
  MIN_TOPIC_QUERY_LENGTH,
  topicPathKey,
  type TopicPath,
} from "./topicPaths";

export const TOPIC_HINT = "Type 2 or more letters of a topic, such as aws or neural.";
export const TOPIC_CAP_NOTE = `Showing the first ${MAX_TOPIC_OPTIONS}. Keep typing to narrow it down.`;
export const TOPIC_LOAD_ERROR = "Couldn't load topics. Reload the page to try again.";

interface TopicPathComboboxProps {
  idPrefix: string;
  paths: readonly TopicPath[];
  isLoading: boolean;
  isError: boolean;
  disabled?: boolean;
  invalid?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (path: TopicPath) => void;
  /** The "browse all topics" button of the no-match row. */
  onOpenBrowse: () => void;
  /** Result counts for the live region owned by the parent. */
  onAnnounce?: (message: string) => void;
}

/**
 * Searchable category > L1 > L2 picker. Filtering is local (no network). DOM focus stays on the input and the
 * options are never focused (aria-activedescendant points at the active one). No option is active by default, so
 * Enter never picks something the user did not move to.
 */
const TopicPathCombobox = ({
  idPrefix,
  paths,
  isLoading,
  isError,
  disabled = false,
  invalid = false,
  inputRef,
  onPick,
  onOpenBrowse,
  onAnnounce,
}: TopicPathComboboxProps) => {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const reactId = useId();

  const inputId = `${idPrefix}-search`;
  const listboxId = `${idPrefix}-listbox`;
  const optionId = (index: number) => `${idPrefix}-opt-${index}`;

  const trimmed = value.trim();
  const result = useMemo(() => filterTopicPaths(paths, value), [paths, value]);
  const flat = useMemo(() => result.groups.flatMap((group) => group.paths), [result]);
  // First flat option index of each group, so ids stay stable without mutating a counter while rendering.
  const groupStarts = useMemo(() => {
    const starts: number[] = [];
    let next = 0;
    for (const group of result.groups) {
      starts.push(next);
      next += group.paths.length;
    }
    return starts;
  }, [result]);
  const unavailable = disabled || isLoading || isError;
  const showPanel = open && focused && !unavailable;
  const hasOptions = flat.length > 0;
  const expanded = showPanel && hasOptions;
  const tooShort = trimmed.length < MIN_TOPIC_QUERY_LENGTH;
  const activeId = expanded && activeIndex !== null && activeIndex < flat.length ? optionId(activeIndex) : null;

  const liveMessage = (() => {
    if (unavailable || tooShort) return "";
    if (hasOptions) {
      const count = flat.length;
      return `${count} ${count === 1 ? "topic" : "topics"} available. Use up and down arrow keys to navigate.`;
    }
    return `No topics match ${trimmed}.`;
  })();

  useEffect(() => {
    if (liveMessage) onAnnounce?.(liveMessage);
  }, [liveMessage, onAnnounce]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const pick = (path: TopicPath) => {
    setValue("");
    setOpen(false);
    setActiveIndex(null);
    onPick(path);
  };

  const move = (delta: 1 | -1) => {
    if (flat.length === 0) return;
    if (activeIndex === null) {
      setActiveIndex(delta === 1 ? 0 : flat.length - 1);
      return;
    }
    setActiveIndex((activeIndex + delta + flat.length) % flat.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey || !showPanel) {
          setOpen(true);
          return;
        }
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!showPanel) {
          setOpen(true);
          return;
        }
        move(-1);
        return;
      case "Enter":
        // Never submits the surrounding form, and never picks an option that is not active.
        event.preventDefault();
        if (expanded && activeIndex !== null && flat[activeIndex]) pick(flat[activeIndex]);
        return;
      case "Escape":
        if (showPanel) {
          event.preventDefault();
          setOpen(false);
        } else if (value) {
          event.preventDefault();
          setValue("");
          setActiveIndex(null);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
  };

  let panelBody: ReactNode = null;
  if (showPanel) {
    if (tooShort) {
      panelBody = <p className="px-3 py-3 text-sm text-slate-600">{TOPIC_HINT}</p>;
    } else if (!hasOptions) {
      panelBody = (
        <p className="px-3 py-3 text-sm text-slate-600">
          No topics match “{trimmed}”. Try a shorter word, or{" "}
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen(false);
              onOpenBrowse();
            }}
            className="font-medium text-indigo-ink underline hover:text-indigo-ink"
          >
            browse all topics
          </button>
          .
        </p>
      );
    } else {
      panelBody = (
        <>
          <div id={listboxId} role="listbox" aria-label="Topics">
            {result.groups.map((group, groupIndex) => {
              const headingId = `${reactId}-${group.category}`;
              return (
                <div key={group.category} role="group" aria-labelledby={headingId}>
                  <div
                    id={headingId}
                    className="flex items-baseline gap-2 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    <span>{group.category}</span>
                    {group.paths[0].categoryDescription && (
                      <span className="min-w-0 truncate font-normal text-slate-600">
                        {group.paths[0].categoryDescription}
                      </span>
                    )}
                  </div>
                  {group.paths.map((path, pathIndex) => {
                    const optionIndex = groupStarts[groupIndex] + pathIndex;
                    const active = optionIndex === activeIndex;
                    return (
                      <div
                        key={topicPathKey(path)}
                        id={optionId(optionIndex)}
                        role="option"
                        aria-selected={active}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => {
                          if (activeIndex !== optionIndex) setActiveIndex(optionIndex);
                        }}
                        onClick={() => pick(path)}
                        className={`min-h-11 cursor-pointer border-l-2 px-3 py-2 text-sm sm:min-h-0 ${
                          active
                            ? "border-indigo-600 bg-indigo-50 text-indigo-ink forced-colors:outline forced-colors:outline-2"
                            : "border-transparent text-slate-900"
                        }`}
                      >
                        <div className="break-words font-medium">
                          <TopicBreadcrumb parts={[path.category, path.l1, path.l2]} tokens={result.tokens} />
                        </div>
                        {path.description && <div className="text-xs text-slate-600">{path.description}</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {result.overflow && <p className="px-3 py-2 text-xs text-slate-600">{TOPIC_CAP_NOTE}</p>}
        </>
      );
    }
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        Search topics
      </label>
      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-invalid={invalid ? true : undefined}
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-activedescendant={activeId ?? undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={60}
          disabled={unavailable}
          placeholder={isLoading ? "Loading topics…" : "Search topics, e.g. aws saa"}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActiveIndex(null);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-11 w-full rounded-md border border-gray-300 bg-surface pl-3 pr-16 text-base text-gray-900 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 sm:h-10 sm:text-sm"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {isLoading && (
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-full border-b-2 border-indigo-600 motion-safe:animate-spin"
            />
          )}
          {value && !unavailable && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear topic search"
              className="rounded p-1 text-gray-400 hover:text-gray-600"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setValue("");
                setActiveIndex(null);
                inputRef.current?.focus();
              }}
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {isError && (
        <p role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          {TOPIC_LOAD_ERROR}
        </p>
      )}
      {panelBody && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-surface sm:absolute sm:z-50 sm:max-h-[min(60dvh,24rem)] sm:w-full sm:max-w-xl sm:rounded-xl sm:shadow-xl sm:shadow-slate-950/15"
        >
          {panelBody}
        </div>
      )}
    </div>
  );
};

export default TopicPathCombobox;
