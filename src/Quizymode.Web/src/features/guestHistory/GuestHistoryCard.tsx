import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { collectionsApi } from "@/api/collections";
import { useAuth } from "@/contexts/AuthContext";
import { useGuestHistory } from "./useGuestHistory";
import { buildGuestBrowsePath, buildGuestPracticePath, describeGuestTopic } from "./guestHistoryLinks";
import {
  GUEST_HISTORY_MAX_SUMMARIES,
  GUEST_HISTORY_RETENTION_DAYS,
  type GuestRunSummary,
} from "./guestHistoryStorage";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

const linkClass =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

function SourceActions({ summary }: { summary: GuestRunSummary }) {
  const source = summary.source;
  const collectionId = source?.kind === "collection" ? source.collectionId : null;
  // Reopen through the current API so deleted or now-private collections are never shown or bypassed.
  const collectionQuery = useQuery({
    queryKey: ["guest-history", "collection", collectionId],
    queryFn: () => collectionsApi.getById(collectionId!),
    enabled: !!collectionId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!source) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link to="/categories" className={`${linkClass} border border-on-panel/20 text-on-panel hover:bg-on-panel/10`}>
          Browse categories
        </Link>
      </div>
    );
  }

  if (source.kind === "collection" && collectionQuery.isError) {
    return (
      <div className="mt-2">
        <p className="text-xs text-amber-ink" role="status">
          That collection is no longer available.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link to="/categories" className={`${linkClass} border border-on-panel/20 text-on-panel hover:bg-on-panel/10`}>
            Browse categories
          </Link>
        </div>
      </div>
    );
  }

  const topicLabel =
    source.kind === "collection"
      ? collectionQuery.data?.name ?? "Collection"
      : describeGuestTopic(source);

  return (
    <div className="mt-1">
      <p className="text-xs text-on-panel-muted">
        <span className="font-semibold text-on-panel">{topicLabel}</span>
        {source.kind !== "collection" && (
          <span> · Practice again starts a new random set from this topic.</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link
          to={buildGuestPracticePath(source, summary.mode)}
          className={`${linkClass} bg-[linear-gradient(135deg,#38bdf8_0%,#2563eb_100%)] text-white`}
        >
          Practice again
        </Link>
        <Link
          to={buildGuestBrowsePath(source, collectionQuery.data?.name)}
          className={`${linkClass} border border-on-panel/20 text-on-panel hover:bg-on-panel/10`}
        >
          Browse topic
        </Link>
      </div>
    </div>
  );
}

/** Home-page return card for anonymous visitors with browser-local quiz history (AC 3.0.15–3.0.19). */
export function GuestHistoryCard() {
  const { isAuthenticated, isLoading } = useAuth();
  const { summaries, clear } = useGuestHistory();
  const [clearFailed, setClearFailed] = useState(false);
  const [clearedNotice, setClearedNotice] = useState(false);

  if (isAuthenticated || isLoading) return null;
  const latest = summaries[0];
  if (!latest) {
    return clearedNotice ? (
      <p role="status" className="px-2 text-xs text-on-panel-muted">
        Guest history cleared from this browser.
      </p>
    ) : null;
  }

  const missed = latest.total - latest.correct;
  const completedAt = new Date(latest.completedAt);

  return (
    <section
      aria-labelledby="guest-history-heading"
      className="rounded-[24px] border border-on-panel/10 bg-panel-deep/70 p-2 shadow-xl shadow-slate-950/25 sm:p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id="guest-history-heading"
            className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-ink"
          >
            Your last quiz
          </h2>
          <p className="mt-1 text-sm font-semibold text-on-panel">
            {latest.correct} / {latest.total} correct
            <span className="font-normal text-on-panel-muted">
              {" "}
              · {missed === 0 ? "no misses" : `${missed} missed`} ·{" "}
              <time dateTime={latest.completedAt}>{dateFormatter.format(completedAt)}</time>
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const cleared = clear();
            setClearFailed(!cleared);
            setClearedNotice(cleared);
          }}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-on-panel-muted underline-offset-2 hover:text-on-panel hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
        >
          Clear guest history
        </button>
      </div>
      <SourceActions summary={latest} />
      <p className="mt-2 text-[11px] leading-4 text-slate-400">
        Saved in this browser only — not in an account or on other devices. Keeps your last{" "}
        {GUEST_HISTORY_MAX_SUMMARIES} results for up to {GUEST_HISTORY_RETENTION_DAYS} days; clearing browser data
        removes it.
      </p>
      {clearFailed && (
        <p className="mt-1 text-xs text-amber-ink" role="alert">
          Guest history could not be cleared in this browser. Try clearing site data in your browser settings.
        </p>
      )}
    </section>
  );
}
