import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getSearchRateLimit } from "@/api/search";
import { useAuth } from "@/contexts/AuthContext";
import { queryTokens } from "./highlight";
import { buildOptionModel, RETRY_OPTION_ID, type SearchOption } from "./searchOptions";
import { buildGroupViews, countRows } from "./searchRows";
import { buildSearchUrl, GROUP_PREVIEW_LIMIT, MAX_QUERY_LENGTH, tabSearchTypes } from "./searchParams";
import { trackSearchPerformed, trackSearchResultClicked } from "./searchAnalytics";
import SearchResultsPanel, { LISTBOX_ID, type SearchPanelStatus } from "./SearchResultsPanel";
import { useGlobalSearch } from "./useGlobalSearch";

interface SearchComboboxProps {
  variant: "inline" | "overlay";
  value: string;
  onValueChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Called after a choice navigates, so the host can close an overlay. */
  onNavigated: () => void;
  /** Overlay only: the Cancel button. */
  onCancel?: () => void;
  shortcutHint: string;
}

interface ActiveOverride {
  value: string;
  data: unknown;
  id: string | null;
}

const INPUT_ID = "global-search-input";

const INPUT_CLASS =
  "h-9 w-56 rounded-md border border-gray-300 bg-surface pl-8 pr-14 text-sm text-gray-900 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const OVERLAY_INPUT_CLASS =
  "h-11 w-full rounded-lg border border-gray-300 bg-surface pl-9 pr-16 text-base text-gray-900 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

/**
 * The WAI-ARIA combobox shared by the inline header box and the mobile overlay. DOM focus stays in the input; the
 * options are never focused (aria-activedescendant points at the active one).
 */
const SearchCombobox = ({
  variant,
  value,
  onValueChange,
  inputRef,
  onNavigated,
  onCancel,
  shortcutHint,
}: SearchComboboxProps) => {
  const navigate = useNavigate();
  const { isAuthenticated, userId } = useAuth();
  const overlay = variant === "overlay";

  const [open, setOpen] = useState(overlay);
  const [focused, setFocused] = useState(false);
  const [override, setOverride] = useState<ActiveOverride | null>(null);

  const text = value.trimStart();
  const trimmed = value.trim();
  const types = useMemo(() => tabSearchTypes("all", isAuthenticated), [isAuthenticated]);
  const { query, isFresh, isSearchable } = useGlobalSearch({
    q: text,
    types,
    limit: GROUP_PREVIEW_LIMIT,
    offset: 0,
    userId,
  });

  const rateLimit = query.isError ? getSearchRateLimit(query.error) : null;
  const views = useMemo(
    () => (query.data ? buildGroupViews(query.data.groups, GROUP_PREVIEW_LIMIT) : []),
    [query.data]
  );
  const model = useMemo(() => buildOptionModel(views, true), [views]);

  let status: SearchPanelStatus;
  if (trimmed.length === 0) {
    status = "idle";
  } else if (!isSearchable) {
    status = "short";
  } else if (query.isError) {
    status = rateLimit ? "rateLimited" : "error";
  } else if (query.data === undefined) {
    status = "loading";
  } else if (views.length === 0) {
    status = isFresh ? "empty" : "loading";
  } else {
    status = "results";
  }

  const hasListbox = (status === "results" && model.flat.length > 0) || status === "error";
  const retryOption: SearchOption = { id: RETRY_OPTION_ID, kind: "retry" };
  const flat: SearchOption[] = status === "error" ? [retryOption] : status === "results" ? model.flat : [];

  // The first option is active once a successful result set for the current text arrives; any later keystroke
  // clears it (the override remembers the text and result it was set for).
  const overrideApplies = override !== null && override.value === value && override.data === query.data;
  const activeId: string | null = overrideApplies
    ? override.id
    : status === "results" && isFresh
      ? (flat[0]?.id ?? null)
      : null;

  const isBusy = isSearchable && (query.isFetching || (!isFresh && !query.isError));
  const showPanel = overlay || (open && focused);
  const expanded = showPanel && hasListbox;

  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeId]);

  const setActive = (id: string | null) => setOverride({ value, data: query.data, id });

  const goTo = (to: string, clear: boolean) => {
    setOpen(false);
    if (!overlay) {
      inputRef.current?.blur();
    }
    navigate(to);
    if (clear) {
      onValueChange("");
    }
    onNavigated();
  };

  const choose = (option: SearchOption) => {
    if (option.kind === "retry") {
      void query.refetch();
      return;
    }

    if (option.kind === "row") {
      trackSearchPerformed(countRows(views));
      trackSearchResultClicked(option.row.data, option.position);
      goTo(option.row.to, true);
      return;
    }

    if (option.kind === "seeAll") {
      goTo(buildSearchUrl({ q: trimmed, tab: option.tab }), false);
      return;
    }

    goTo(buildSearchUrl({ q: trimmed }), false);
  };

  const commitTypedText = () => {
    if (trimmed.length > 0) {
      goTo(buildSearchUrl({ q: trimmed }), false);
    }
  };

  const move = (delta: 1 | -1) => {
    if (flat.length === 0) {
      return;
    }

    const index = flat.findIndex((option) => option.id === activeId);
    const next = index < 0 ? (delta === 1 ? 0 : flat.length - 1) : (index + delta + flat.length) % flat.length;
    setActive(flat[next].id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (event.altKey || !showPanel) {
          if (trimmed.length > 0 || event.altKey) setOpen(true);
          return;
        }
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        move(-1);
        return;
      case "Enter": {
        event.preventDefault();
        const active = flat.find((option) => option.id === activeId);
        // Rows of an earlier search are never acted on: Enter then searches the text as typed.
        if (active && (active.kind === "retry" || isFresh)) {
          choose(active);
        } else {
          commitTypedText();
        }
        return;
      }
      case "Escape":
        // In the overlay the dialog handles Escape and closes the whole container.
        if (overlay) return;
        if (showPanel) {
          setOpen(false);
        } else if (value) {
          onValueChange("");
        }
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        return;
    }
  };

  const liveMessage = (() => {
    if (status === "results") {
      const count = countRows(views);
      return count === 1
        ? "1 result available. Use up and down arrow keys to navigate."
        : `${count} results available. Use up and down arrow keys to navigate.`;
    }
    if (status === "empty") return `No results for ${trimmed}.`;
    if (status === "error") return "Could not load search results.";
    return "";
  })();

  const tokens = useMemo(() => queryTokens(trimmed), [trimmed]);

  const input = (
    <div className="relative">
      <label htmlFor={INPUT_ID} className="sr-only">
        Search Quizymode
      </label>
      <MagnifyingGlassIcon
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-400 ${
          overlay ? "left-3 h-5 w-5" : "left-2.5 h-4 w-4"
        }`}
        aria-hidden="true"
      />
      <input
        id={INPUT_ID}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={hasListbox ? LISTBOX_ID : undefined}
        aria-activedescendant={expanded && activeId ? activeId : undefined}
        aria-keyshortcuts="Control+K Meta+K"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={MAX_QUERY_LENGTH}
        placeholder={overlay ? "Search topics, collections, questions…" : "Search topics, questions…"}
        value={value}
        className={overlay ? OVERLAY_INPUT_CLASS : INPUT_CLASS}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setOverride({ value: event.target.value, data: query.data, id: null });
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => setFocused(false)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {!overlay && !value && !focused && (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-gray-300 bg-gray-50 px-1.5 text-[11px] font-medium text-gray-500 xl:inline-flex">
          {shortcutHint}
        </kbd>
      )}
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {isBusy && (
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full border-b-2 border-indigo-600 motion-safe:animate-spin"
          />
        )}
        {value && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear search"
            className="rounded p-1 text-gray-400 hover:text-gray-600"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onValueChange("");
              setOverride(null);
              inputRef.current?.focus();
            }}
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );

  const panel = (
    <SearchResultsPanel
      variant={variant}
      status={status}
      model={model}
      activeId={activeId}
      isStale={status === "results" && !isFresh}
      query={trimmed}
      tokens={tokens}
      rateLimit={rateLimit}
      onChoose={choose}
      onActivate={(id) => setActive(id)}
      onRetry={() => void query.refetch()}
      onNavigate={() => {
        setOpen(false);
        onNavigated();
      }}
    />
  );

  const liveRegion = (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {liveMessage}
    </div>
  );

  if (overlay) {
    return (
      <>
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
          <div className="min-w-0 flex-1">{input}</div>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 px-2 text-sm font-medium text-indigo-ink hover:text-indigo-ink"
          >
            Cancel
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{panel}</div>
        {liveRegion}
      </>
    );
  }

  return (
    <div role="search" aria-label="Site search" className="relative">
      {input}
      {liveRegion}
      {showPanel && (
        <div className="absolute right-0 top-full z-50 mt-1.5 max-h-[min(70dvh,32rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-surface py-1 shadow-xl shadow-slate-950/15">
          {panel}
        </div>
      )}
    </div>
  );
};

export default SearchCombobox;
