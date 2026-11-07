import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSearchRateLimit } from "@/api/search";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { SEO } from "@/components/SEO";
import { useAuth } from "@/contexts/AuthContext";
import { queryTokens } from "../highlight";
import SearchRowContent from "../SearchRowContent";
import { trackSearchPerformed, trackSearchResultClicked } from "../searchAnalytics";
import {
  buildSearchUrl,
  GROUP_PREVIEW_LIMIT,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  parseSearchParams,
  TAB_PAGE_SIZE,
  tabSearchTypes,
  type SearchTab,
} from "../searchParams";
import { buildGroupViews, countRows, GROUP_LABELS, GROUP_TABS, type SearchGroupView, type SearchRow } from "../searchRows";
import { useGlobalSearch } from "../useGlobalSearch";

const TAB_LABELS: Record<SearchTab, string> = {
  all: "All",
  topics: "Topics",
  collections: "Collections",
  questions: "Questions",
  mine: "Mine",
};

const EMPTY_NOUN: Record<Exclude<SearchTab, "all">, string> = {
  topics: "topics",
  collections: "collections",
  questions: "questions",
  mine: "items of yours",
};

const TAB_BASE =
  "inline-flex shrink-0 items-center gap-1 px-1.5 sm:px-2 py-1 text-sm font-medium rounded-md whitespace-nowrap";
const TAB_ACTIVE = "bg-indigo-50 text-indigo-ink border border-indigo-200";
const TAB_INACTIVE = "border border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900";

function SearchForm({ initial, onSubmit }: { initial: string; onSubmit: (q: string) => void }) {
  const [draft, setDraft] = useState(initial);
  return (
    <form
      role="search"
      aria-label="Search Quizymode"
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = draft.trim();
        if (trimmed) {
          onSubmit(trimmed);
        }
      }}
    >
      <label className="min-w-0 flex-1">
        <span className="sr-only">Search Quizymode</span>
        <input
          type="text"
          value={draft}
          maxLength={MAX_QUERY_LENGTH}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search topics, collections, questions…"
          onChange={(event) => setDraft(event.target.value)}
          className="h-11 w-full rounded-md border border-gray-300 px-3 text-base text-gray-900 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm"
        />
      </label>
      <button
        type="submit"
        className="h-11 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Search
      </button>
    </form>
  );
}

function ResultRow({
  row,
  position,
  tokens,
  onClick,
}: {
  row: SearchRow;
  position: number;
  tokens: string[];
  onClick: (row: SearchRow, position: number) => void;
}) {
  return (
    <li>
      <Link
        to={row.to}
        onClick={() => onClick(row, position)}
        className="flex items-start gap-3 px-3 py-3 text-sm text-slate-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <SearchRowContent data={row.data} tokens={tokens} density="page" />
      </Link>
    </li>
  );
}

const SearchPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, userId } = useAuth();
  // While auth is still resolving, keep a mine tab in the URL instead of silently downgrading it.
  const { q, tab, page } = parseSearchParams(searchParams, isAuthenticated || authLoading);
  const trimmed = q.trim();
  const tokens = queryTokens(trimmed);

  const isAll = tab === "all";
  const limit = isAll ? GROUP_PREVIEW_LIMIT : TAB_PAGE_SIZE;
  const offset = isAll ? 0 : (page - 1) * TAB_PAGE_SIZE;
  const { query, isFresh, isSearchable } = useGlobalSearch({
    q,
    types: tabSearchTypes(tab, isAuthenticated),
    limit,
    offset,
    userId,
    debounce: false,
  });

  const views: SearchGroupView[] = useMemo(
    () => (query.data ? buildGroupViews(query.data.groups, isAll ? GROUP_PREVIEW_LIMIT : null) : []),
    [query.data, isAll]
  );
  const rowCount = countRows(views);
  const rateLimit = query.isError ? getSearchRateLimit(query.error) : null;

  // One search_performed per committed search: the first result set for a new text. Tab and page changes do not
  // count, and the text is never part of the payload.
  const trackedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (isFresh && trackedQuery.current !== trimmed) {
      trackedQuery.current = trimmed;
      trackSearchPerformed(rowCount);
    }
  }, [isFresh, trimmed, rowCount]);

  // After a Previous/Next click, move the screen reader to the new results. Tab changes also reset the page but
  // must leave focus on the selected tab, so only pager clicks arm this flag.
  const pagerNavigation = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) {
      previousPage.current = page;
      if (!pagerNavigation.current) {
        return;
      }
      pagerNavigation.current = false;
      panelRef.current?.scrollIntoView?.({ block: "start" });
      headingRef.current?.focus();
    }
  }, [page]);

  const tabs: SearchTab[] = isAuthenticated
    ? ["all", "topics", "collections", "questions", "mine"]
    : ["all", "topics", "collections", "questions"];
  const tabRefs = useRef<Partial<Record<SearchTab, HTMLButtonElement | null>>>({});

  const goToPage = (nextPage: number) => {
    pagerNavigation.current = true;
    goTo(tab, nextPage);
  };

  const goTo = (nextTab: SearchTab, nextPage = 1) => {
    navigate(buildSearchUrl({ q: trimmed, tab: nextTab, page: nextPage }), { replace: true });
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: SearchTab) => {
    const index = tabs.indexOf(current);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) {
      return;
    }

    event.preventDefault();
    tabRefs.current[tabs[next]]?.focus();
    goTo(tabs[next]);
  };

  const onRowClick = (row: SearchRow, position: number) => {
    trackSearchResultClicked(row.data, position);
  };

  const hasMore = views.some((view) => view.hasMore);
  const isStale = query.isSuccess && query.isPlaceholderData;

  let body;
  if (!isSearchable) {
    body = (
      <p className="text-sm text-slate-600">
        Type at least {MIN_QUERY_LENGTH} characters to search topics, collections and questions.
      </p>
    );
  } else if (query.isError) {
    body = rateLimit ? (
      <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p>
          {rateLimit.retryAfterSeconds
            ? `You are searching too fast. Try again in ${rateLimit.retryAfterSeconds} ${
                rateLimit.retryAfterSeconds === 1 ? "second" : "seconds"
              }.`
            : "You are searching too fast. Please wait a few seconds and try again."}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="mt-2 text-sm font-medium text-amber-900 underline hover:text-amber-700"
        >
          Try again
        </button>
      </div>
    ) : (
      <ErrorMessage message="Could not load search results." onRetry={() => void query.refetch()} />
    );
  } else if (query.data === undefined) {
    body = <LoadingSpinner />;
  } else if (views.length === 0) {
    body = !isFresh ? (
      <LoadingSpinner />
    ) : isAll ? (
      <div className="rounded-[24px] border border-dashed border-slate-300 bg-surface/80 px-6 py-12 text-center">
        <p className="font-medium text-slate-900">No results for “{trimmed}”</p>
        <p className="mt-1 text-sm text-slate-600">Check the spelling or try fewer words.</p>
        <p className="mt-3 flex justify-center gap-4 text-sm font-medium text-indigo-ink">
          <Link to="/categories" className="hover:text-indigo-ink">
            Browse categories
          </Link>
          <Link to="/collections" className="hover:text-indigo-ink">
            Browse collections
          </Link>
        </p>
      </div>
    ) : (
      <div className="rounded-[24px] border border-dashed border-slate-300 bg-surface/80 px-6 py-12 text-center">
        <p className="font-medium text-slate-900">
          No {EMPTY_NOUN[tab as Exclude<SearchTab, "all">]} for “{trimmed}”
        </p>
        <button
          type="button"
          onClick={() => goTo("all")}
          className="mt-3 text-sm font-medium text-indigo-ink hover:text-indigo-ink"
        >
          Search everything
        </button>
      </div>
    );
  } else if (isAll) {
    body = (
      <div className={`space-y-6 ${isStale ? "opacity-60" : ""}`}>
        {views.map((view, viewIndex) => (
          <section key={view.id} aria-labelledby={`search-h-${view.id}`}>
            <h2
              id={`search-h-${view.id}`}
              className="mb-1 text-sm font-semibold uppercase tracking-[0.12em] text-slate-600"
            >
              {view.label}
            </h2>
            <ul className="divide-y divide-slate-100">
              {view.rows.map((row, index) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  position={countRows(views.slice(0, viewIndex)) + index + 1}
                  tokens={tokens}
                  onClick={onRowClick}
                />
              ))}
            </ul>
            {view.hasMore && view.id !== "mine" && (
              <button
                type="button"
                onClick={() => goTo(GROUP_TABS[view.id])}
                className="mt-1 px-3 py-2 text-sm font-medium text-indigo-ink hover:text-indigo-ink"
              >
                See all {GROUP_LABELS[view.id].toLowerCase()}
              </button>
            )}
          </section>
        ))}
      </div>
    );
  } else {
    const heading = page > 1 ? `${TAB_LABELS[tab]}, page ${page}` : `${TAB_LABELS[tab]} results`;
    body = (
      <>
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">
          {heading}
        </h2>
        <div className={isStale ? "opacity-60" : undefined}>
          {views.map((view) => (
            <ul key={view.id} className="divide-y divide-slate-100">
              {view.rows.map((row, index) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  position={offset + index + 1}
                  tokens={tokens}
                  onClick={onRowClick}
                />
              ))}
            </ul>
          ))}
        </div>
        <nav aria-label="Search results pages" className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-slate-600">Page {page}</span>
          <button
            type="button"
            disabled={!hasMore}
            onClick={() => goToPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <SEO title="Search" noindex />
      <h1 className="text-2xl font-bold text-slate-900">{trimmed ? `Results for “${trimmed}”` : "Search"}</h1>
      <SearchForm
        key={trimmed}
        initial={trimmed}
        onSubmit={(next) => navigate(buildSearchUrl({ q: next, tab }), { replace: false })}
      />
      <div className="relative">
        <div
          role="tablist"
          aria-label="Search result types"
          className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((id) => {
            const selected = id === tab;
            return (
              <button
                key={id}
                ref={(element) => {
                  tabRefs.current[id] = element;
                }}
                type="button"
                role="tab"
                id={`search-tab-${id}`}
                aria-selected={selected}
                aria-controls="search-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => goTo(id)}
                onKeyDown={(event) => onTabKeyDown(event, id)}
                className={`${TAB_BASE} ${selected ? TAB_ACTIVE : TAB_INACTIVE}`}
              >
                {TAB_LABELS[id]}
              </button>
            );
          })}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white to-transparent sm:hidden"
        />
      </div>
      <div ref={panelRef} role="tabpanel" id="search-panel" aria-labelledby={`search-tab-${tab}`} tabIndex={0}>
        {body}
      </div>
    </div>
  );
};

export default SearchPage;
