/**
 * Browser-local "already shown" starter items (#462, AC 3.0.29): `quizymode.starter.v1`.
 * Separate from `quizymode.guest.v1`, so "Clear guest history" (AC 3.0.17) leaves it alone. Item ids only, newest last,
 * capped FIFO. Reads tolerate missing, corrupt or oversized data by returning an empty list; writes never throw.
 */
export const STARTER_SEEN_STORAGE_KEY = "quizymode.starter.v1";
export const STARTER_SEEN_MAX = 100;
const MAX_DOCUMENT_LENGTH = 8 * 1024;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seen item ids, oldest first. Never throws. */
export function readStarterSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(STARTER_SEEN_STORAGE_KEY);
    if (!raw || raw.length > MAX_DOCUMENT_LENGTH) return [];
    const doc = JSON.parse(raw) as { version?: unknown; seen?: unknown };
    if (!doc || doc.version !== 1 || !Array.isArray(doc.seen)) return [];
    const unique: string[] = [];
    for (const entry of doc.seen) {
      if (typeof entry !== "string" || !GUID_PATTERN.test(entry)) continue;
      const index = unique.indexOf(entry);
      if (index >= 0) unique.splice(index, 1);
      unique.push(entry);
    }
    return unique.slice(-STARTER_SEEN_MAX);
  } catch {
    return [];
  }
}

/** Marks items as shown (moving repeats to the newest end) and keeps the newest 100. Returns false if storage failed. */
export function markStarterSeen(ids: string[]): boolean {
  try {
    const next = readStarterSeen().filter((id) => !ids.includes(id));
    next.push(...ids.filter((id) => GUID_PATTERN.test(id)));
    window.localStorage.setItem(
      STARTER_SEEN_STORAGE_KEY,
      JSON.stringify({ version: 1, seen: next.slice(-STARTER_SEEN_MAX) }),
    );
    return true;
  } catch {
    return false;
  }
}
