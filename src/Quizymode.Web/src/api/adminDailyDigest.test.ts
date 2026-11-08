import { beforeEach, describe, expect, it, vi } from "vitest";
import { dailyDigestApi } from "./adminDailyDigest";

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock("./client", () => ({ apiClient: { get: mockGet, post: mockPost } }));

const runsBody = {
  enabled: true,
  disabledReason: null,
  emailConfigured: true,
  timeZone: "America/Chicago",
  nextDueUtc: "2026-11-08T14:00:00Z",
  lastTestSentUtc: null,
  runs: [],
};

describe("dailyDigestApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getRuns calls GET /admin/daily-digest/runs with days and validates the body", async () => {
    mockGet.mockResolvedValueOnce({ data: runsBody });
    await expect(dailyDigestApi.getRuns(14)).resolves.toMatchObject({ enabled: true, timeZone: "America/Chicago" });
    expect(mockGet).toHaveBeenCalledWith("/admin/daily-digest/runs", { params: { days: 14 } });
  });

  it("getRuns rejects a body that does not match the contract", async () => {
    mockGet.mockResolvedValueOnce({ data: { ...runsBody, runs: [{ id: "x", status: "Nope" }] } });
    await expect(dailyDigestApi.getRuns()).rejects.toThrow();
  });

  it("getPreview calls GET /admin/daily-digest/preview and passes the date when given", async () => {
    mockGet.mockResolvedValue({
      data: { reportDate: "2026-11-06", windowStartUtc: "a", windowEndUtc: "b", subject: "s", textBody: "t" },
    });
    await dailyDigestApi.getPreview();
    await dailyDigestApi.getPreview("2026-11-06");
    expect(mockGet).toHaveBeenNthCalledWith(1, "/admin/daily-digest/preview", { params: undefined });
    expect(mockGet).toHaveBeenNthCalledWith(2, "/admin/daily-digest/preview", { params: { date: "2026-11-06" } });
  });

  it("sendTest posts to /admin/daily-digest/test-send", async () => {
    mockPost.mockResolvedValueOnce({ data: { subject: "[TEST] s" } });
    await expect(dailyDigestApi.sendTest()).resolves.toEqual({ subject: "[TEST] s" });
    expect(mockPost).toHaveBeenCalledWith("/admin/daily-digest/test-send");
  });

  it("sendNow posts only the window, never a recipient", async () => {
    mockPost.mockResolvedValueOnce({ data: { id: "i", status: "Sent", windowStartUtc: "a", windowEndUtc: "b" } });
    await dailyDigestApi.sendNow("2026-11-06T00:00:00.000Z", "2026-11-07T00:00:00.000Z");
    expect(mockPost).toHaveBeenCalledWith("/admin/daily-digest/send-now", {
      from: "2026-11-06T00:00:00.000Z",
      to: "2026-11-07T00:00:00.000Z",
    });
  });
});
