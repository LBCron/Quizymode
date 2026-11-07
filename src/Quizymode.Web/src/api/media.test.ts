import { describe, expect, it } from "vitest";
import { mediaUploadErrorMessage } from "./media";
const error = (title: string, retryAfter?: string) => ({ isAxiosError: true, response: { status: 429, data: { title, detail: "internal details must not appear" }, headers: { "retry-after": retryAfter } } });
describe("Picture error recovery", () => {
  it("distinguishes pending, retained storage and global busy allowance", () => {
    expect(mediaUploadErrorMessage(error("Media.PendingReviewQuota"))).toMatch(/pending picture reviews/);
    expect(mediaUploadErrorMessage(error("Media.StorageQuota"))).toMatch(/does not free space immediately/);
    expect(mediaUploadErrorMessage(error("Media.GlobalBusy", "5"))).toMatch(/Retry after 5 seconds/);
    expect(mediaUploadErrorMessage(error("Unknown"))).not.toMatch(/internal details/);
  });
  it("explains pixel limits and unsupported formats without filenames or generated answer hints", () => {
    expect(mediaUploadErrorMessage(error("Media.TooManyPixels"))).toMatch(/16 million pixels and 8192/);
    expect(mediaUploadErrorMessage(error("Media.Animated"))).toMatch(/still JPEG, PNG or WebP/);
  });
});
