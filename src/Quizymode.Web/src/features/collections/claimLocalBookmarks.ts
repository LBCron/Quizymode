import { isAxiosError } from "axios";
import { collectionsApi } from "@/api/collections";
import { clearLocalBookmarks, readLocalBookmarks, replaceLocalBookmarks } from "./localBookmarks";

/**
 * After sign-in, replays browser-local bookmarks (#503, AC 1.15.4) through the existing bookmark endpoint. The account
 * wins: a collection the account already bookmarks is not written again. A collection the server rejects (404 because
 * it is private, deleted or unavailable, or 400) is dropped. A network or 5xx failure keeps the remaining ids for a later
 * page session. Silent: no UI. Returns true when at least one bookmark was saved.
 */
export async function claimLocalBookmarks(): Promise<boolean> {
  const local = readLocalBookmarks();
  if (local.length === 0) return false;

  let accountIds: Set<string>;
  try {
    accountIds = new Set((await collectionsApi.getBookmarks()).collections.map((c) => c.id.toLowerCase()));
  } catch {
    return false;
  }

  let saved = false;
  const pending = local.filter((id) => !accountIds.has(id));
  for (let index = 0; index < pending.length; index++) {
    try {
      await collectionsApi.bookmark(pending[index]);
      saved = true;
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 400 || status === 404) continue;
      // Network or server failure: keep this id and everything after it for the next page session.
      replaceLocalBookmarks(pending.slice(index));
      return saved;
    }
  }

  clearLocalBookmarks();
  return saved;
}
