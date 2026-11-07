import { useEffect, useRef, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usersApi, type PolicyStatusResponse } from "@/api/users";

// The legal pages must stay readable, and /auth/callback is a transient redirect landing that forwards to the page the
// prompt should appear on.
const LEGAL_PATHS = new Set(["/privacy", "/privacy-policy", "/terms", "/terms-of-service", "/auth/callback"]);

const POLICY_LABELS: Record<string, string> = {
  TermsOfService: "Terms of Service",
  PrivacyPolicy: "Privacy Policy",
};

const policyAcceptanceStatusQueryKey = (userId: string | null) => ["policyAcceptanceStatus", userId] as const;

/**
 * Blocking consent prompt for signed-in users who have not accepted the current Terms of Service or Privacy Policy
 * (#222). Runs after the signup acceptance sync settles so a new account is never asked twice, stays out of the way
 * on the legal pages so they can be read, and closes only after the API has recorded the acceptance.
 */
export function PolicyAcceptancePrompt() {
  const { isAuthenticated, isLoading, userId, policyAcceptancesSynced, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const statusQuery = useQuery({
    queryKey: policyAcceptanceStatusQueryKey(userId),
    queryFn: usersApi.getPolicyAcceptanceStatus,
    enabled: isAuthenticated && !isLoading && policyAcceptancesSynced,
    staleTime: Infinity,
  });

  const acceptMutation = useMutation({
    mutationFn: (policies: PolicyStatusResponse[]) => {
      const acceptedAtUtc = new Date().toISOString();
      return usersApi.recordPolicyAcceptances({
        acceptances: policies.map((policy) => ({
          policyType: policy.policyType,
          policyVersion: policy.currentVersion,
          acceptedAtUtc,
        })),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: policyAcceptanceStatusQueryKey(userId) }),
  });

  const status = statusQuery.data;
  const isOpen =
    isAuthenticated && policyAcceptancesSynced && status?.needsAcceptance === true && !LEGAL_PATHS.has(location.pathname);

  useEffect(() => {
    if (!isOpen) return;
    headingRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen || !status) return null;

  const pending = status.policies.filter((policy) => policy.needsAcceptance);
  const neverAccepted = status.policies.every((policy) => policy.acceptedVersion === null);
  const busy = acceptMutation.isPending || (acceptMutation.isSuccess && statusQuery.isFetching);

  // Keep Tab inside the dialog: the page behind it is not usable until the policies are accepted.
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-panel-deep/80 px-4 py-10 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-acceptance-title"
        aria-describedby="policy-acceptance-description"
        onKeyDown={trapFocus}
        className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-surface p-6 text-slate-700 shadow-2xl"
      >
        <h2
          id="policy-acceptance-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-slate-900 focus:outline-none"
        >
          {neverAccepted
            ? "Please accept our Terms and Privacy Policy"
            : "We've updated our Terms and Privacy Policy"}
        </h2>
        <p id="policy-acceptance-description" className="mt-3 text-sm">
          To keep using your account, review and accept the current versions. You can read them first; this prompt
          comes back when you return.
        </p>
        <ul className="mt-4 space-y-1 text-sm">
          {pending.map((policy) => (
            <li key={policy.policyType}>
              <span className="font-medium text-slate-900">{POLICY_LABELS[policy.policyType] ?? policy.policyType}</span>
              {policy.acceptedVersion
                ? ` updated ${policy.currentVersion} (you accepted ${policy.acceptedVersion})`
                : ` (version ${policy.currentVersion})`}
            </li>
          ))}
        </ul>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link to="/terms" className="font-medium text-sky-700 underline">
            Terms of Service
          </Link>
          <Link to="/privacy" className="font-medium text-sky-700 underline">
            Privacy Policy
          </Link>
        </p>
        {acceptMutation.isError ? (
          <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            We couldn't record your acceptance. Check your connection and try again.
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={busy}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => acceptMutation.mutate(pending)}
            disabled={busy}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {busy ? "Saving..." : acceptMutation.isError ? "Try again" : "Accept and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
