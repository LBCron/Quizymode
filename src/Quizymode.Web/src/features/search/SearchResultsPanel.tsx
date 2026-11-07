import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import ErrorMessage from "@/components/ErrorMessage";
import type { SearchRateLimit } from "@/api/search";
import SearchRowContent from "./SearchRowContent";
import { RETRY_OPTION_ID, type SearchOption, type SearchOptionModel } from "./searchOptions";
import { GROUP_LABELS } from "./searchRows";

export type SearchPanelStatus = "idle" | "short" | "loading" | "error" | "rateLimited" | "empty" | "results";

export const LISTBOX_ID = "global-search-listbox";

interface SearchResultsPanelProps {
  variant: "inline" | "overlay";
  status: SearchPanelStatus;
  model: SearchOptionModel;
  activeId: string | null;
  /** Rows shown belong to an earlier search: dim them. */
  isStale: boolean;
  /** The trimmed text, for the "See all results" and empty copy. */
  query: string;
  tokens: string[];
  rateLimit: SearchRateLimit | null;
  onChoose: (option: SearchOption) => void;
  onActivate: (id: string) => void;
  /** Called by the notice's own button (rate limited). */
  onRetry: () => void;
  /** Called when a link inside the panel (Browse all categories) is followed. */
  onNavigate: () => void;
}

function optionClass(active: boolean, overlay: boolean): string {
  const base = `flex ${overlay ? "min-h-[48px] py-3" : "min-h-[44px] py-2"} cursor-pointer items-start gap-3 border-l-2 px-3 text-sm`;
  return active
    ? `${base} border-indigo-600 bg-indigo-50 text-indigo-ink forced-colors:outline forced-colors:outline-2`
    : `${base} border-transparent text-slate-900`;
}

function Skeleton({ overlay }: { overlay: boolean }) {
  const padding = overlay ? "py-3" : "py-3";
  return (
    <div className="space-y-1" data-testid="search-skeleton" aria-hidden="true">
      {["w-3/5", "w-4/5", "w-[45%]"].map((width) => (
        <div key={width} className={`px-3 ${padding}`}>
          <div className={`h-4 rounded bg-slate-100 motion-safe:animate-pulse ${width}`} />
        </div>
      ))}
    </div>
  );
}

const SearchResultsPanel = ({
  variant,
  status,
  model,
  activeId,
  isStale,
  query,
  tokens,
  rateLimit,
  onChoose,
  onActivate,
  onRetry,
  onNavigate,
}: SearchResultsPanelProps) => {
  const overlay = variant === "overlay";

  const optionProps = (option: SearchOption) => ({
    id: option.id,
    role: "option" as const,
    "aria-selected": activeId === option.id,
    className: optionClass(activeId === option.id, overlay),
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseMove: () => {
      if (activeId !== option.id) {
        onActivate(option.id);
      }
    },
    onClick: () => onChoose(option),
  });

  let body: ReactNode = null;

  if (status === "idle") {
    body = <p className="px-3 py-3 text-sm text-slate-600">Search topics, collections and questions.</p>;
  } else if (status === "short") {
    body = <p className="px-3 py-3 text-sm text-slate-600">Keep typing. Search needs at least 2 characters.</p>;
  } else if (status === "loading") {
    body = <Skeleton overlay={overlay} />;
  } else if (status === "rateLimited") {
    const seconds = rateLimit?.retryAfterSeconds;
    body = (
      <div className="p-2">
        <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {seconds
              ? `You are searching too fast. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
              : "You are searching too fast. Please wait a few seconds and try again."}
          </p>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRetry}
            className="mt-2 min-h-[32px] text-sm font-medium text-amber-900 underline hover:text-amber-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  } else if (status === "error") {
    body = (
      <>
        <div className="p-2">
          <ErrorMessage message="Could not load search results." />
        </div>
        <div id={LISTBOX_ID} role="listbox" aria-label="Search results">
          <div {...optionProps({ id: RETRY_OPTION_ID, kind: "retry" })}>
            <span className="font-medium text-indigo-ink">Try again</span>
          </div>
        </div>
      </>
    );
  } else if (status === "empty") {
    body = (
      <div className="px-3 py-4 text-sm">
        <p className="font-medium text-slate-900">No results for “{query}”</p>
        <p className="mt-1 text-slate-600">Check the spelling or try fewer words.</p>
        <Link
          to="/categories"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNavigate}
          className="mt-2 inline-block font-medium text-indigo-ink hover:text-indigo-ink"
        >
          Browse all categories
        </Link>
      </div>
    );
  } else {
    body = (
      <div id={LISTBOX_ID} role="listbox" aria-label="Search results" className={isStale ? "opacity-60" : undefined}>
        {model.groups.map((group) => {
          const headingId = `gs-h-${group.view.id}`;
          return (
            <div key={group.view.id} role="group" aria-labelledby={headingId}>
              <div
                id={headingId}
                className="px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
              >
                {group.view.label}
              </div>
              {group.rows.map((option) => (
                <div key={option.id} {...optionProps(option)}>
                  <SearchRowContent data={option.row.data} tokens={tokens} density="dropdown" />
                </div>
              ))}
              {group.seeAll && (
                <div {...optionProps(group.seeAll)}>
                  <span className="flex flex-1 items-center gap-1 font-medium text-indigo-ink">
                    See all {GROUP_LABELS[group.view.id].toLowerCase()}
                    <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {model.all && (
          <div {...optionProps(model.all)} className={`${optionProps(model.all).className} mt-1 border-t border-t-slate-100`}>
            <MagnifyingGlassIcon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">See all results for “{query}”</span>
            <span aria-hidden="true" className="shrink-0 text-xs text-slate-500">
              ↵
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div aria-busy={status === "loading" || isStale}>
      {body}
    </div>
  );
};

export default SearchResultsPanel;
