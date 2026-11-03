import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminOverviewPanel from "./AdminOverviewPanel";
import { formatChange, layoutReleaseLabels } from "./overviewFormatting";

const { mockAdminApi } = vi.hoisted(() => ({
  mockAdminApi: { getAnalyticsOverview: vi.fn() },
}));

vi.mock("@/api/admin", () => ({ adminApi: mockAdminApi }));
vi.mock("@/components/LoadingSpinner", () => ({ default: () => <div>Loading...</div> }));
vi.mock("@/components/ErrorMessage", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

const kpis = {
  humanSessions: 30,
  engagedSessions: 12,
  studySessions: 8,
  convertedSessions: 2,
  newSignups: 3,
  activeRegisteredUsers: 5,
  newVisitors: 20,
  returningVisitors: null,
};

const populated = {
  days: 7,
  windowStartDay: "2026-10-10",
  windowEndDay: "2026-10-16",
  current: kpis,
  previous: { ...kpis, humanSessions: 20, newSignups: 0, studySessions: 0 },
  daily: ["10", "11", "12"].map((d, i) => ({
    day: `2026-10-${d}`,
    humanSessions: i * 5,
    engagedSessions: i,
    studySessions: i,
    convertedSessions: 0,
    newSignups: 0,
    activeRegisteredUsers: 0,
  })),
  releaseMarkers: [{ version: "3.64.0", day: "2026-10-11" }],
  workQueue: {
    itemsAwaitingReview: 4,
    pendingPrivateKeywords: 2,
    ideasAwaitingModeration: 1,
    newClientErrorGroups: 3,
    picturesAwaitingReview: 5,
    oldestPictureSubmittedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  },
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AdminOverviewPanel />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("formatChange", () => {
  it("shows 'new' instead of an infinite percentage when the previous window is zero", () => {
    expect(formatChange(5, 0)).toBe("new");
    expect(formatChange(0, 0)).toBeNull();
    expect(formatChange(15, 10)).toBe("+50%");
    expect(formatChange(5, 10)).toBe("-50%");
  });
});

describe("AdminOverviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminApi.getAnalyticsOverview.mockResolvedValue(populated);
  });

  it("shows a loading state first", () => {
    mockAdminApi.getAnalyticsOverview.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders KPI cards with change, release markers, and work queue links", async () => {
    renderPanel();

    const sessions = await screen.findByTestId("kpi-humanSessions");
    expect(sessions).toHaveTextContent("30");
    expect(sessions).toHaveTextContent("+50% vs previous 7d");
    expect(screen.getByTestId("kpi-newSignups")).toHaveTextContent("new vs previous 7d");
    expect(screen.getByTestId("kpi-returningVisitors")).toHaveTextContent("—");
    expect(screen.getAllByTestId("release-marker")).toHaveLength(1);
    expect(screen.getByText("v3.64.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /items awaiting review/i })).toHaveAttribute("href", "/admin/review-board");
    const pictures = screen.getByRole("link", { name: /pictures awaiting review/i });
    expect(pictures).toHaveAttribute("href", "/admin/review-board?tab=pictures");
    expect(pictures).toHaveTextContent("5");
    expect(pictures).toHaveTextContent("Oldest submitted 3 days ago");
    expect(screen.getByRole("link", { name: /pending private keywords/i })).toHaveAttribute("href", "/admin/keyword-review");
    expect(screen.getByRole("link", { name: /ideas awaiting moderation/i })).toHaveAttribute("href", "/admin/ideas");
  });

  it("omits the oldest-submitted line when no pictures are waiting", async () => {
    mockAdminApi.getAnalyticsOverview.mockResolvedValue({
      ...populated,
      workQueue: { ...populated.workQueue, picturesAwaitingReview: 0, oldestPictureSubmittedAt: null },
    });
    renderPanel();

    const pictures = await screen.findByRole("link", { name: /pictures awaiting review/i });
    expect(pictures).not.toHaveTextContent(/oldest submitted/i);
  });

  it("shows an empty state when there is no traffic", async () => {
    mockAdminApi.getAnalyticsOverview.mockResolvedValue({
      ...populated,
      current: { ...kpis, humanSessions: 0 },
      previous: { ...kpis, humanSessions: 0 },
      releaseMarkers: [],
    });
    renderPanel();
    expect(await screen.findByText(/no traffic recorded/i)).toBeInTheDocument();
  });

  it("shows an error and reloads when the range changes", async () => {
    mockAdminApi.getAnalyticsOverview.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    expect(await screen.findByText(/failed to load the analytics overview/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "30d" }));
    await waitFor(() => expect(mockAdminApi.getAnalyticsOverview).toHaveBeenCalledWith(30));
  });
});

describe("layoutReleaseLabels", () => {
  const RIGHT_EDGE = 632;

  it("moves a label on the next day to another row instead of overlapping", () => {
    const labels = layoutReleaseLabels(
      [
        { x: 300, version: "3.69.1" },
        { x: 315, version: "3.70.0" },
      ],
      RIGHT_EDGE
    );
    expect(labels.map((label) => label.row)).toEqual([0, 1]);
  });

  it("keeps far-apart labels on the first row", () => {
    const labels = layoutReleaseLabels(
      [
        { x: 100, version: "3.60.0" },
        { x: 300, version: "3.70.0" },
      ],
      RIGHT_EDGE
    );
    expect(labels.map((label) => label.row)).toEqual([0, 0]);
  });

  it("merges markers on the same day into one label", () => {
    const labels = layoutReleaseLabels(
      [
        { x: 200, version: "3.71.0" },
        { x: 200, version: "3.71.1" },
      ],
      RIGHT_EDGE
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe("v3.71.0, v3.71.1");
    expect(labels[0].versions).toEqual(["3.71.0", "3.71.1"]);
  });

  it("right-aligns a label that would run past the chart edge", () => {
    const [label] = layoutReleaseLabels([{ x: 630, version: "3.80.4" }], RIGHT_EDGE);
    expect(label.anchor).toBe("end");
  });

  it("puts any overflow on the last row", () => {
    const labels = layoutReleaseLabels(
      ["1", "2", "3", "4"].map((n, i) => ({ x: 300 + i * 5, version: `3.7${n}.0` })),
      RIGHT_EDGE
    );
    expect(labels.map((label) => label.row)).toEqual([0, 1, 2, 2]);
  });
});

