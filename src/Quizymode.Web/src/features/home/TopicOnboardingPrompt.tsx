import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, type UserSettingsResponse } from "@/api/users";
import { useAuth } from "@/contexts/AuthContext";
import { useInterests, useLocalVersion } from "@/features/interests/useInterests";
import { useTopicEditor } from "@/features/interests/topicEditorContext";
import { readLocalInterests } from "@/features/learningLoop/localLearningState";

const SETTING_KEY_TOPIC_ONBOARDING = "TopicOnboarding";
const SESSION_DISMISSED_KEY = "quizymode.topicOnboarding.dismissed";

function readSessionDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSessionDismissed(): void {
  try {
    window.sessionStorage.setItem(SESSION_DISMISSED_KEY, "1");
  } catch {
    // Storage unavailable: the in-memory flag still hides the card for this page view.
  }
}

/**
 * One-time "Make Home yours" card for signed-in visitors with no topics (#382). It never blocks: "Not now" hides it
 * at once (and for the page session even if saving the dismissal fails), and it stays hidden while browser-local
 * picks are waiting to be claimed into the account.
 */
export function TopicOnboardingPrompt() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const topicEditor = useTopicEditor();
  const headingId = useId();
  const [dismissedHere, setDismissedHere] = useState(false);
  const signedIn = isAuthenticated && !isAuthLoading;

  const { interests, status } = useInterests();
  const settings = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => usersApi.getSettings(),
    enabled: signedIn,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Re-read on every local change: a pending claim clears the local copy, and until then the prompt must not flash.
  useLocalVersion();
  const hasLocalPicks = readLocalInterests().length > 0;

  const show =
    signedIn &&
    status === "ready" &&
    interests.length === 0 &&
    settings.isSuccess &&
    !settings.data.settings[SETTING_KEY_TOPIC_ONBOARDING] &&
    !hasLocalPicks &&
    !dismissedHere &&
    !readSessionDismissed();
  if (!show) return null;

  const dismiss = () => {
    // Move focus to the next control before the card disappears, so it never falls back to the page body.
    const next =
      document.querySelector<HTMLElement>('a[href="/daily"]') ??
      document.querySelector<HTMLElement>("main") ??
      document.querySelector<HTMLElement>("h1");
    if (next) {
      if (!next.matches("a,button,input,[tabindex]")) next.tabIndex = -1;
      next.focus();
    }
    writeSessionDismissed();
    setDismissedHere(true);
    queryClient.setQueryData<UserSettingsResponse>(["userSettings"], (current) => ({
      settings: { ...current?.settings, [SETTING_KEY_TOPIC_ONBOARDING]: "dismissed" },
    }));
    // Best effort: a failed write only means the card may return in a later session.
    void usersApi.updateSetting({ key: SETTING_KEY_TOPIC_ONBOARDING, value: "dismissed" }).catch(() => {});
  };

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="rounded-[24px] border border-sky-300/30 bg-sky-500/10 p-2 shadow-xl shadow-slate-950/25 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-3"
    >
      <div>
        <h2 id={headingId} className="text-sm font-semibold text-on-panel">Make Home yours</h2>
        <p className="mt-0.5 text-xs text-on-panel">
          Pick up to 10 topics and your Home puts them first. You can change them any time.
        </p>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:mt-0 sm:shrink-0 sm:flex-row">
        <button
          type="button"
          onClick={topicEditor.open}
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-[#020617] hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
        >
          Choose topics
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-on-panel/20 px-5 py-2 text-sm font-semibold text-on-panel hover:bg-on-panel/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
