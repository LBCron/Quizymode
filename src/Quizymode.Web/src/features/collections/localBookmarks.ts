/**
 * Browser-local collection bookmarks for anonymous visitors (#503, AC 1.15.1): `quizymode.bookmarks.v1`.
 * Stores only public collection ids (GUIDs), never names or item content. Reads tolerate missing, corrupt,
 * wrong-version or oversized data by returning an empty list. Signed-in mode ignores this key except for the
 * sign-in claim (claimLocalBookmarks).
 */
export const GUEST_BOOKMARKS_STORAGE_KEY = "quizymode.bookmarks.v1";
export const GUEST_BOOKMARKS_CHANGED_EVENT = "quizymode:guest-bookmarks-changed";
export const MAX_GUEST_BOOKMARKS = 50;
const MAX_DOCUMENT_LENGTH = 8 * 1024;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GuestBookmarkWrite = "ok" | "limit" | "storage";

/** Valid stored collection ids, lower-cased and de-duplicated, oldest first. Never throws. */
export function readLocalBookmarks(): string[] {
  try {
    const raw = window.localStorage.getItem(GUEST_BOOKMARKS_STORAGE_KEY);
    if (!raw || raw.length > MAX_DOCUMENT_LENGTH) return [];
    const doc = JSON.parse(raw) as { version?: unknown; collections?: unknown };
    if (!doc || doc.version !== 1 || !Array.isArray(doc.collections)) return [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of doc.collections) {
      if (typeof entry !== "string" || !GUID_PATTERN.test(entry)) continue;
      const id = entry.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === MAX_GUEST_BOOKMARKS) break;
    }
    return ids;
  } catch {
    return [];
  }
}

function write(ids: string[]): boolean {
  try {
    window.localStorage.setItem(GUEST_BOOKMARKS_STORAGE_KEY, JSON.stringify({ version: 1, collections: ids }));
    window.dispatchEvent(new Event(GUEST_BOOKMARKS_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Adds a bookmark. Returns "limit" when the cap is reached and "storage" when the browser refuses the write. */
export function addLocalBookmark(collectionId: string): GuestBookmarkWrite {
  if (!GUID_PATTERN.test(collectionId)) return "storage";
  const id = collectionId.toLowerCase();
  const current = readLocalBookmarks();
  if (current.includes(id)) return "ok";
  if (current.length >= MAX_GUEST_BOOKMARKS) return "limit";
  return write([...current, id]) ? "ok" : "storage";
}

/** Removes a bookmark. Returns false when storage could not be written. */
export function removeLocalBookmark(collectionId: string): boolean {
  const id = collectionId.toLowerCase();
  return write(readLocalBookmarks().filter((entry) => entry !== id));
}

/** Writes a reduced list (used by the sign-in claim to keep ids that must retry). */
export function replaceLocalBookmarks(ids: string[]): boolean {
  return write(ids.slice(0, MAX_GUEST_BOOKMARKS));
}

/** Removes the whole document (after the sign-in claim has succeeded). */
export function clearLocalBookmarks(): void {
  try {
    window.localStorage.removeItem(GUEST_BOOKMARKS_STORAGE_KEY);
    window.dispatchEvent(new Event(GUEST_BOOKMARKS_CHANGED_EVENT));
  } catch {
    // The claim retries on the next page session.
  }
}
