import { Component, Suspense, type ReactNode } from "react";
import LoadingSpinner from "./LoadingSpinner";
import { isChunkLoadError, readReloadFlag, setReloadFlag } from "@/utils/lazyPage";
import { reportClientError } from "@/features/errorReporting/clientErrorReporter";

interface BoundaryProps {
  children: ReactNode;
  /** Clears a shown failure when it changes (for example the route path). */
  resetKey?: string;
  reload?: () => void;
}

interface BoundaryState {
  error: Error | null;
}

export class LazyRouteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Non-chunk errors are rethrown in render and reported by the app-level ErrorBoundary.
    if (!isChunkLoadError(error)) return;
    if (!readReloadFlag() && setReloadFlag()) {
      // A deploy probably replaced index.html; reload once per tab session to pick up new chunk names.
      this.reload();
      return;
    }
    reportClientError("boundary", error, info.componentStack);
  }

  // Browsers cache a failed dynamic import for the life of the document, so Retry reloads the page.
  // It is user-initiated, so it cannot loop; the automatic reload above stays limited to once per tab.
  private reload = () => (this.props.reload ?? (() => window.location.reload()))();

  render() {
    if (this.state.error) {
      if (!isChunkLoadError(this.state.error)) throw this.state.error;
      return (
        <div role="alert" className="max-w-md mx-auto my-12 bg-surface shadow rounded-lg p-6 text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">This page failed to load</h1>
          <p className="text-gray-600 mb-4">Check your connection and try again.</p>
          <button
            type="button"
            onClick={this.reload}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Suspense + chunk-failure boundary for lazy routes; spinner renders inside the Layout. */
export function LazyRoute({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  return (
    <LazyRouteBoundary resetKey={resetKey}>
      <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
    </LazyRouteBoundary>
  );
}
