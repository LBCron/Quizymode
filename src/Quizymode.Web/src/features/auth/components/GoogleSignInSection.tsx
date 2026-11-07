import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isGoogleSignInEnabled } from "@/utils/googleSignInConfig";
import type { AuthIntent } from "@/features/auth/utils/authIntent";
import { isEmbeddedWebView } from "@/features/auth/utils/inAppBrowser";

interface GoogleSignInSectionProps {
  intent: AuthIntent;
  /** Sign-up page only: shows the Terms/Privacy acknowledgement under the button. */
  showLegalHelper?: boolean;
  /** Disables the button while the password form is submitting. */
  disabled?: boolean;
  /** Reports whether the Google redirect is starting so the page can disable its own submit button. */
  onStartingChange?: (starting: boolean) => void;
  /** Called with a message to show in the page error region, or "" to clear it. */
  onError: (message: string) => void;
}

const START_FAILED_COPY =
  "We couldn't start Google sign-in. Please try again, or use your email and password.";

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

const DIVIDER = (
  <div className="relative">
    <div className="absolute inset-0 flex items-center" aria-hidden="true">
      <div className="w-full border-t border-gray-300" />
    </div>
    <div className="relative flex justify-center text-sm">
      <span className="bg-gray-50 px-2 text-gray-500">or</span>
    </div>
  </div>
);

/** Divider + "Continue with Google" (or the in-app-browser notice). Renders nothing unless Google sign-in is enabled. */
export function GoogleSignInSection(props: GoogleSignInSectionProps) {
  if (!isGoogleSignInEnabled()) {
    return null;
  }

  return <GoogleSignInSectionContent {...props} />;
}

function GoogleSignInSectionContent({
  intent,
  showLegalHelper = false,
  disabled = false,
  onStartingChange,
  onError,
}: GoogleSignInSectionProps) {
  const { signInWithGoogle } = useAuth();
  const [isStarting, setIsStarting] = useState(false);
  const refocusButton = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const embedded = isEmbeddedWebView(typeof navigator !== "undefined" ? navigator.userAgent : "");

  const setStarting = (value: boolean) => {
    setIsStarting(value);
    onStartingChange?.(value);
  };

  // Returning with the browser Back button restores the page from the bfcache with the redirecting state frozen.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setIsStarting(false);
        onStartingChange?.(false);
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [onStartingChange]);

  // Focus can only move back once the button has re-enabled after a failed start.
  useEffect(() => {
    if (refocusButton.current && !isStarting) {
      refocusButton.current = false;
      buttonRef.current?.focus();
    }
  }, [isStarting]);

  const handleClick = async () => {
    onError("");
    setStarting(true);
    try {
      await signInWithGoogle(intent);
    } catch (error) {
      console.error("Google sign-in could not be started:", error);
      refocusButton.current = true;
      setStarting(false);
      onError(START_FAILED_COPY);
    }
  };

  return (
    <div className="space-y-4">
      {DIVIDER}
      {embedded ? (
        <InAppBrowserNotice />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={handleClick}
          disabled={disabled || isStarting}
          aria-busy={isStarting || undefined}
          className="w-full min-h-[44px] inline-flex items-center justify-center gap-3 py-2 px-4 border border-gray-300 rounded-md bg-surface text-sm font-medium text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStarting ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600"
              aria-hidden="true"
            />
          ) : (
            <GoogleLogo />
          )}
          {isStarting ? "Redirecting to Google…" : "Continue with Google"}
        </button>
      )}
      <div role="status" className="sr-only">
        {isStarting ? "Redirecting to Google" : ""}
      </div>
      {showLegalHelper && !embedded && (
        <p className="text-xs text-gray-500 text-center">
          By continuing with Google you agree to the{" "}
          <Link to="/terms" className="font-medium text-indigo-ink hover:text-indigo-500">
            Terms of Service
          </Link>{" "}
          and acknowledge the{" "}
          <Link to="/privacy" className="font-medium text-indigo-ink hover:text-indigo-500">
            Privacy Policy
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function InAppBrowserNotice() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopyState("idle"), 3000);
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
      <p>Open this page in your browser to continue with Google.</p>
      <p className="mt-1 text-xs text-gray-500">
        Google doesn't allow sign-in inside this app's built-in browser. Email and password work here.
      </p>
      <div className="mt-2">
        <button
          type="button"
          onClick={handleCopy}
          className="py-2 font-medium text-indigo-ink hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 rounded-md"
        >
          Copy link
        </button>
        <span role="status" className="sr-only">
          {copyState === "copied" ? "Link copied" : ""}
        </span>
        {copyState === "copied" && (
          <span className="ml-2 text-sm text-slate-700" aria-hidden="true">
            Link copied
          </span>
        )}
      </div>
      {copyState === "failed" && (
        <p role="alert" className="text-xs text-red-700">
          Couldn't copy the link. Select the address in your browser's address bar instead.
        </p>
      )}
    </div>
  );
}
