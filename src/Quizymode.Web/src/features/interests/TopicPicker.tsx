import { useEffect, useRef, useState } from "react";
import { homeCategoryCards } from "@/features/home/homePageData";
import { MAX_INTERESTS } from "@/features/learningLoop/localLearningState";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { InterestsStatus } from "./useInterests";
import { topicLabel, topicsOverlap } from "./topicPaths";
import { TopicRefinements } from "./TopicRefinements";

/** Layout marks its profile/menu triggers with this attribute so focus has a home when the opener is gone. */
export const TOPIC_RETURN_FOCUS_ATTRIBUTE = "data-topic-return-focus";

interface TopicPickerProps {
  initial: string[];
  status: InterestsStatus;
  saving: boolean;
  error: boolean;
  onSave: (categories: string[]) => void;
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}

/** The My topics dialog (#382): up to 10 topics, shared by Home, the Games hub and the profile. */
export function TopicPicker({ initial, status, saving, error, onSave, retrying, onRetry, onClose }: TopicPickerProps) {
  // null until the saved topics have loaded; then prefilled once with them.
  const [selected, setSelected] = useState<string[] | null>(status === "ready" ? initial : null);
  if (selected === null && status === "ready") setSelected(initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const full = (selected?.length ?? 0) >= MAX_INTERESTS;
  useFocusTrap(dialogRef);

  // The parent passes a new onClose each render; keep the mount-only effect below from re-running (and moving focus).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input:not([disabled]),button:not([disabled])")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // The opener can be gone (the profile dialog closes first); fall back to the nav trigger, never the page body.
      if (previous && previous !== document.body && previous.isConnected) {
        previous.focus();
        return;
      }
      for (const trigger of document.querySelectorAll<HTMLElement>(`[${TOPIC_RETURN_FOCUS_ATTRIBUTE}]`)) {
        trigger.focus();
        if (document.activeElement === trigger) break;
      }
    };
  }, []);

  // When the chips replace the loading or error state, move focus to the first chip.
  const chipsShown = selected !== null;
  const chipsWereShown = useRef(chipsShown);
  useEffect(() => {
    if (chipsShown && !chipsWereShown.current) dialogRef.current?.querySelector<HTMLElement>("fieldset input:not([disabled])")?.focus();
    chipsWereShown.current = chipsShown;
  }, [chipsShown]);

  const toggle = (slug: string) =>
    setSelected((current) =>
      current === null ? current : current.includes(slug) ? current.filter((s) => s !== slug) : [...current.filter(path => !topicsOverlap(path, slug)), slug],
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="topic-picker-title"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-panel p-4 text-on-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="topic-picker-title" className="text-lg font-semibold">My topics</h2>
          {selected !== null && (
            <span aria-live="polite" aria-atomic="true" className="text-xs font-semibold text-on-panel-muted">
              {selected.length} of {MAX_INTERESTS}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-on-panel-muted">Pick up to {MAX_INTERESTS}. Your picks come first on Home.</p>
        {selected === null && status === "loading" && (
          <div role="status" className="mt-3 flex flex-wrap gap-2">
            <span className="sr-only">Loading your topics…</span>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} aria-hidden="true" className="h-11 w-24 animate-pulse rounded-full bg-on-panel/10" />
            ))}
          </div>
        )}
        {selected === null && status === "error" && (
          <div role="alert" className="mt-3 text-xs text-red-ink">
            Your topics could not be loaded.{" "}
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="min-h-[44px] px-2 font-semibold underline disabled:opacity-60"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
        {selected !== null && (
          <fieldset className="mt-3 flex flex-wrap gap-2">
            <legend className="sr-only">Topics</legend>
            {homeCategoryCards.map((card) => {
              const checked = selected.includes(card.slug);
              const blocked = !checked && full && !selected.some(path => topicsOverlap(path, card.slug));
              return (
                <label
                  key={card.slug}
                  className={`inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-200 ${
                    checked ? "border-sky-300 bg-sky-500/30" : "border-on-panel/20 bg-on-panel/5"
                  } ${blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggle(card.slug)}
                  />
                  {checked && <span aria-hidden="true">✓ </span>}
                  {card.name}
                </label>
              );
            })}
          </fieldset>
        )}
        {selected !== null && (
          <>
            {selected.filter(path => path.includes("/") || !homeCategoryCards.some(card => card.slug === path)).map(path => (
              <button key={path} type="button" aria-label={`Remove ${topicLabel(path)}`} onClick={() => setSelected(current => current?.filter(value => value !== path) ?? null)} className="mt-2 min-h-[44px] rounded-full border border-sky-300 bg-sky-500/30 px-4 py-2 text-sm font-semibold">
                {topicLabel(path)} ×
              </button>
            ))}
            <TopicRefinements selected={selected} onAdd={path => setSelected(current => current === null ? current : [...current.filter(value => !topicsOverlap(value, path)), path])} />
          </>
        )}
        <p aria-live="polite" className="mt-2 text-xs text-on-panel-muted empty:hidden">
          {full ? `That's ${MAX_INTERESTS}, the most you can pick. Remove one to add another.` : ""}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-xs text-red-ink">Your topics could not be saved. Try again.</p>
        )}
        <div className="mt-4 flex gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 rounded-full border border-on-panel/20 px-4 py-2 text-sm font-semibold hover:bg-on-panel/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (selected !== null) onSave(selected);
            }}
            disabled={saving || selected === null}
            className="min-h-[44px] flex-1 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-[#020617] hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 disabled:opacity-60 sm:flex-none"
          >
            {saving ? "Saving…" : "Save topics"}
          </button>
        </div>
      </div>
    </div>
  );
}
