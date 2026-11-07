import { useState } from "react";
import { useNavigate, useLocation, Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { SEO } from "@/components/SEO";
import {
  SIGNUP_PATH,
  buildAuthIntentQuery,
  parseAuthIntent,
} from "@/features/auth/utils/authIntent";
import { trackSignInCompleted } from "@/features/auth/utils/authAnalytics";
import { FEEDBACK_LINK_LABEL, mapSignInError } from "@/features/auth/utils/signInErrors";
import { GoogleSignInSection } from "@/features/auth/components/GoogleSignInSection";

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [feedbackLink, setFeedbackLink] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleStarting, setIsGoogleStarting] = useState(false);

  const intent = parseAuthIntent(location.search);
  const signupHref = `${SIGNUP_PATH}${buildAuthIntentQuery(intent)}`;

  // Already-authenticated visitors follow the same validated-destination
  // rule, once initial auth loading has settled.
  if (!authLoading && isAuthenticated) {
    return <Navigate to={intent.returnTo} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFeedbackLink(false);
    setIsLoading(true);

    try {
      // login() only resolves once the provider reports completed sign-in
      // AND the app has verified an authenticated session -- a resolved
      // promise is itself sufficient evidence to navigate now.
      await login(email, password);
      trackSignInCompleted(intent);
      navigate(intent.returnTo, { replace: true });
    } catch (err: unknown) {
      const mapped = mapSignInError(err);
      setError(mapped.text);
      setFeedbackLink(mapped.linkToFeedback);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <SEO title="Sign In" noindex />
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div role="alert" className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-800">
                {feedbackLink && error.includes(FEEDBACK_LINK_LABEL) ? (
                  <>
                    {error.slice(0, error.indexOf(FEEDBACK_LINK_LABEL))}
                    <Link to="/feedback" className="font-medium underline">
                      {FEEDBACK_LINK_LABEL}
                    </Link>
                    {error.slice(
                      error.indexOf(FEEDBACK_LINK_LABEL) + FEEDBACK_LINK_LABEL.length
                    )}
                  </>
                ) : (
                  error
                )}
              </div>
            </div>
          )}
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading || isGoogleStarting}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </div>

          <GoogleSignInSection
            intent={intent}
            disabled={isLoading}
            onStartingChange={setIsGoogleStarting}
            onError={(message: string) => {
              setFeedbackLink(false);
              setError(message);
            }}
          />

          <div className="text-center text-sm">
            <span className="text-gray-600">Don't have an account? </span>
            <Link
              to={signupHref}
              className="font-medium text-indigo-ink hover:text-indigo-500"
            >
              Sign up
            </Link>
          </div>
        </form>
      </div>
    </div>
    </>
  );
};

export default LoginPage;
