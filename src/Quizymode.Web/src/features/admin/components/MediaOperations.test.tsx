import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { apiClient } from "@/api/client";
import { mediaApi } from "@/api/media";
import { MediaOperations } from "./MediaOperations";
vi.mock("@/api/client", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("@/api/media", () => ({ mediaApi: { content: vi.fn() } }));
const report = { id: "report-1", itemId: "item-1", assetId: "11111111-1111-1111-1111-111111111111", revision: 7, slot: "question", category: "harassment", createdAt: "2026-01-01T00:00:00Z" };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:reported-normalized"), revokeObjectURL: vi.fn() }); });
async function showReport(revision: number | undefined) {
  vi.mocked(apiClient.get).mockImplementation(async route => ({ data: route === "/admin/media/reports" ? [{ ...report, revision }] : { uploadsEnabled: true, deliveryEnabled: true, advisoryEnabled: false } }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MediaOperations /></QueryClientProvider></MemoryRouter>);
  const details = screen.getByText("Picture reports and emergency controls").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await screen.findByText(/harassment/);
}
it("previews the exact current report revision through the item-bound resolver", async () => {
  vi.mocked(mediaApi.content).mockResolvedValue(new Blob(["normalized"], { type: "image/webp" }));
  await showReport(report.revision); const picture = await screen.findByRole("img", { name: "Reported picture" });
  expect(picture).toHaveAttribute("src", "blob:reported-normalized"); fireEvent.load(picture);
  expect(screen.getByRole("button", { name: "Enlarge picture" })).toBeEnabled();
  expect(mediaApi.content).toHaveBeenCalledExactlyOnceWith("item-1", "question", undefined, expect.any(AbortSignal), 7);
});
it("leaves a stale report unavailable without unbound or asset fallback", async () => {
  vi.mocked(mediaApi.content).mockRejectedValue(new Error("404")); await showReport(report.revision);
  await screen.findByText("Picture couldn't load"); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(mediaApi.content).toHaveBeenCalledExactlyOnceWith("item-1", "question", undefined, expect.any(AbortSignal), 7);
});
it.each([undefined, 0, -1])("fails closed without a valid report revision %s", async revision => {
  await showReport(revision); await waitFor(() => expect(screen.getByText("Picture isn't available")).toBeInTheDocument());
  expect(mediaApi.content).not.toHaveBeenCalled();
});
