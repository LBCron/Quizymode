import { beforeEach, expect, it, vi } from "vitest";
import { mediaApi } from "./media";
import { apiClient } from "./client";
vi.mock("./client", () => ({ apiClient: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
it.each([undefined, "shared"])("binds ordinary and print/shared delivery to revision without fallback (%s)", async collection => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: new Blob() });
  const signal = new AbortController().signal;
  await mediaApi.content("item", "question", collection, signal, 7);
  expect(apiClient.get).toHaveBeenCalledWith(collection ? "/collections/shared/items/item/images/question" : "/items/item/images/question", { signal, responseType: "blob", params: { expectedRevision: 7 } });
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("404"));
  await expect(mediaApi.content("item", "question", collection, signal, 7)).rejects.toThrow("404");
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});
it.each([0, -1, NaN])("makes no request for invalid DTO revision %s", async revision => {
  await expect(mediaApi.content("item", "question", undefined, new AbortController().signal, revision)).rejects.toThrow(); expect(apiClient.get).not.toHaveBeenCalled();
});
