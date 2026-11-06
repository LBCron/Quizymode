import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LifecycleTab from "./LifecycleTab";

const { mockGetLifecycleReport } = vi.hoisted(() => ({ mockGetLifecycleReport: vi.fn() }));

vi.mock("@/api/admin", () => ({
  adminApi: { getLifecycleReport: mockGetLifecycleReport },
}));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LifecycleTab />
    </QueryClientProvider>
  );
}

describe("LifecycleTab", () => {
  beforeEach(() => {
    mockGetLifecycleReport.mockReset();
  });

  it("renders cohorts with active over eligible and the source table", async () => {
    mockGetLifecycleReport.mockResolvedValue({
      windowStartUtc: "2026-08-01T00:00:00Z",
      windowEndUtc: "2026-10-01T00:00:00Z",
      totalSignups: 4,
      cohorts: [
        {
          weekStartUtc: "2026-09-07T00:00:00Z",
          signups: 4,
          activated7Days: 2,
          activatedEligible: 4,
          activeWeek1: 1,
          eligibleWeek1: 4,
          activeWeek2: 0,
          eligibleWeek2: 0,
          activeWeek4: 0,
          eligibleWeek4: 0,
        },
      ],
      sources: [
        {
          channel: "paid-search",
          campaign: "spring",
          signups: 3,
          activated7Days: 1,
          activatedEligible: 3,
          activeWeek1: 1,
          eligibleWeek1: 3,
        },
      ],
    });

    renderTab();

    expect(await screen.findByText("2026-09-07")).toBeInTheDocument();
    expect(screen.getByText("2 / 4 (50%)")).toBeInTheDocument();
    expect(screen.getByText("1 / 4 (25%)")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("paid-search")).toBeInTheDocument();
    expect(screen.getByText("spring")).toBeInTheDocument();
  });

  it("requests a different number of weeks", async () => {
    mockGetLifecycleReport.mockResolvedValue({
      windowStartUtc: "",
      windowEndUtc: "",
      totalSignups: 0,
      cohorts: [],
      sources: [],
    });

    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "25w" }));

    await waitFor(() => expect(mockGetLifecycleReport).toHaveBeenCalledWith(25));
    expect(await screen.findByText("No signups in this period.")).toBeInTheDocument();
  });

  it("shows an error when loading fails", async () => {
    mockGetLifecycleReport.mockRejectedValue(new Error("boom"));

    renderTab();

    expect(await screen.findByText("Failed to load the lifecycle report")).toBeInTheDocument();
  });
});
