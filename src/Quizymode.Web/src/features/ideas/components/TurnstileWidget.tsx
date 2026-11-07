import { useEffect, useRef, useState } from "react";

interface TurnstileWidgetProps {
  onTokenChange: (token: string | null) => void;
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]'
    );

    if (existingScript) {
      if (window.turnstile) {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Turnstile failed to load.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load."));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

const TurnstileWidget = ({ onTokenChange }: TurnstileWidgetProps) => {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [challengeFailed, setChallengeFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Parents usually pass an inline callback; keep the latest one in a ref so a new function
  // identity on every render does not tear down and re-render the widget (which reset the token
  // and re-rendered the parent again, so the widget never appeared).
  const onTokenChangeRef = useRef(onTokenChange);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    const onTokenChange = (token: string | null) => onTokenChangeRef.current(token);
    if (!siteKey) {
      if (!import.meta.env.PROD) {
        onTokenChange("dev-turnstile-bypass");
        return;
      }

      onTokenChange(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoadError("Idea submission is unavailable until Turnstile is configured.");
      return;
    }

    let cancelled = false;
    onTokenChange(null);
    setLoadError(null);
    setChallengeFailed(false);

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) {
          return;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            setChallengeFailed(false);
            onTokenChange(token);
          },
          "expired-callback": () => onTokenChange(null),
          "error-callback": () => {
            onTokenChange(null);
            setChallengeFailed(true);
          },
        });
      })
      .catch((error) => {
        if (!cancelled) {
          onTokenChange(null);
          setLoadError(error instanceof Error ? error.message : "Turnstile failed to load.");
        }
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey]);

  if (!siteKey && !import.meta.env.PROD) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        Local development bypass is active. Production submissions require Cloudflare Turnstile.
      </div>
    );
  }

  // Resets the widget in place so the typed form is kept.
  const retryChallenge = () => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
    setChallengeFailed(false);
  };

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      {loadError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
          {loadError}
        </div>
      )}
      {challengeFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900"
        >
          <span>Verification failed. Your idea is kept; try the check again.</span>
          <button
            type="button"
            onClick={retryChallenge}
            className="rounded-full border border-rose-300 bg-surface px-3 py-1 font-semibold text-rose-900 hover:bg-rose-100"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
};

export default TurnstileWidget;
