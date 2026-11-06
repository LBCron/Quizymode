import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SessionsTab from "./SessionsTab";

const { mockAdminApi } = vi.hoisted(() => ({
  mockAdminApi: {
    getPageViewSessions: vi.fn(),
    getPageViewSessionDetail: vi.fn(),
  },
}));

vi.mock("@/api/admin", () => ({ adminApi: mockAdminApi }));
vi.mock("@/components/LoadingSpinner", () => ({ default: () => <div>Loading...</div> }));
vi.mock("@/components/ErrorMessage", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));

const VISITOR = "8f14e45f-ceea-4672-9a3b-1f2d3c4b5a69";

const session = {
  sessionId: "session-abc",
  outcome: "anonymous" as const,
  startedUtc: "2026-07-25T10:00:00Z",
  endedUtc: "2026-07-25T10:05:00Z",
  pageHits: 3,
  distinctPages: 3,
  durationSeconds: 300,
  isBounce: false,
  entryPath: "/",
  exitPath: "/quiz",
  ipAddress: "198.51.100.10",
  country: "US",
  userEmail: null,
  userAgent: "Mozilla/5.0",
  isBot: false,
  isInternal: false,
  entryArea: "home",
  itemSteps: 0,
  visitorId: VISITOR,
  visitorType: "returning" as const,
  sessionsFromVisitor: 3,
  channel: "search",
  gamesPlayed: 2,
  gamesCompleted: 1,
  quizRuns: 1,
  quizzesCompleted: 1,
};

const response = {
  summary: {
    windowStartUtc: "2026-07-19T00:00:00Z",
    windowEndUtc: "2026-07-26T00:00:00Z",
    totalSessions: 1,
    totalPageHits: 3,
    bouncedSessions: 0,
    bounceRatePercent: 0,
    engagedSessions: 1,
    avgPagesPerSession: 3,
    avgDurationSecondsEngaged: 300,
    medianDurationSecondsEngaged: 300,
    botSessions: 0,
    botsExcluded: true,
    internalSessions: 0,
    internalExcluded: true,
    byOutcome: [],
    studySessions: 0,
    avgItemStepsPerStudySession: 0,
  },
  depthBuckets: [],
  landingPages: [],
  sessions: [session],
  totalCount: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  visitors: undefined,
};

const detail = {
  ...session,
  steps: [
    {
      stepNumber: 1,
      path: "/quiz",
      queryString: "?x=1",
      url: "/quiz?x=1",
      isAuthenticated: false,
      createdUtc: "2026-07-25T10:00:00Z",
      dwellSeconds: 60,
      area: "quiz",
      isItemStep: false,
    },
    {
      stepNumber: 2,
      path: "//evil.test/x",
      queryString: "",
      url: "//evil.test/x",
      isAuthenticated: false,
      createdUtc: "2026-07-25T10:01:00Z",
      dwellSeconds: null,
      area: "other",
      isItemStep: false,
    },
  ],
  activities: [
    {
      kind: "quiz" as const,
      runId: "r1",
      contextType: "category",
      contextId: "science",
      startedUtc: "2026-07-25T10:01:00Z",
      completedUtc: "2026-07-25T10:03:00Z",
      score: 4,
      total: 5,
    },
    {
      kind: "game" as const,
      runId: "r2",
      contextType: null,
      contextId: null,
      startedUtc: "2026-07-25T10:04:00Z",
      completedUtc: null,
      score: null,
      total: null,
    },
  ],
};

function renderTab(props: Partial<React.ComponentProps<typeof SessionsTab>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionsTab days={7} includeBots={false} formatDateTime={(v) => v} {...props} />
    </QueryClientProvider>
  );
}

describe("SessionsTab session filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminApi.getPageViewSessions.mockResolvedValue(response);
    mockAdminApi.getPageViewSessionDetail.mockResolvedValue(detail);
  });

  it("passes the session and visitor filters to the API and shows chips", async () => {
    renderTab({ sessionId: "session-abc", visitorId: VISITOR });

    await screen.findByText("Visitor:");
    expect(mockAdminApi.getPageViewSessions).toHaveBeenCalledWith(
      7, "all", undefined, false, "recent", 1, 25, 10, false, undefined, "session-abc", VISITOR
    );
    expect(screen.getByLabelText("Session id")).toHaveValue("session-abc");
  });

  it("applies a trimmed session id and clears it", async () => {
    const onSessionIdChange = vi.fn();
    renderTab({ onSessionIdChange });

    await screen.findByLabelText("Session id");
    await userEvent.type(screen.getByLabelText("Session id"), "  abc-123 ");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSessionIdChange).toHaveBeenLastCalledWith("abc-123");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSessionIdChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText("Session id")).toHaveValue("");
  });

  it("rejects an over-length session id without calling onSessionIdChange", async () => {
    const onSessionIdChange = vi.fn();
    renderTab({ onSessionIdChange });

    await screen.findByLabelText("Session id");
    await userEvent.type(screen.getByLabelText("Session id"), "x".repeat(129));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/1-128 characters/);
    expect(onSessionIdChange).not.toHaveBeenCalled();
  });

  it("removes the session filter through its chip", async () => {
    const onSessionIdChange = vi.fn();
    renderTab({ sessionId: "session-abc", onSessionIdChange });

    await userEvent.click(await screen.findByLabelText("Remove session filter"));
    expect(onSessionIdChange).toHaveBeenCalledWith(undefined);
  });

  it("shows visitor type, games and quiz runs in the row", async () => {
    renderTab();

    expect(await screen.findByText(/Returning visitor · search/)).toBeInTheDocument();
    expect(screen.getByText(/2 games \(1 completed\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 quiz run \(1 completed\)/)).toBeInTheDocument();
  });

  it("shows the stored city, region and country as approximate, with the truncated IP", async () => {
    mockAdminApi.getPageViewSessions.mockResolvedValue({
      ...response,
      sessions: [{ ...session, ipAddress: "198.51.100.0/24", city: "Seattle", region: "Washington" }],
    });
    renderTab();

    expect(await screen.findByText("Seattle, Washington, US")).toBeInTheDocument();
    expect(screen.getByText("(approximate)")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.0/24")).toBeInTheDocument();
  });

  it("renders relative journey steps as new-tab links and others as text", async () => {
    renderTab();

    await userEvent.click(await screen.findByRole("button", { name: /2026-07-25T10:00:00Z/ }));

    const link = await screen.findByRole("link", { name: "/quiz?x=1" });
    expect(link).toHaveAttribute("href", "/quiz?x=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("//evil.test/x")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "//evil.test/x" })).toBeNull();
  });

  it("filters to a session and to a visitor from the expanded row", async () => {
    const onSessionIdChange = vi.fn();
    const onVisitorIdChange = vi.fn();
    renderTab({ onSessionIdChange, onVisitorIdChange });

    await userEvent.click(await screen.findByRole("button", { name: /2026-07-25T10:00:00Z/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Filter to this session" }));
    expect(onSessionIdChange).toHaveBeenCalledWith("session-abc");

    await userEvent.click(screen.getByRole("button", { name: "3 sessions from this visitor" }));
    expect(onVisitorIdChange).toHaveBeenCalledWith(VISITOR);
  });

  it("states that visitor history is unavailable when there is no visitor id", async () => {
    mockAdminApi.getPageViewSessionDetail.mockResolvedValue({
      ...detail,
      visitorId: null,
      visitorType: "unknown",
      sessionsFromVisitor: 0,
    });
    renderTab({ onVisitorIdChange: vi.fn() });

    await userEvent.click(await screen.findByRole("button", { name: /2026-07-25T10:00:00Z/ }));
    expect(await screen.findByText("Visitor history unavailable")).toBeInTheDocument();
  });

  it("lists the session's activities", async () => {
    renderTab();

    await userEvent.click(await screen.findByRole("button", { name: /2026-07-25T10:00:00Z/ }));

    await waitFor(() => expect(screen.getByText("Activities")).toBeInTheDocument());
    expect(screen.getByText(/completed, score 4\/5/)).toBeInTheDocument();
    expect(screen.getByText("not completed")).toBeInTheDocument();
    expect(screen.getByText("category: science")).toBeInTheDocument();
  });
});
