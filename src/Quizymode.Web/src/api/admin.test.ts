import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "./admin";

const { mockGet, mockPost, mockPut, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("./client", () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  },
}));

describe("adminApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getReviewBoardItems calls GET /admin/items/review-board", async () => {
    const data = { items: [] };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getReviewBoardItems();
    expect(mockGet).toHaveBeenCalledWith("/admin/items/review-board");
    expect(result).toEqual(data);
  });

  it("getImageReviewQueue calls GET /admin/items/image-review with state and paging", async () => {
    const data = { items: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 0 };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getImageReviewQueue("Rejected", 2, 10);
    expect(mockGet).toHaveBeenCalledWith("/admin/items/image-review", {
      params: { state: "Rejected", page: 2, pageSize: 10 },
    });
    expect(result).toEqual(data);
  });

  it("setImageReview calls PUT /admin/items/:id/image-review", async () => {
    const data = { id: "i1", imageReview: { state: "Rejected", revision: 3 } };
    mockPut.mockResolvedValueOnce({ data });
    const result = await adminApi.setImageReview("i1", { decision: "reject", expectedRevision: 3, reason: "Blurry" });
    expect(mockPut).toHaveBeenCalledWith("/admin/items/i1/image-review", {
      decision: "reject",
      expectedRevision: 3,
      reason: "Blurry",
    });
    expect(result).toEqual(data);
  });

  it("fetchItemImageBlob fetches the slot as a blob", async () => {
    const blob = new Blob(["x"]);
    mockGet.mockResolvedValueOnce({ data: blob });
    const result = await adminApi.fetchItemImageBlob("i1", "explanation", 4);
    expect(mockGet).toHaveBeenCalledWith("/items/i1/images/explanation", { responseType: "blob", params: { expectedRevision: 4 } });
    expect(result).toBe(blob);
  });

  it("approveItem calls PUT /admin/items/:id/approval", async () => {
    const data = { id: "i1" };
    mockPut.mockResolvedValueOnce({ data });
    const result = await adminApi.approveItem("i1");
    expect(mockPut).toHaveBeenCalledWith("/admin/items/i1/approval");
    expect(result).toEqual(data);
  });

  it("rejectItem calls PUT /admin/items/:id/rejection with reason", async () => {
    const data = { id: "i1" };
    mockPut.mockResolvedValueOnce({ data });
    const result = await adminApi.rejectItem("i1", "Inaccurate");
    expect(mockPut).toHaveBeenCalledWith("/admin/items/i1/rejection", { reason: "Inaccurate" });
    expect(result).toEqual(data);
  });

  it("getDatabaseSize calls GET /admin/database/size", async () => {
    const data = {
      sizeBytes: 1000,
      sizeMegabytes: 0.001,
      sizeGigabytes: 0,
      freeTierLimitMegabytes: 500,
      usagePercentage: 0,
      itemCount: 12,
      keywordCount: 3,
      topTables: [
        {
          tableName: "Items",
          sizeBytes: 600,
          sizeMegabytes: 0.0006,
          sizeGigabytes: 0,
        },
      ],
    };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getDatabaseSize();
    expect(mockGet).toHaveBeenCalledWith("/admin/database/size");
    expect(result).toEqual(data);
  });

  it("getAuditLogs calls GET /admin/audit-logs with default params", async () => {
    const data = { logs: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0 };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getAuditLogs();
    expect(mockGet).toHaveBeenCalledWith("/admin/audit-logs", expect.objectContaining({
      params: expect.objectContaining({ page: 1, pageSize: 50 }),
    }));
    expect(result).toEqual(data);
  });

  it("getAuditLogs passes actionTypes as comma-joined string", async () => {
    mockGet.mockResolvedValueOnce({ data: { logs: [] } });
    await adminApi.getAuditLogs(["ItemCreated", "ItemDeleted"]);
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.actionTypes).toBe("ItemCreated,ItemDeleted");
  });

  it("getPageViewAnalytics calls GET /admin/page-view-analytics with defaults", async () => {
    const data = { summary: {}, topPages: [], recentPageViews: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 0 };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getPageViewAnalytics();
    expect(mockGet).toHaveBeenCalledWith("/admin/page-view-analytics", expect.objectContaining({
      params: expect.objectContaining({ days: 7, visitorType: "all", page: 1, pageSize: 25 }),
    }));
    expect(result).toEqual(data);
  });

  it("getPageViewAnalytics includes pathContains when provided", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    await adminApi.getPageViewAnalytics(7, "all", "  /home  ");
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.pathContains).toBe("/home");
  });

  it("getPageViewAnalytics excludes bots by default", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    await adminApi.getPageViewAnalytics();
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.includeBots).toBe(false);
  });

  it("getPageViewSessions calls GET /admin/page-view-sessions with defaults", async () => {
    const data = {
      summary: {},
      depthBuckets: [],
      landingPages: [],
      sessions: [],
      totalCount: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
    };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getPageViewSessions();
    expect(mockGet).toHaveBeenCalledWith(
      "/admin/page-view-sessions",
      expect.objectContaining({
        params: expect.objectContaining({
          days: 7,
          outcome: "all",
          includeBots: false,
          sortBy: "recent",
          page: 1,
          pageSize: 25,
        }),
      })
    );
    expect(result).toEqual(data);
  });

  it("getPageViewSessions omits minPages when it would not filter anything", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    await adminApi.getPageViewSessions(7, "all", 1);
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.minPages).toBeUndefined();
  });

  it("getPageViewSessions sends minPages when hiding bounces", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    await adminApi.getPageViewSessions(30, "anonymous", 2, true, "pages");
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.minPages).toBe(2);
    expect(opts.params.outcome).toBe("anonymous");
    expect(opts.params.includeBots).toBe(true);
    expect(opts.params.sortBy).toBe("pages");
  });

  it("getPageViewSessions sends sessionId and visitorId only when set", async () => {
    mockGet.mockResolvedValue({ data: {} });
    await adminApi.getPageViewSessions(7, "all", undefined, false, "recent", 1, 25, 10, false, undefined, "s-1", "8f14e45f-ceea-4672-9a3b-1f2d3c4b5a69");
    expect(mockGet.mock.calls[0][1].params.sessionId).toBe("s-1");
    expect(mockGet.mock.calls[0][1].params.visitorId).toBe("8f14e45f-ceea-4672-9a3b-1f2d3c4b5a69");

    await adminApi.getPageViewSessions();
    expect(mockGet.mock.calls[1][1].params.sessionId).toBeUndefined();
    expect(mockGet.mock.calls[1][1].params.visitorId).toBeUndefined();
  });

  it("getPageViewSessionDetail encodes the session id in the path", async () => {
    const data = { sessionId: "a/b", steps: [] };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getPageViewSessionDetail("a/b");
    expect(mockGet).toHaveBeenCalledWith("/admin/page-view-sessions/a%2Fb");
    expect(result).toEqual(data);
  });

  it("getConversionFunnel calls GET /admin/analytics/funnel with window and bot flag", async () => {
    const data = { steps: [] };
    mockGet.mockResolvedValueOnce({ data });

    const result = await adminApi.getConversionFunnel(30, true);

    expect(mockGet).toHaveBeenCalledWith("/admin/analytics/funnel", {
      params: { days: 30, includeBots: true },
    });
    expect(result).toEqual(data);

    mockGet.mockResolvedValueOnce({ data });
    await adminApi.getConversionFunnel(30, false, true);
    expect(mockGet).toHaveBeenLastCalledWith("/admin/analytics/funnel", {
      params: { days: 30, includeBots: false, includeInternal: true },
    });
  });

  it("getContentReport calls GET /admin/analytics/content with window and flags", async () => {
    const data = { categories: [] };
    mockGet.mockResolvedValueOnce({ data });

    const result = await adminApi.getContentReport(30, true, true);

    expect(mockGet).toHaveBeenCalledWith("/admin/analytics/content", {
      params: { days: 30, includeBots: true, includeInternal: true },
    });
    expect(result).toEqual(data);
  });

  it("getQuestionQualityReport calls GET /admin/analytics/question-quality with minAnswers", async () => {
    const data = { items: [] };
    mockGet.mockResolvedValueOnce({ data });

    const result = await adminApi.getQuestionQualityReport(30, 5, false);

    expect(mockGet).toHaveBeenCalledWith("/admin/analytics/question-quality", {
      params: { days: 30, minAnswers: 5, includeBots: false },
    });
    expect(result).toEqual(data);
  });

  it("getLearningReport calls GET /admin/analytics/learning with window and bot flag", async () => {
    const data = { scopes: [] };
    mockGet.mockResolvedValueOnce({ data });

    const result = await adminApi.getLearningReport(30, true);

    expect(mockGet).toHaveBeenCalledWith("/admin/analytics/learning", {
      params: { days: 30, includeBots: true },
    });
    expect(result).toEqual(data);

    mockGet.mockResolvedValueOnce({ data });
    await adminApi.getLearningReport(30, false, true);
    expect(mockGet).toHaveBeenLastCalledWith("/admin/analytics/learning", {
      params: { days: 30, includeBots: false, includeInternal: true },
    });
  });

  it("sends includeInternal only when internal traffic is requested", async () => {
    mockGet.mockResolvedValue({ data: {} });

    await adminApi.getPageViewSessions(7);
    expect(mockGet.mock.calls[0][1].params).not.toHaveProperty("includeInternal");

    await adminApi.getPageViewSessions(7, "all", undefined, false, "recent", 1, 25, 10, true);
    expect(mockGet.mock.calls[1][1].params.includeInternal).toBe(true);

    await adminApi.getPageViewAnalytics(7, "all", undefined, 1, 25, 10, false, true);
    expect(mockGet.mock.calls[2][1].params.includeInternal).toBe(true);

    await adminApi.getPageViewSessionDetail("s-1", true);
    expect(mockGet).toHaveBeenLastCalledWith("/admin/page-view-sessions/s-1", {
      params: { includeInternal: true },
    });

    await adminApi.getUsers(undefined, 30, "all", 1, 25, true);
    expect(mockGet.mock.calls[4][1].params.includeInternal).toBe(true);

    await adminApi.getUserActivity("u-1", 30, undefined, 1, 25, true);
    expect(mockGet.mock.calls[5][1].params.includeInternal).toBe(true);
  });

  it("setUserInternal calls PUT /admin/users/{id}/internal", async () => {
    mockPut.mockResolvedValueOnce({ data: { id: "u-1", isInternal: true } });

    const result = await adminApi.setUserInternal("u-1", true);

    expect(mockPut).toHaveBeenCalledWith("/admin/users/u-1/internal", { isInternal: true });
    expect(result).toEqual({ id: "u-1", isInternal: true });
  });

  it("getUsers calls GET /admin/users with defaults", async () => {
    const data = { summary: {}, users: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 0 };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getUsers();
    expect(mockGet).toHaveBeenCalledWith("/admin/users", expect.objectContaining({
      params: expect.objectContaining({ activityDays: 30, activityFilter: "all", page: 1, pageSize: 25 }),
    }));
    expect(result).toEqual(data);
  });

  it("getUsers includes trimmed search when provided", async () => {
    mockGet.mockResolvedValueOnce({ data: { users: [] } });
    await adminApi.getUsers("  alice  ");
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.search).toBe("alice");
  });

  it("getUserActivity calls GET /admin/users/:id/page-view-history", async () => {
    const data = { user: {}, summary: {}, urlHistory: [], totalCount: 0, page: 1, pageSize: 25, totalPages: 0 };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getUserActivity("u1");
    expect(mockGet).toHaveBeenCalledWith("/admin/users/u1/page-view-history", expect.any(Object));
    expect(result).toEqual(data);
  });

  it("getUserSettings calls GET /admin/users/:id/settings", async () => {
    const data = { settings: { SomeOtherKey: "51200" } };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getUserSettings("u1");
    expect(mockGet).toHaveBeenCalledWith("/admin/users/u1/settings");
    expect(result).toEqual(data);
  });

  it("updateUserSetting calls PUT /admin/users/:id/settings", async () => {
    const data = { key: "SomeOtherKey", value: "100000", updatedAt: "" };
    mockPut.mockResolvedValueOnce({ data });
    const result = await adminApi.updateUserSetting("u1", "SomeOtherKey", "100000");
    expect(mockPut).toHaveBeenCalledWith("/admin/users/u1/settings", { key: "SomeOtherKey", value: "100000" });
    expect(result).toEqual(data);
  });

  it("getPendingKeywords calls GET /admin/keywords/pending", async () => {
    const data = { keywords: [] };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getPendingKeywords();
    expect(mockGet).toHaveBeenCalledWith("/admin/keywords/pending");
    expect(result).toEqual(data);
  });

  it("approveKeyword calls POST /admin/keywords/:id/approve", async () => {
    const data = { id: "k1", name: "capitals", isPrivate: false, isReviewPending: false, createdAt: "" };
    mockPost.mockResolvedValueOnce({ data });
    const result = await adminApi.approveKeyword("k1");
    expect(mockPost).toHaveBeenCalledWith("/admin/keywords/k1/approve");
    expect(result).toEqual(data);
  });

  it("rejectKeyword calls POST /admin/keywords/:id/reject", async () => {
    const data = { id: "k1", name: "capitals", isPrivate: false, isReviewPending: false, createdAt: "" };
    mockPost.mockResolvedValueOnce({ data });
    const result = await adminApi.rejectKeyword("k1");
    expect(mockPost).toHaveBeenCalledWith("/admin/keywords/k1/reject");
    expect(result).toEqual(data);
  });

  it("previewSeedSync calls POST /admin/seed-sync/preview", async () => {
    const data = {
      repositoryOwner: "quizymode",
      repositoryName: "quizymode",
      gitRef: "main",
      resolvedCommitSha: "abc123",
      itemsPath: "data/seed-source/items",
      sourceFileCount: 12,
      seedSet: "test",
      totalItemsInPayload: 0,
      existingItemCount: 0,
      affectedItemCount: 0,
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      unchangedCount: 0,
      hasMoreChanges: false,
      changes: [],
    };
    mockPost.mockResolvedValueOnce({ data });
    const payload = { schemaVersion: 2, repositoryOwner: "quizymode", repositoryName: "quizymode", gitRef: "main" };
    const result = await adminApi.previewSeedSync(payload);
    expect(mockPost).toHaveBeenCalledWith("/admin/seed-sync/preview", payload);
    expect(result).toEqual(data);
  });

  it("applySeedSync calls POST /admin/seed-sync/apply", async () => {
    const data = {
      repositoryOwner: "quizymode",
      repositoryName: "quizymode",
      gitRef: "main",
      resolvedCommitSha: "abc123",
      itemsPath: "data/seed-source/items",
      sourceFileCount: 12,
      seedSet: "test",
      totalItemsInPayload: 0,
      existingItemCount: 0,
      affectedItemCount: 0,
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      unchangedCount: 0,
      historyRunId: "run1",
      historyRecordedUtc: "2026-04-05T00:00:00Z",
      hasMoreChanges: false,
      changes: [],
    };
    mockPost.mockResolvedValueOnce({ data });
    const payload = { schemaVersion: 2, repositoryOwner: "quizymode", repositoryName: "quizymode", gitRef: "main" };
    const result = await adminApi.applySeedSync(payload);
    expect(mockPost).toHaveBeenCalledWith("/admin/seed-sync/apply", payload);
    expect(result).toEqual(data);
  });

  it("getSeedSyncHistory calls GET /admin/seed-sync/history with defaults", async () => {
    const data = { runs: [] };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getSeedSyncHistory();
    expect(mockGet).toHaveBeenCalledWith(
      "/admin/seed-sync/history",
      expect.objectContaining({
        params: expect.objectContaining({ take: 5, changesPerRun: 10 }),
      })
    );
    expect(result).toEqual(data);
  });

  it("getCategoryKeywords calls GET /admin/keywords", async () => {
    const data = { keywords: [] };
    mockGet.mockResolvedValueOnce({ data });
    const result = await adminApi.getCategoryKeywords("geography", 1);
    const [, opts] = mockGet.mock.calls[0];
    expect(opts.params.category).toBe("geography");
    expect(opts.params.rank).toBe(1);
    expect(result).toEqual(data);
  });

  it("createCategoryKeyword calls POST /admin/category-keywords", async () => {
    const data = { id: "ck1", categoryId: "c1", categoryName: "geo", keywordId: "k1", keywordName: "cap", navigationRank: 1, parentName: null, sortRank: 0 };
    mockPost.mockResolvedValueOnce({ data });
    const result = await adminApi.createCategoryKeyword({ categoryId: "c1", childKeywordId: "k1" });
    expect(mockPost).toHaveBeenCalledWith("/admin/category-keywords", { categoryId: "c1", childKeywordId: "k1" });
    expect(result).toEqual(data);
  });

  it("deleteCategoryKeyword calls DELETE /admin/category-keywords/:id", async () => {
    mockDelete.mockResolvedValueOnce({});
    await adminApi.deleteCategoryKeyword("ck1");
    expect(mockDelete).toHaveBeenCalledWith("/admin/category-keywords/ck1");
  });

  it("deleteCategory calls DELETE /admin/categories/:id", async () => {
    mockDelete.mockResolvedValueOnce({});
    await adminApi.deleteCategory("cat1");
    expect(mockDelete).toHaveBeenCalledWith("/admin/categories/cat1");
  });
});
