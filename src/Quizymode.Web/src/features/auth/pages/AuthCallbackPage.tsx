import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";
import { useAuth } from "@/contexts/AuthContext";
import { SEO } from "@/components/SEO";
import {
  LOGIN_PATH,
  SIGNUP_PATH,
  buildAuthIntentQuery,
  type AuthIntent,
} from "@/features/auth/utils/authIntent";
import { trackSignInCompleted } from "@/features/auth/utils/authAnalytics";
import {
  GOOGLE_AUTH_ERROR_COPY,
  QM_ACCOUNT_LINKED,
  hasSentinel,
  mapGoogleFailure,
  type GoogleAuthErrorCode,
} from "@/features/auth/utils/googleAuthErrors";
import {
  clearGoogleLinkRetry,
  clearStoredGoogleIntent,
  hasGoogleLinkRetried,
  parseIntentJson,
  readStoredGoogleIntent,
} from "@/features/auth/utils/googleSignIn";
import {
  clearOAuthOutcome,
  getInitialOAuthParams,
  getOAuthOutcome,
  subscribeOAuthOutcome,
  type OAuthOutcome,
} from "@/features/auth/utils/oauthOutcome";

const SLOW_HINT_MS = 10_000;
const NO_OUTCOME_TIMEOUT_MS = 20_000;
// Amplify may still report the failure (for example a late QM_ACCOUNT_LINKED) after the URL already shows an error.
const URL_ERROR_GRACE_MS = 800;
const DEFAULT_INTENT: AuthIntent = { returnTo: "/", reason: null };

function resolveIntent(customState: string | null): AuthIntent {
  return parseIntentJson(customState) ?? readStoredGoogleIntent() ?? DEFAULT_INTENT;
}

/**
 * Landing page for the Cognito hosted-UI redirect (AUTH-003, #118). Amplify exchanges the code on load and reports the
 * result through the Hub; oauthOutcome.ts captured it at module scope so nothing is lost before this page renders.
 * The raw Cognito error text is matched against known sentinels but never rendered.
 */
const AuthCallbackPage = () => {
  const navigate = useNavigate();
  const { refreshAuth, signInWithGoogle } = useAuth();
  const outcome = useSyncExternalStore(subscribeOAuthOutcome, getOAuthOutcome);
  const [errorCode, setErrorCode] = useState<GoogleAuthErrorCode | null>(null);
  const [errorIntent, setErrorIntent] = useState<AuthIntent>(DEFAULT_INTENT);
  const [slow, setSlow] = useState(false);
  const handledOutcome = useRef<OAuthOutcome | null>(null);
  const finished = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const customState = outcome.customState;
  const intent = useMemo(() => resolveIntent(customState), [customState]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [errorCode]);

  useEffect(() => {
    if (errorCode) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [errorCode]);

  useEffect(() => {
    if (finished.current || handledOutcome.current === outcome) return;

    const fail = (code: GoogleAuthErrorCode) => {
      finished.current = true;
      setErrorIntent(intent);
      setErrorCode(code);
    };

    const complete = async () => {
      const established = await refreshAuth();
      if (!established) {
        fail("generic");
        return;
      }
      finished.current = true;
      clearGoogleLinkRetry();
      clearStoredGoogleIntent();
      trackSignInCompleted(intent);
      navigate(intent.returnTo, { replace: true });
      clearOAuthOutcome();
    };

    if (outcome.status === "success") {
      handledOutcome.current = outcome;
      void complete().catch(() => fail("generic"));
      return;
    }

    if (outcome.status === "failure") {
      handledOutcome.current = outcome;
      if (hasSentinel(outcome.message, QM_ACCOUNT_LINKED)) {
        if (hasGoogleLinkRetried()) {
          fail("linked-retry-failed");
          return;
        }
        // The Pre sign-up Lambda linked the Google identity to the existing account and aborted this attempt on
        // purpose. Retry exactly once; the marker is set before redirecting, so a second link error cannot loop.
        void signInWithGoogle(intent, { isRetry: true }).catch(() => fail("generic"));
        return;
      }
      fail(mapGoogleFailure(outcome.message));
      return;
    }

    // No event yet. If the code exchange is in flight, wait for the Hub; otherwise decide from what the URL and
    // storage already show so the user is never left on an endless spinner.
    const initial = getInitialOAuthParams();
    if (initial.hasCode) {
      const timer = window.setTimeout(() => {
        if (!finished.current) fail("generic");
      }, NO_OUTCOME_TIMEOUT_MS);
      return () => window.clearTimeout(timer);
    }

    if (initial.error) {
      const timer = window.setTimeout(() => {
        if (!finished.current) {
          fail(mapGoogleFailure(`${initial.error} ${initial.errorDescription ?? ""}`));
        }
      }, URL_ERROR_GRACE_MS);
      return () => window.clearTimeout(timer);
    }

    handledOutcome.current = outcome;

    void fetchAuthSession()
      .then((session) => (session.tokens?.accessToken ? complete() : fail("generic")))
      .catch(() => fail("generic"));
  }, [outcome, intent, navigate, refreshAuth, signInWithGoogle]);

  if (errorCode) {
    const query = buildAuthIntentQuery(errorIntent);
    return (
      <>
        <SEO title="Signing in" noindex />
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-md w-full space-y-6 text-center">
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900">
              {errorCode === "cancelled" ? "Sign-in cancelled" : "We couldn't sign you in"}
            </h2>
            <div id="auth-callback-error" role="alert" className="rounded-md bg-red-50 p-4 text-left">
              <div className="text-sm text-red-800">{GOOGLE_AUTH_ERROR_COPY[errorCode]}</div>
            </div>
            <Link
              to={`${LOGIN_PATH}${query}`}
              className="inline-flex justify-center w-full py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Back to sign in
            </Link>
            <Link
              to={`${SIGNUP_PATH}${query}`}
              className="block text-sm font-medium text-indigo-ink hover:text-indigo-500"
            >
              Use a different email to sign up
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SEO title="Signing in" noindex />
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-6 text-center">
          <div
            className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600"
            aria-hidden="true"
          />
          <div role="status" aria-live="polite" className="space-y-2">
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-gray-900">
              Signing you in…
            </h2>
            <p className="text-sm text-gray-600">Hang tight, this only takes a moment.</p>
            {slow && (
              <>
                <p className="text-sm text-gray-600">Still working… If nothing happens, go back to sign in.</p>
                <Link
                  to={`${LOGIN_PATH}${buildAuthIntentQuery(intent)}`}
                  className="text-sm font-medium text-indigo-ink hover:text-indigo-500"
                >
                  Back to sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default AuthCallbackPage;
