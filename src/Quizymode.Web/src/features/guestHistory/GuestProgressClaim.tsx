import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { INTERESTS_QUERY_KEY } from "@/features/interests/useInterests";
import { claimLocalInterests } from "@/features/learningLoop/claimLocalInterests";
import { claimLocalStudyPlans } from "@/features/studyPlans/claimLocalStudyPlans";
import { claimGuestProgress, type ClaimGuestProgressResult } from "./claimGuestProgress";

/**
 * Confirms (or reports failure of) moving browser-local guest results into the account right after sign-in.
 * Import is automatic, runs once per page session, and renders nothing when there is nothing to claim.
 */
export function GuestProgressClaim() {
  const { isAuthenticated, isLoading, userId } = useAuth();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<ClaimGuestProgressResult>({ status: "none" });
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const run = useCallback(async () => {
    setBusy(true);
    const outcome = await claimGuestProgress();
    setResult(outcome);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isLoading || started.current) return;
    started.current = true;
    // Topic interests picked while anonymous (#116) merge silently in the same once-per-session pass.
    // The merged list is seeded into the cache before the local copy clears, then refetched, so Home never flashes empty.
    // In-flight topic reads are cancelled first so a stale response cannot overwrite the seeded merged list.
    void queryClient
      .cancelQueries({ queryKey: INTERESTS_QUERY_KEY(userId) })
      .then(() => claimLocalInterests((merged) => queryClient.setQueryData(INTERESTS_QUERY_KEY(userId), merged)))
      .then((claimed) => {
        if (claimed) void queryClient.invalidateQueries({ queryKey: ["interests"] });
      })
      // A failed topic claim keeps the local copy for the next page session; it must not surface as an unhandled rejection.
      .catch(() => undefined);
    // Test-date plans made while anonymous (#364) are claimed in their own chain; plans refetch once both claims settle
    // (guest runs imported by run() count towards a plan's activity).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.allSettled([run(), claimLocalStudyPlans()]).then(() =>
      queryClient.invalidateQueries({ queryKey: ["study-plans"] }),
    );
  }, [isAuthenticated, isLoading, run, queryClient, userId]);

  if (!isAuthenticated || result.status === "none") return null;

  if (result.status === "saved") {
    return (
      <div role="status" className="mx-auto mt-3 max-w-3xl rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-ink">
        Saved {result.saved} quiz {result.saved === 1 ? "result" : "results"} from this browser to your account.
        They are marked as imported and unverified.
        {result.skipped > 0 ? ` ${result.skipped} could not be saved and were discarded.` : ""}
        <button type="button" className="ml-3 underline" onClick={() => setResult({ status: "none" })}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className="mx-auto mt-3 max-w-3xl rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-ink">
      We could not save your {result.pending} earlier quiz {result.pending === 1 ? "result" : "results"} yet. They are still in
      this browser.
      <button type="button" className="ml-3 underline disabled:opacity-60" disabled={busy} onClick={() => void run()}>
        {busy ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
}
