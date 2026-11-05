import { analyticsApi, type AnalyticsEventPayload } from "@/api/analytics";
import { API_URL } from "@/api/client";
import { getPageViewSessionId, isInternalBrowser } from "@/utils/pageViewTracking";
import { getToken } from "@/utils/tokenStorage";
import { getVisitorId } from "@/utils/visitorId";

/** Must match AnalyticsEventCatalog on the API; unknown names are rejected there. */
export type AnalyticsEventName =
  | "quick_quiz_started"
  | "quiz_completed"
  | "signup_prompt_viewed"
  | "signup_prompt_clicked"
  | "signup_form_started"
  | "signup_submitted"
  | "signup_confirmation_shown"
  | "signup_confirmed"
  | "sign_in_completed"
  | "guest_state_imported"
  | "question_answered"
  | "flashcards_started"
  | "flashcard_revealed"
  | "flashcard_graded"
  | "quiz_result_shared"
  | "search_performed"
  | "search_result_clicked"
  | "topic_suggestion_shown"
  | "topic_suggestion_accepted"
  | "topic_suggestion_overridden"
  | "game_started"
  | "game_completed"
  | "starter_next_clicked";

export type AnalyticsContextType =
  | "auth"
  | "category"
  | "collection"
  | "daily"
  | "flashcards"
  | "game"
  | "home"
  | "item"
  | "learn"
  | "mine"
  | "quiz"
  | "review"
  | "search"
  | "topic";

export interface AnalyticsEventInput {
  name: AnalyticsEventName;
  contextType?: AnalyticsContextType;
  contextId?: string;
  /** One quiz/flashcards run. The API stores at most one event per name and run per session. */
  runId?: string;
  score?: number;
  total?: number;
  /** Item-level study events: the item, its 1-based position in the run, and first-answer correctness. */
  itemId?: string;
  position?: number;
  isCorrect?: boolean;
}

const MAX_BATCH = 25;
const SENT_ONCE_STORAGE_KEY = "quizymode.analytics.sent-once";
const MAX_SENT_ONCE_KEYS = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** Deferred (per-answer) events are sent in batches of this size, on explicit flush, or when the page hides. */
const DEFERRED_FLUSH_SIZE = 5;

let queue: AnalyticsEventPayload[] = [];
let flushScheduled = false;
const sentOnceInMemory = new Set<string>();
let deferred: AnalyticsEventPayload[] = [];
const deferredKeys = new Set<string>();
let pageHideListenerAttached = false;

/**
 * Records an engagement event without ever blocking or failing the caller. Events queued in the
 * same tick are sent as one batch; a failed send is dropped rather than retried in a loop.
 */
export function trackEvent(input: AnalyticsEventInput): void {
  enqueue(input, undefined);
}

/**
 * Records an event at most once per tab session for `onceKey` (for example one prompt impression),
 * so React remounts and repeated renders do not inflate counts. The key doubles as the server-side
 * idempotency id when it is a short token.
 */
export function trackEventOnce(onceKey: string, input: AnalyticsEventInput): void {
  const scopedKey = `${input.name}:${onceKey}`;
  if (hasSentOnce(scopedKey)) {
    return;
  }

  rememberSentOnce(scopedKey);
  enqueue(input, TOKEN_PATTERN.test(onceKey) ? onceKey : undefined);
}

/**
 * Records a high-volume event (for example one answer per question) at most once per page load for
 * `onceKey`, holding it until DEFERRED_FLUSH_SIZE events accumulate, `flushDeferredAnalyticsEvents` is
 * called, or the page is hidden. Abandoned runs still report what was done before the tab closed.
 */
export function trackEventDeferredOnce(onceKey: string, input: AnalyticsEventInput): void {
  const scopedKey = `${input.name}:${onceKey}`;
  if (deferredKeys.has(scopedKey)) {
    return;
  }

  try {
    deferredKeys.add(scopedKey);
    deferred.push(buildPayload(input, undefined));
    attachPageHideListener();
    if (deferred.length >= DEFERRED_FLUSH_SIZE) {
      flushDeferredAnalyticsEvents();
    }
  } catch (error) {
    console.debug("Analytics event was not deferred", error);
  }
}

/** Moves deferred events into the send queue (for example right before a run's completion event). */
export function flushDeferredAnalyticsEvents(): void {
  if (deferred.length === 0) {
    return;
  }

  queue.push(...deferred);
  deferred = [];
  scheduleFlush();
}

/** A random id suitable for runIds and impression keys. */
export function createAnalyticsId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The visitor id (ANALYTICS-003) when one is allowed; omitted under Global Privacy Control or without storage. */
function visitorIdField(): { visitorId?: string } {
  const visitorId = getVisitorId();
  return visitorId ? { visitorId } : {};
}

/** Sends anything still queued. Exposed for tests and for callers about to navigate away. */
export async function flushAnalyticsEvents(): Promise<void> {
  flushScheduled = false;
  while (queue.length > 0) {
    const batch = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);
    try {
      await analyticsApi.trackEvents({
        sessionId: getPageViewSessionId(),
        events: batch,
        ...(isInternalBrowser() ? { internalBrowser: true } : {}),
        ...visitorIdField(),
      });
    } catch (error) {
      console.debug("Analytics event delivery failed", error);
    }
  }
}

function enqueue(input: AnalyticsEventInput, clientEventId: string | undefined): void {
  try {
    queue.push(buildPayload(input, clientEventId));
    scheduleFlush();
  } catch (error) {
    console.debug("Analytics event was not queued", error);
  }
}

function buildPayload(input: AnalyticsEventInput, clientEventId: string | undefined): AnalyticsEventPayload {
  return {
    name: input.name,
    path: currentPath(),
    ...(input.contextType ? { contextType: input.contextType } : {}),
    ...(input.contextType && input.contextId ? { contextId: input.contextId } : {}),
    ...(clientEventId ? { clientEventId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(typeof input.score === "number" ? { score: input.score } : {}),
    ...(typeof input.total === "number" ? { total: input.total } : {}),
    ...(input.itemId ? { itemId: input.itemId } : {}),
    ...(typeof input.position === "number" ? { position: input.position } : {}),
    ...(typeof input.isCorrect === "boolean" ? { isCorrect: input.isCorrect } : {}),
  };
}

function scheduleFlush(): void {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      void flushAnalyticsEvents();
    });
  }
}

function attachPageHideListener(): void {
  if (pageHideListenerAttached || typeof window === "undefined") {
    return;
  }

  pageHideListenerAttached = true;
  window.addEventListener("pagehide", sendPendingOnPageHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendPendingOnPageHide();
    }
  });
}

/**
 * Delivers queued and deferred events while the page is going away. A keepalive fetch outlives the page
 * like sendBeacon, but unlike sendBeacon it can send JSON and the bearer token to the API origin.
 */
function sendPendingOnPageHide(): void {
  const pending = [...queue, ...deferred];
  if (pending.length === 0 || typeof fetch !== "function") {
    return;
  }

  queue = [];
  deferred = [];
  try {
    const token = getToken();
    for (let start = 0; start < pending.length; start += MAX_BATCH) {
      void fetch(`${API_URL}/analytics/events`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId: getPageViewSessionId(),
          events: pending.slice(start, start + MAX_BATCH),
          ...(isInternalBrowser() ? { internalBrowser: true } : {}),
          ...visitorIdField(),
        }),
      }).catch(() => undefined);
    }
  } catch (error) {
    console.debug("Analytics events were not sent on page hide", error);
  }
}

function currentPath(): string {
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  return path && path.startsWith("/") ? path.slice(0, 512) : "/";
}

function hasSentOnce(scopedKey: string): boolean {
  if (sentOnceInMemory.has(scopedKey)) {
    return true;
  }

  try {
    const raw = window.sessionStorage.getItem(SENT_ONCE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]).includes(scopedKey) : false;
  } catch {
    return false;
  }
}

function rememberSentOnce(scopedKey: string): void {
  sentOnceInMemory.add(scopedKey);
  try {
    const raw = window.sessionStorage.getItem(SENT_ONCE_STORAGE_KEY);
    const keys = raw ? (JSON.parse(raw) as string[]) : [];
    keys.push(scopedKey);
    window.sessionStorage.setItem(
      SENT_ONCE_STORAGE_KEY,
      JSON.stringify(keys.slice(-MAX_SENT_ONCE_KEYS))
    );
  } catch {
    // In-memory dedupe still covers this page load.
  }
}

/** Test-only: clears module state between tests. */
export function resetAnalyticsEventsForTests(): void {
  queue = [];
  flushScheduled = false;
  sentOnceInMemory.clear();
  deferred = [];
  deferredKeys.clear();
}

/** Test-only: runs the page-hide delivery path. */
export function sendPendingOnPageHideForTests(): void {
  sendPendingOnPageHide();
}
