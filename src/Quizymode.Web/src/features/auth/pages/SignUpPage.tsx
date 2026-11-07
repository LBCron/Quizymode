import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usersApi } from "@/api/users";
import { queueSignUpPolicyAcceptances } from "@/features/legal/policyAcceptanceStorage";
import { SEO } from "@/components/SEO";
import {
  LOGIN_PATH,
  buildAuthIntentQuery,
  parseAuthIntent,
  type AuthReason,
} from "@/features/auth/utils/authIntent";
import {
  clearSignupRecovery,
  readSignupRecovery,
  saveSignupRecovery,
} from "@/features/auth/utils/signupRecovery";
import {
  trackSignInCompleted,
  trackSignupConfirmationShown,
  trackSignupConfirmed,
  trackSignupFormStarted,
  trackSignupSubmitted,
} from "@/features/auth/utils/authAnalytics";
import { GoogleSignInSection } from "@/features/auth/components/GoogleSignInSection";
import { QM_USE_GOOGLE, hasSentinel } from "@/features/auth/utils/googleAuthErrors";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";

const RESEND_COOLDOWN_MS = 60_000;

interface BenefitCopy {
  heading: string;
  body: string;
}

// Maps only #110's allowlisted reasons. Before PROGRESS-001 (#114) and
// CLAIM-003 (#115) ship, save-progress copy must not claim a result is
// saved, kept, synced or imported anywhere -- it says scores are not saved to
// accounts yet and offers the account benefits that actually exist today.
const BENEFIT_COPY: Record<AuthReason, BenefitCopy> = {
  "keep-collection": {
    heading: "Make your next study session yours.",
    body: "Create a free account to bookmark this collection for later and build private practice sets.",
  },
  "create-content": {
    heading: "Make your next study session yours.",
    body: "Create a free account to create private items and collections, and turn your notes into quizzes.",
  },
  "join-discussion": {
    heading: "Make your next study session yours.",
    body: "Create a free account to join the discussion where it's available.",
  },
  "save-progress": {
    heading: "Make your next quiz yours",
    body: "Quiz scores are not saved to accounts yet. Create a free account to bookmark public collections and build private practice sets.",
  },
  "review-later": {
    heading: "Keep reviewing these cards",
    body: "Create a free account to add cards you're still learning to a Review queue that brings them back over the next days.",
  },
  "track-progress": {
    heading: "Track your progress across visits",
    body: "Create a free account to save your quiz runs, see your study streak and keep an activity calendar that is not tied to this browser.",
  },
};

const DEFAULT_BENEFIT: BenefitCopy = {
  heading: "Make your next study session yours.",
  body: "Create a free account to bookmark public collections and build private practice sets.",
};

type FieldId = "username" | "email" | "password" | "legal" | "code";
const FIELD_DOM_ID: Record<FieldId, string> = {
  username: "username",
  email: "email",
  password: "password",
  legal: "legal",
  code: "code",
};
const ERROR_ID = "signup-error";

function describeConfirmError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "CodeMismatchException") {
      return "That code doesn't match. Check it and try again, or resend a new code.";
    }
    if (err.name === "ExpiredCodeException") {
      return "That code has expired. Resend a new code to continue.";
    }
    return err.message;
  }
  return "Confirmation failed. Please try again.";
}

const SignUpPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    signup,
    confirmSignup,
    resendConfirmationCode,
    isAuthenticated,
    isLoading: authLoading,
  } = useAuth();
  const intent = parseAuthIntent(location.search);
  const benefit = intent.reason ? BENEFIT_COPY[intent.reason] : DEFAULT_BENEFIT;
  const loginHref = `${LOGIN_PATH}${buildAuthIntentQuery(intent)}`;

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [hasAcceptedLegal, setHasAcceptedLegal] = useState(false);
  const [error, setError] = useState("");
  const [errorFields, setErrorFields] = useState<FieldId[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleStarting, setIsGoogleStarting] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [autoSignInFailed, setAutoSignInFailed] = useState(false);
  const [resendCooldownUntil, setResendCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Restore the confirmation step after a reload. Only ever reads email and
  // cooldown timing -- never a password or verification code.
  useEffect(() => {
    const recovery = readSignupRecovery();
    if (recovery) {
      setEmail(recovery.email);
      setNeedsConfirmation(true);
      setResendCooldownUntil(recovery.cooldownUntil);
    }
  }, []);

  useEffect(() => {
    if (!resendCooldownUntil) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [resendCooldownUntil]);

  const cooldownRemainingSeconds = resendCooldownUntil
    ? Math.max(0, Math.ceil((resendCooldownUntil - now) / 1000))
    : 0;

  // Already-authenticated visitors follow the same validated-destination
  // rule as LoginPage (#110), once initial auth loading has settled. This
  // also prevents a confusing identity mix-up: without it, signing up for a
  // second account in a tab where account A is still logged in could leave
  // confirmSignup verifying A's still-valid session instead of B's.
  if (!authLoading && isAuthenticated) {
    return <Navigate to={intent.returnTo} replace />;
  }

  const clearError = () => {
    setError("");
    setErrorFields([]);
  };

  // Shows an error in the alert region, marks the offending field(s) invalid and, when a field is
  // known, moves focus to it so keyboard and screen-reader users land on what to fix.
  const showError = (message: string, fields: FieldId[] = []) => {
    setError(message);
    setErrorFields(fields);
    if (fields.length > 0) document.getElementById(FIELD_DOM_ID[fields[0]])?.focus();
  };

  const fieldErrorProps = (field: FieldId, extraDescribedBy?: string) => {
    const invalid = errorFields.includes(field);
    const describedBy = [extraDescribedBy, invalid ? ERROR_ID : undefined].filter(Boolean).join(" ");
    return {
      "aria-invalid": invalid || undefined,
      "aria-describedby": describedBy || undefined,
    };
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (username.trim().toLowerCase() === email.trim().toLowerCase()) {
      showError("Display name cannot be the same as email", ["username", "email"]);
      return;
    }

    if (password.length < 8) {
      showError("Password must be at least 8 characters", ["password"]);
      return;
    }

    if (!hasAcceptedLegal) {
      showError("You must agree to the Terms of Service and acknowledge the Privacy Policy", ["legal"]);
      return;
    }

    setIsLoading(true);
    trackSignupSubmitted(intent);

    try {
      const availability = await usersApi.checkAvailability({
        username: username.trim(),
        email: email.trim(),
      });

      const errors: string[] = [];
      const errorFieldIds: FieldId[] = [];
      if (!availability.isUsernameAvailable && availability.usernameError) {
        errors.push(availability.usernameError);
        errorFieldIds.push("username");
      }
      if (!availability.isEmailAvailable && availability.emailError) {
        errors.push(availability.emailError);
        errorFieldIds.push("email");
      }

      if (errors.length > 0) {
        showError(errors.join(". "), errorFieldIds);
        setIsLoading(false);
        return;
      }

      const acceptedAtUtc = new Date().toISOString();
      await signup(username, password, email);
      queueSignUpPolicyAcceptances(email.trim(), acceptedAtUtc);

      const cooldownUntil = Date.now() + RESEND_COOLDOWN_MS;
      setResendCooldownUntil(cooldownUntil);
      saveSignupRecovery({ email: email.trim(), cooldownUntil });
      setNeedsConfirmation(true);
      trackSignupConfirmationShown(intent);
    } catch (err: unknown) {
      if (err instanceof Error && hasSentinel(err.message, QM_USE_GOOGLE)) {
        // The Pre sign-up Lambda (pool-wide) found a Google-only account with this email. Never show the sentinel.
        showError("This email uses Continue with Google", ["email"]);
      } else {
        showError(err instanceof Error ? err.message : "Sign up failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setIsLoading(true);

    try {
      // Use email for confirmation since Cognito username is now the email
      const authenticated = await confirmSignup(email, confirmationCode);
      clearSignupRecovery();
      trackSignupConfirmed(intent);
      if (authenticated) {
        trackSignInCompleted(intent);
        navigate(intent.returnTo, { replace: true });
      } else {
        // Confirmation succeeded but a real session couldn't be verified
        // (auto-sign-in unavailable/expired/interrupted). Do not ask the
        // user to register again or retain the password for replay.
        setAutoSignInFailed(true);
      }
    } catch (err: unknown) {
      showError(describeConfirmError(err), ["code"]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    clearError();
    try {
      await resendConfirmationCode(email);
      const cooldownUntil = Date.now() + RESEND_COOLDOWN_MS;
      setResendCooldownUntil(cooldownUntil);
      saveSignupRecovery({ email, cooldownUntil });
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : "Could not resend the code. Please try again.");
    }
  };

  const handleUseDifferentEmail = () => {
    clearSignupRecovery();
    setNeedsConfirmation(false);
    setAutoSignInFailed(false);
    setConfirmationCode("");
    clearError();
    setResendCooldownUntil(null);
  };

  if (autoSignInFailed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Account confirmed — sign in to continue</h2>
          <p className="text-sm text-gray-600">
            Your account is confirmed. Sign in to continue to where you were.
          </p>
          <Link
            to={loginHref}
            className="inline-flex justify-center w-full py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (needsConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Confirm your account
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600 [overflow-wrap:anywhere]">
              We sent a confirmation code to {email}.
            </p>
          </div>
          <form className="mt-8 space-y-6" onSubmit={handleConfirm}>
            {error && (
              <div id={ERROR_ID} role="alert" className="rounded-md bg-red-50 p-4">
                <div className="text-sm text-red-800">{error}</div>
              </div>
            )}
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                Confirmation code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="one-time-code"
                {...fieldErrorProps("code")}
                inputMode="numeric"
                required
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="123456"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {isLoading ? "Confirming..." : "Confirm"}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldownRemainingSeconds > 0}
                className="font-medium text-indigo-ink hover:text-indigo-500 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {cooldownRemainingSeconds > 0
                  ? `Resend code (${cooldownRemainingSeconds}s)`
                  : "Resend code"}
              </button>
              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="font-medium text-gray-500 hover:text-gray-700"
              >
                Use a different email
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEO title="Sign Up" noindex />
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h2 className="text-center text-3xl font-extrabold text-gray-900">
            {benefit.heading}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">{benefit.body}</p>
        </div>
        <form
          className="space-y-6"
          onSubmit={handleSignUp}
          onFocus={() => trackSignupFormStarted(intent)}
        >
          {error && (
            <div id={ERROR_ID} role="alert" className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                Display name
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="nickname"
                {...fieldErrorProps("username")}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="How you'll appear to others"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                {...fieldErrorProps("email")}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  {...fieldErrorProps("password", "password-hint")}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
              <p id="password-hint" className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                id="legal"
                type="checkbox"
                {...fieldErrorProps("legal")}
                checked={hasAcceptedLegal}
                onChange={(e) => setHasAcceptedLegal(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-ink focus:ring-indigo-500"
              />
              <span>
                I agree to the{" "}
                <Link to="/terms" className="font-medium text-indigo-ink hover:text-indigo-500">
                  Terms of Service
                </Link>{" "}
                and acknowledge the{" "}
                <Link to="/privacy" className="font-medium text-indigo-ink hover:text-indigo-500">
                  Privacy Policy
                </Link>
                . You control whether your collections are private or shared.
              </span>
            </label>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading || isGoogleStarting}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isLoading ? "Signing up..." : "Sign up"}
            </button>
          </div>

          <GoogleSignInSection
            intent={intent}
            showLegalHelper
            disabled={isLoading}
            onStartingChange={setIsGoogleStarting}
            onError={(message) => (message ? showError(message) : clearError())}
          />

          <div className="text-center text-sm">
            <span className="text-gray-600">Already have an account? </span>
            <Link
              to={loginHref}
              className="font-medium text-indigo-ink hover:text-indigo-500"
            >
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
    </>
  );
};

export default SignUpPage;
