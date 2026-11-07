import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LOGIN_PATH, buildAuthIntentQuery, type AuthReason } from "../utils/authIntent";
import {
  SIGNUP_PROMPT_COPY,
  buildSignupPromptHref,
  dismissSignupPrompt,
  isSignupPromptDismissed,
  trackSignupPromptClicked,
  trackSignupPromptViewed,
} from "../utils/signupPrompt";

interface SignupPromptProps {
  reason: AuthReason;
  /** Where to come back to after signup; defaults to the current page. Validated as same-origin. */
  returnTo?: string;
  className?: string;
}

/**
 * A small, dismissible, inline signup prompt tied to the visitor's current action (CONV-001,
 * AC 4.2.10). It never blocks the page, is hidden for signed-in users (and while auth is still
 * resolving), and stays hidden for the tab session once dismissed.
 */
export function SignupPrompt({ reason, returnTo, className }: SignupPromptProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const headingId = useId();
  const [dismissed, setDismissed] = useState(() => isSignupPromptDismissed(reason));
  const visible = !isAuthenticated && !isLoading && !dismissed;

  useEffect(() => {
    if (visible) trackSignupPromptViewed(reason);
  }, [visible, reason]);

  if (!visible) return null;

  const copy = SIGNUP_PROMPT_COPY[reason];
  const destination = returnTo ?? `${location.pathname}${location.search}${location.hash}`;
  const signupHref = buildSignupPromptHref(reason, destination);
  const loginHref = `${LOGIN_PATH}${buildAuthIntentQuery({ reason, returnTo: destination })}`;

  return (
    <aside
      aria-labelledby={headingId}
      data-testid="signup-prompt"
      data-reason={reason}
      className={`rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-left ${className ?? ""}`}
    >
      <h3 id={headingId} className="text-base font-semibold text-gray-900">
        {copy.heading}
      </h3>
      <p className="mt-1 text-sm text-gray-700">{copy.body}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Link
          to={signupHref}
          onClick={() => trackSignupPromptClicked(reason)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {copy.cta}
        </Link>
        <button
          type="button"
          onClick={() => {
            dismissSignupPrompt(reason);
            setDismissed(true);
          }}
          className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Not now
        </button>
        <span className="text-sm text-gray-600 sm:ml-auto">
          Have an account?{" "}
          <Link
            to={loginHref}
            className="font-medium text-indigo-ink underline hover:text-indigo-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Sign in
          </Link>
        </span>
      </div>
    </aside>
  );
}
