/**
 * Topic picker shared by create item, edit item, bulk create, notes upload, import and the legacy study guide import.
 * One labelled group with three states (AC 12.13):
 *   A (nothing chosen): suggested chips (when `suggestionText` is given), the searchable picker, a collapsed
 *     "Browse all topics" disclosure with the three cascading selects;
 *   P (partial or legacy value, e.g. only ?category=): no chips, picker visible, Browse open with the warnings;
 *   B (a full valid path): one removable breadcrumb pill. The selects stay mounted inside the closed, hidden
 *     disclosure so their ids and labels still resolve.
 * Nothing is ever chosen for the user: a suggestion only applies when it is clicked.
 */
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { TopicSuggestion } from "@/api/taxonomy";
import SuggestedTopicChips from "@/features/topics/SuggestedTopicChips";
import TopicBreadcrumb from "@/features/topics/TopicBreadcrumb";
import TopicPathCombobox from "@/features/topics/TopicPathCombobox";
import { buildTopicPaths, type TopicPath } from "@/features/topics/topicPaths";
import { useTaxonomy } from "@/features/topics/useTaxonomy";
import { useTopicSuggestions } from "@/features/topics/useTopicSuggestions";
import { isTopicComplete, type TopicScopePatch } from "@/features/topics/topicScope";
import { validateNavigationKeywordName } from "@/utils/navigationKeywordRules";

export interface TopicScopeFieldsHandle {
  /** Moves focus to the picker input (or the remove button once a topic is chosen). */
  focus: () => void;
}

export interface ItemTopicScopeFieldsProps {
  /** Prefix for input ids (e.g. item-form, bulk-topic-scope). */
  idPrefix: string;
  category: string;
  rank1: string;
  rank2: string;
  onScopeChange: (patch: TopicScopePatch) => void;
  disabled?: boolean;
  /** Text to suggest topics for. Omit it for forms without suggestions (edit, bulk, legacy import). */
  suggestionText?: string;
  /** A line under the chips, for example for file types that cannot be read in the browser. */
  suggestionHelperText?: string;
  /** Called when a set of chips has been shown (first shown, and each new set). */
  onSuggestionsShown?: (suggestions: TopicSuggestion[]) => void;
  /** A validation message from the parent; sets aria-invalid and aria-describedby. */
  error?: string;
  ref?: Ref<TopicScopeFieldsHandle>;
}

type ScopeState = "A" | "P" | "B";

function matchIgnoreCase(options: string[], value: string): string | undefined {
  const wanted = value.trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted);
}

const SELECT_CLASS = "w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-surface text-gray-900";

export function ItemTopicScopeFields({
  idPrefix,
  category,
  rank1,
  rank2,
  onScopeChange,
  disabled = false,
  suggestionText,
  suggestionHelperText,
  onSuggestionsShown,
  error,
  ref,
}: ItemTopicScopeFieldsProps) {
  const { data: taxonomy, isLoading: isTaxonomyLoading, isError: isTaxonomyError } = useTaxonomy();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const removeRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocus = useRef<"pill" | "input" | null>(null);
  const errorId = useId();

  const categories = useMemo(() => taxonomy?.categories.map((c) => c.slug) ?? [], [taxonomy]);
  const categoryCanonical = matchIgnoreCase(categories, category);
  const categoryNode = taxonomy?.categories.find((c) => c.slug === categoryCanonical);
  const rank1Options = useMemo(() => categoryNode?.groups.map((g) => g.slug) ?? [], [categoryNode]);
  const rank1Canonical = matchIgnoreCase(rank1Options, rank1);
  const rank2Options = useMemo(
    () => categoryNode?.groups.find((g) => g.slug === rank1Canonical)?.keywords.map((k) => k.slug) ?? [],
    [categoryNode, rank1Canonical]
  );
  const rank2Canonical = matchIgnoreCase(rank2Options, rank2);

  const isLoadingRank1 = isTaxonomyLoading && !!category.trim();
  const isLoadingRank2 = isTaxonomyLoading && !!rank1.trim();

  const nothingChosen = !category.trim() && !rank1.trim() && !rank2.trim();
  const validPath = !!categoryCanonical && !!rank1Canonical && !!rank2Canonical;
  // While the taxonomy loads, a complete stored path (edit) is shown as the pill instead of flashing the legacy view.
  const completeWhileLoading = isTaxonomyLoading && isTopicComplete({ category, rank1, rank2 });
  const state: ScopeState = nothingChosen ? "A" : validPath || completeWhileLoading ? "B" : "P";

  const pillParts = validPath
    ? [categoryCanonical, rank1Canonical, rank2Canonical]
    : [category.trim(), rank1.trim(), rank2.trim()];

  const chipsEnabled = suggestionText !== undefined && state === "A";
  const { suggestions, phase, isRefreshing } = useTopicSuggestions({
    text: suggestionText ?? "",
    enabled: chipsEnabled,
  });

  const topicPaths = useMemo(() => buildTopicPaths(taxonomy), [taxonomy]);

  const shownKey = phase === "ready" && !isRefreshing ? suggestions.map((s) => s.path).join("|") : "";
  useEffect(() => {
    if (!shownKey) return;
    onSuggestionsShown?.(suggestions);
    const count = suggestions.length;
    setAnnouncement(`${count} topic ${count === 1 ? "suggestion" : "suggestions"} available.`);
    // The chips are identified by their paths; the callback and array identity are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  // Focus moves deliberately after a pick or a removal, because the control that held focus is unmounted.
  useEffect(() => {
    if (pendingFocus.current === "pill" && state === "B" && removeRef.current) {
      removeRef.current.focus();
      pendingFocus.current = null;
    } else if (pendingFocus.current === "input" && state !== "B" && inputRef.current) {
      inputRef.current.focus();
      pendingFocus.current = null;
    }
  });

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (state === "B") removeRef.current?.focus();
      else inputRef.current?.focus();
    },
  }));

  const choose = (next: { category: string; l1: string; l2: string }) => {
    pendingFocus.current = "pill";
    setAnnouncement(`Selected topic ${next.category}, ${next.l1}, ${next.l2}.`);
    onScopeChange({ category: next.category, rank1: next.l1, rank2: next.l2 });
  };

  const onChipPick = (suggestion: TopicSuggestion) =>
    choose({ category: suggestion.categorySlug, l1: suggestion.l1, l2: suggestion.l2 });

  const onPathPick = (path: TopicPath) => choose({ category: path.category, l1: path.l1, l2: path.l2 });

  const removeTopic = () => {
    pendingFocus.current = "input";
    setBrowseOpen(false);
    setAnnouncement("Topic removed.");
    onScopeChange({ category: "", rank1: "", rank2: "" });
  };

  const rank1SelectValue = rank1Canonical ?? "";
  const rank2SelectValue = rank2Canonical ?? "";
  const rank1Error = validateNavigationKeywordName(rank1);
  const rank2Error = validateNavigationKeywordName(rank2);

  return (
    <fieldset
      data-testid="topic-scope"
      className="m-0 min-w-0 space-y-3 border-0 p-0"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-2 block text-sm font-medium text-gray-700">Topic *</legend>

      {state === "B" && (
        <div
          data-testid="topic-pill"
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-3 pr-1 text-sm font-medium text-indigo-ink"
        >
          <span className="min-w-0 break-words">
            <TopicBreadcrumb parts={pillParts} />
          </span>
          <button
            ref={removeRef}
            type="button"
            disabled={disabled}
            onClick={removeTopic}
            aria-label={`Remove topic ${pillParts.join(", ")}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-indigo-ink hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:h-7 sm:w-7"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {state === "A" && suggestionText !== undefined && (
        <SuggestedTopicChips
          suggestions={suggestions}
          phase={phase}
          isRefreshing={isRefreshing}
          onPick={onChipPick}
          helperText={suggestionHelperText}
        />
      )}

      {state !== "B" && (
        <TopicPathCombobox
          idPrefix={idPrefix}
          paths={topicPaths}
          isLoading={isTaxonomyLoading}
          isError={isTaxonomyError}
          disabled={disabled}
          invalid={!!error}
          inputRef={inputRef}
          onPick={onPathPick}
          onOpenBrowse={() => setBrowseOpen(true)}
          onAnnounce={setAnnouncement}
        />
      )}

      <details
        open={browseOpen || state === "P"}
        hidden={state === "B"}
        onToggle={(event) => setBrowseOpen(event.currentTarget.open)}
        className="rounded-md border border-gray-200 bg-surface"
      >
        <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-medium text-indigo-ink hover:text-indigo-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:min-h-0">
          Browse all topics
        </summary>
        <div className="space-y-4 border-t border-gray-200 p-3">
          <div>
            <label htmlFor={`${idPrefix}-category`} className="block text-sm font-medium text-gray-700 mb-2">
              Category *
            </label>
            <select
              id={`${idPrefix}-category`}
              value={categoryCanonical ?? ""}
              onChange={(e) => onScopeChange({ category: e.target.value, rank1: "", rank2: "" })}
              disabled={disabled}
              className={SELECT_CLASS}
            >
              <option value="">Select a category</option>
              {categories.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
            {category.trim() && !categoryCanonical && !isTaxonomyLoading && (
              <p className="mt-1 text-xs text-amber-700">
                Current category is not in the taxonomy. Choose a valid category.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${idPrefix}-rank1`} className="block text-sm font-medium text-gray-700 mb-2">
              Primary topic (rank 1) *
            </label>
            <select
              id={`${idPrefix}-rank1`}
              value={rank1SelectValue}
              onChange={(e) => onScopeChange({ rank1: e.target.value, rank2: "" })}
              disabled={disabled || !category || isLoadingRank1}
              className={SELECT_CLASS}
            >
              <option value="">{isLoadingRank1 ? "Loading…" : "— Select primary topic —"}</option>
              {rank1Options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {rank1.trim() && !rank1Canonical && !isLoadingRank1 && (
              <p className="mt-1 text-xs text-amber-700">
                Current value is not in the taxonomy list for this category. Choose a valid primary topic.
              </p>
            )}
            {rank1Error && rank1Canonical && <p className="mt-1 text-xs text-red-600">{rank1Error}</p>}
          </div>

          <div>
            <label htmlFor={`${idPrefix}-rank2`} className="block text-sm font-medium text-gray-700 mb-2">
              Subtopic (rank 2) *
            </label>
            <select
              id={`${idPrefix}-rank2`}
              value={rank2SelectValue}
              onChange={(e) => {
                if (e.target.value && rank1Canonical && categoryCanonical) {
                  choose({ category: categoryCanonical, l1: rank1Canonical, l2: e.target.value });
                } else {
                  onScopeChange({ rank2: e.target.value });
                }
              }}
              disabled={disabled || !rank1.trim() || isLoadingRank2}
              className={SELECT_CLASS}
            >
              <option value="">{isLoadingRank2 ? "Loading…" : "— Select subtopic —"}</option>
              {rank2Options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {rank2.trim() && !rank2Canonical && !isLoadingRank2 && rank1Canonical && (
              <p className="mt-1 text-xs text-amber-700">
                Current value is not valid under this primary topic. Choose a valid subtopic.
              </p>
            )}
            {rank2Error && rank2Canonical && <p className="mt-1 text-xs text-red-600">{rank2Error}</p>}
          </div>
        </div>
      </details>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </fieldset>
  );
}
