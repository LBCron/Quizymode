import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminLlmProvidersApi } from "./adminLlmProviders";

const { mockGet, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock("./client", () => ({
  apiClient: {
    get: mockGet,
    put: mockPut,
  },
}));

describe("adminLlmProvidersApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("get calls GET /admin/llm-providers", async () => {
    mockGet.mockResolvedValueOnce({ data: { vendors: [] } });
    await adminLlmProvidersApi.get();
    expect(mockGet).toHaveBeenCalledWith("/admin/llm-providers");
  });

  it("update puts models and routes", async () => {
    mockPut.mockResolvedValueOnce({ data: {} });
    const request = {
      vendors: [{ vendor: "Gemini" as const, model: "gemini-3.5-flash-lite" }],
      routes: { free: ["Gemini" as const], premium: ["OpenRouter" as const] },
    };
    await adminLlmProvidersApi.update(request);
    expect(mockPut).toHaveBeenCalledWith("/admin/llm-providers", request);
  });

  it("getAttempts passes the day window", async () => {
    mockGet.mockResolvedValueOnce({ data: { attempts: [] } });
    await adminLlmProvidersApi.getAttempts(30);
    expect(mockGet).toHaveBeenCalledWith("/admin/llm-providers/attempts", { params: { days: 30 } });
  });

  it("getUsage passes the day window and defaults to 30", async () => {
    mockGet.mockResolvedValue({ data: { days: 30, rows: [], topUsers: [] } });
    await adminLlmProvidersApi.getUsage();
    expect(mockGet).toHaveBeenLastCalledWith("/admin/llm-providers/usage", { params: { days: 30 } });
    await adminLlmProvidersApi.getUsage(7);
    expect(mockGet).toHaveBeenLastCalledWith("/admin/llm-providers/usage", { params: { days: 7 } });
  });
});
