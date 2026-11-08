import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { collectionsApi } from "@/api/collections";
import { claimLocalBookmarks } from "./claimLocalBookmarks";
import {
  GUEST_BOOKMARKS_STORAGE_KEY,
  MAX_GUEST_BOOKMARKS,
  addLocalBookmark,
  readLocalBookmarks,
  removeLocalBookmark,
} from "./localBookmarks";

vi.mock("@/api/collections", () => ({
  collectionsApi: { getBookmarks: vi.fn(), bookmark: vi.fn() },
}));

const idA = "00000000-0000-4000-8000-00000000000a";
const idB = "00000000-0000-4000-8000-00000000000b";

function httpError(status: number): AxiosError {
  return new AxiosError("failed", "ERR", undefined, undefined, { status, data: {} } as AxiosResponse);
}

describe("guest bookmark store (AC 1.15.1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installMemoryLocalStorage();
  });

  it("stores lower-cased, de-duplicated GUIDs and ignores anything else", () => {
    expect(addLocalBookmark(idA.toUpperCase())).toBe("ok");
    expect(addLocalBookmark(idA)).toBe("ok");
    expect(addLocalBookmark("not-a-guid")).toBe("storage");
    expect(readLocalBookmarks()).toEqual([idA]);
  });

  it("reads corrupt, wrong-version and invalid entries as empty or partial, never throwing", () => {
    window.localStorage.setItem(GUEST_BOOKMARKS_STORAGE_KEY, "{not json");
    expect(readLocalBookmarks()).toEqual([]);
    window.localStorage.setItem(GUEST_BOOKMARKS_STORAGE_KEY, JSON.stringify({ version: 2, collections: [idA] }));
    expect(readLocalBookmarks()).toEqual([]);
    window.localStorage.setItem(GUEST_BOOKMARKS_STORAGE_KEY, JSON.stringify({ version: 1, collections: [idA, 42, "x", idB] }));
    expect(readLocalBookmarks()).toEqual([idA, idB]);
  });

  it("caps the list and reports the limit", () => {
    for (let n = 0; n < MAX_GUEST_BOOKMARKS; n++) {
      const id = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      expect(addLocalBookmark(id)).toBe("ok");
    }
    expect(addLocalBookmark("00000000-0000-4000-8000-ffffffffffff")).toBe("limit");
    expect(readLocalBookmarks()).toHaveLength(MAX_GUEST_BOOKMARKS);
  });

  it("removes one bookmark", () => {
    addLocalBookmark(idA);
    addLocalBookmark(idB);
    expect(removeLocalBookmark(idA)).toBe(true);
    expect(readLocalBookmarks()).toEqual([idB]);
  });
});

describe("claimLocalBookmarks (AC 1.15.4)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installMemoryLocalStorage();
    vi.mocked(collectionsApi.getBookmarks).mockResolvedValue({ collections: [] } as never);
    vi.mocked(collectionsApi.bookmark).mockResolvedValue(undefined);
  });

  it("does nothing without local bookmarks", async () => {
    expect(await claimLocalBookmarks()).toBe(false);
    expect(collectionsApi.getBookmarks).not.toHaveBeenCalled();
  });

  it("replays local bookmarks and clears the local copy", async () => {
    addLocalBookmark(idA);
    addLocalBookmark(idB);
    expect(await claimLocalBookmarks()).toBe(true);
    expect(collectionsApi.bookmark).toHaveBeenCalledWith(idA);
    expect(collectionsApi.bookmark).toHaveBeenCalledWith(idB);
    expect(window.localStorage.getItem(GUEST_BOOKMARKS_STORAGE_KEY)).toBeNull();
  });

  it("does not write a collection the account already bookmarks", async () => {
    addLocalBookmark(idA);
    addLocalBookmark(idB);
    vi.mocked(collectionsApi.getBookmarks).mockResolvedValue({ collections: [{ id: idA }] } as never);
    await claimLocalBookmarks();
    expect(collectionsApi.bookmark).toHaveBeenCalledTimes(1);
    expect(collectionsApi.bookmark).toHaveBeenCalledWith(idB);
  });

  it("drops a collection the server rejects as unavailable (404) and still clears", async () => {
    addLocalBookmark(idA);
    vi.mocked(collectionsApi.bookmark).mockRejectedValue(httpError(404));
    expect(await claimLocalBookmarks()).toBe(false);
    expect(window.localStorage.getItem(GUEST_BOOKMARKS_STORAGE_KEY)).toBeNull();
  });

  it("keeps the remaining ids when the network fails, for a later session", async () => {
    addLocalBookmark(idA);
    addLocalBookmark(idB);
    vi.mocked(collectionsApi.bookmark).mockRejectedValueOnce(httpError(503));
    expect(await claimLocalBookmarks()).toBe(false);
    expect(readLocalBookmarks()).toEqual([idA, idB]);
  });

  it("keeps the local copy when the account list cannot be read", async () => {
    addLocalBookmark(idA);
    vi.mocked(collectionsApi.getBookmarks).mockRejectedValue(httpError(500));
    expect(await claimLocalBookmarks()).toBe(false);
    expect(collectionsApi.bookmark).not.toHaveBeenCalled();
    expect(readLocalBookmarks()).toEqual([idA]);
  });
});
