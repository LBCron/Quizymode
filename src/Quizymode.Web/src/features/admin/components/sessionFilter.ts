import { z } from "zod";

/** Mirrors the API limit on the sessionId filter. */
export const MAX_SESSION_ID_LENGTH = 128;

const sessionIdSchema = z.string().trim().min(1).max(MAX_SESSION_ID_LENGTH);
const visitorIdSchema = z.string().trim().uuid();

export const ANALYTICS_TABS = [
  "pages",
  "sessions",
  "acquisition",
  "funnel",
  "learning",
  "content",
  "questions",
  "lifecycle",
  "trends",
] as const;

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

export function parseSessionIdParam(value: string | null | undefined): string | undefined {
  const result = sessionIdSchema.safeParse(value ?? "");
  return result.success ? result.data : undefined;
}

export function parseVisitorIdParam(value: string | null | undefined): string | undefined {
  const result = visitorIdSchema.safeParse(value ?? "");
  return result.success ? result.data : undefined;
}

export function parseTabParam(value: string | null | undefined): AnalyticsTab {
  return (ANALYTICS_TABS as readonly string[]).includes(value ?? "")
    ? (value as AnalyticsTab)
    : "sessions";
}

/** Deep link to the Sessions tab narrowed to one session. */
export function sessionFilterHref(sessionId: string): string {
  return `/admin/page-views?tab=sessions&session=${encodeURIComponent(sessionId)}`;
}

/**
 * A journey step becomes a link only when it is a relative same-origin path; anything else
 * (absolute or protocol-relative URLs) stays plain text.
 */
export function toSafeRelativeHref(path: string, queryString: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return null;
  }
  return `${path}${queryString ?? ""}`;
}
