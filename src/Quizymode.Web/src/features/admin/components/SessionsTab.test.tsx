import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SessionsTab from "./SessionsTab";

const { mockAdminApi } = vi.hoisted(() => ({
  mockAdminApi: {
    getPageViewSessions: vi.fn(),
    getPageViewSessionDetail: vi.fn(),
  },
}));

vi.mock("@/api/admin", () => ({
  adminApi: mockAdminApi,
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: () => <div>Loading...</div>,
}));
vi.mock("@/components/ErrorMessage", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

const baseResponse = {
  summary: {
    windowStartUtc: "2026-07-19T00:00:00Z",
    windowEndUtc: "2026-07-26T00:00:00Z",
    totalSessions: 10,
    totalPageHits: 18,
    bouncedSessions: 7,
    bounceRatePercent: 70,
    engagedSessions: 3,
    avgPagesPerSession: 1.8,
    avgDurationSecondsEngaged: 200,
    medianDurationSecondsEngaged: 180,
    botSessions: 4,
    botsExcluded: true,
    internalSessions: 2,
    internalExcluded: true,
    byOutcome: [
      {
        outcome: "anonymous" as const,
        sessions: 8,
        bouncedSessions: 7,
        bounceRatePercent: 87.5,
        engagedSessions: 1,
        avgPagesPerSession: 1.3,
      },
      {
        outcome: "converted" as const,
        sessions: 1,
        bouncedSessions: 0,
        bounceRatePercent: 0,
        engagedSessions: 1,
        avgPagesPerSession: 4,
      },
      {
        outcome: "authenticated" as const,
        sessions: 1,
        bouncedSessions: 0,
        bounceRatePercent: 0,
        engagedSessions: 1,
        avgPagesPerSession: 5,
      },
    ],
    studySessions: 3,
    avgItemStepsPerStudySession: 4.5,
  },
  depthBuckets: [
    {
      label: "1 page",
      totalSessions: 7,
      anonymousSessions: 7,
      convertedSessions: 0,
      authenticatedSessions: 0,
    },
    {
      label: "2 pages",
      totalSessions: 1,
      anonymousSessions: 1,
      convertedSessions: 0,
      authenticatedSessions: 0,
    },
    {
      label: "3-5 pages",
      totalSessions: 2,
      anonymousSessions: 0,
      convertedSessions: 1,
      authenticatedSessions: 1,
    },
    {
      label: "6-10 pages",
      totalSessions: 0,
      anonymousSessions: 0,
      convertedSessions: 0,
      authenticatedSessions: 0,
    },
    {
      label: "11+ pages",
      totalSessions: 0,
      anonymousSessions: 0,
      convertedSessions: 0,
      authenticatedSessions: 0,
    },
  ],
  landingPages: [
    {
      path: "/promo",
      sessions: 6,
      bouncedSessions: 6,
      bounceRatePercent: 100,
      avgPagesPerSession: 1,
      area: "other",
      scopeType: null,
      scopeKey: null,
    },
    {
      path: "/quiz/geography",
      sessions: 3,
      bouncedSessions: 1,
      bounceRatePercent: 33.3,
      avgPagesPerSession: 5,
      area: "quiz",
      scopeType: "category" as const,
      scopeKey: "geography",
    },
  ],
  sessions: [
    {
      sessionId: "session-abc",
      outcome: "converted" as const,
      startedUtc: "2026-07-25T10:00:00Z",
      endedUtc: "2026-07-25T10:05:00Z",
      pageHits: 4,
      distinctPages: 3,
      durationSeconds: 300,
      isBounce: false,
      entryPath: "/",
      exitPath: "/collections",
      ipAddress: "198.51.100.4",
      country: "US",
      userEmail: "visitor@example.com",
      userAgent: "Mozilla/5.0",
      isBot: false,
      isInternal: false,
      entryArea: "home",
      itemSteps: 0,
    },
  ],
  totalCount: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionsTab
        days={7}
        includeBots={false}
        formatDateTime={(value) => value}
      />
    </QueryClientProvider>
  );
}

describe("SessionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminApi.getPageViewSessions.mockResolvedValue(baseResponse);
  });

  it("surfaces bounce rate and engaged sessions", async () => {
    renderTab();

    expect(await screen.findByText("70%")).toBeInTheDocument();
    expect(
      screen.getByText("7 of 10 sessions saw one page")
    ).toBeInTheDocument();
    expect(screen.getByText("Visited 2+ distinct pages")).toBeInTheDocument();
  });

  it("explains how many bot sessions were excluded", async () => {
    renderTab();

    const banner = await screen.findByText(
      /bot sessions were excluded from these numbers/i
    );
    expect(banner.textContent).toContain("4 bot sessions were excluded");
  });

  it("explains how many internal sessions were excluded", async () => {
    renderTab();

    const banner = await screen.findByText(/internal sessions were excluded/i);
    expect(banner.textContent).toContain("2 internal sessions were excluded");
  });

  it("badges internal sessions and opts their journey lookup into internal traffic", async () => {
    mockAdminApi.getPageViewSessions.mockResolvedValue({
      ...baseResponse,
      summary: { ...baseResponse.summary, internalExcluded: false },
      sessions: [{ ...baseResponse.sessions[0], isInternal: true }],
    });
    mockAdminApi.getPageViewSessionDetail.mockResolvedValue({
      ...baseResponse.sessions[0],
      isInternal: true,
      steps: [],
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionsTab days={7} includeBots={false} includeInternal formatDateTime={(value) => value} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Internal")).toBeInTheDocument();
    expect(mockAdminApi.getPageViewSessions).toHaveBeenCalledWith(
      7, "all", undefined, false, "recent", 1, 25, 10, true, undefined, undefined, undefined
    );
    expect(screen.queryByText(/internal sessions? (was|were) excluded/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await waitFor(() =>
      expect(mockAdminApi.getPageViewSessionDetail).toHaveBeenCalledWith(
        baseResponse.sessions[0].sessionId,
        true
      )
    );
  });

  it("shows the per-outcome engagement split", async () => {
    renderTab();

    // Anchor on a cell unique to the engagement table, then scope to it:
    // "Anonymous" also appears in the histogram legend and the visitor filter.
    const outcomeTable = (await screen.findByText("7 (87.5%)")).closest("table");
    expect(outcomeTable).not.toBeNull();

    const outcomeRows = within(outcomeTable as HTMLTableElement);
    expect(outcomeRows.getByText("Anonymous")).toBeInTheDocument();
    expect(outcomeRows.getByText("Converted")).toBeInTheDocument();
    expect(outcomeRows.getByText("Authenticated")).toBeInTheDocument();
  });

  it("summarizes study activity and groups landing by area and scope", async () => {
    renderTab();

    expect(await screen.findByText("Sessions with study activity")).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.getByText("category: geography")).toBeInTheDocument();
    expect(screen.getByText("e.g. /quiz/geography")).toBeInTheDocument();
  });

  it("flags a landing page where every visitor bounced", async () => {
    renderTab();

    expect(await screen.findByText("e.g. /promo")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("loads a session journey only once the row is expanded", async () => {
    mockAdminApi.getPageViewSessionDetail.mockResolvedValue({
      sessionId: "session-abc",
      outcome: "converted",
      startedUtc: "2026-07-25T10:00:00Z",
      endedUtc: "2026-07-25T10:05:00Z",
      pageHits: 2,
      distinctPages: 2,
      durationSeconds: 300,
      isBounce: false,
      ipAddress: "198.51.100.4",
      country: "US",
      userEmail: "visitor@example.com",
      userAgent: "Mozilla/5.0",
      isBot: false,
      isInternal: false,
      steps: [
        {
          stepNumber: 1,
          path: "/",
          queryString: "",
          url: "/",
          isAuthenticated: false,
          createdUtc: "2026-07-25T10:00:00Z",
          dwellSeconds: 120,
          area: "home",
          isItemStep: false,
        },
        {
          stepNumber: 2,
          path: "/collections",
          queryString: "",
          url: "/collections",
          isAuthenticated: true,
          createdUtc: "2026-07-25T10:02:00Z",
          dwellSeconds: null,
          area: "collections",
          isItemStep: false,
        },
      ],
    });

    renderTab();

    const toggle = await screen.findByRole("button", {
      name: /2026-07-25T10:00:00Z/,
    });
    expect(mockAdminApi.getPageViewSessionDetail).not.toHaveBeenCalled();

    await userEvent.click(toggle);

    await waitFor(() =>
      expect(mockAdminApi.getPageViewSessionDetail).toHaveBeenCalledWith(
        "session-abc",
        false
      )
    );

    expect(await screen.findByText("stayed 2m")).toBeInTheDocument();
    // Each journey step is labelled with its feature area.
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getAllByText("Collections").length).toBeGreaterThan(0);
    // The last page has no exit event, so its dwell time must not read as zero.
    expect(screen.getByText("last page — dwell unknown")).toBeInTheDocument();
  });

  it("requests only multi-page sessions when bounces are hidden", async () => {
    renderTab();

    await screen.findByText("70%");

    await userEvent.click(screen.getByLabelText("Hide bounces"));

    await waitFor(() =>
      expect(mockAdminApi.getPageViewSessions).toHaveBeenLastCalledWith(
        7,
        "all",
        2,
        false,
        "recent",
        1,
        25,
        10,
        false,
        undefined,
        undefined,
        undefined
      )
    );
  });

  it("filters the session list by outcome", async () => {
    renderTab();

    await screen.findByText("70%");

    await userEvent.selectOptions(
      screen.getByLabelText("Visitor type"),
      "anonymous"
    );

    await waitFor(() =>
      expect(mockAdminApi.getPageViewSessions).toHaveBeenLastCalledWith(
        7,
        "anonymous",
        undefined,
        false,
        "recent",
        1,
        25,
        10,
        false,
        undefined,
        undefined,
        undefined
      )
    );
  });

  it("renders an error state when the report fails", async () => {
    mockAdminApi.getPageViewSessions.mockRejectedValue(new Error("boom"));

    renderTab();

    expect(
      await screen.findByText("Failed to load session analytics")
    ).toBeInTheDocument();
  });
});
