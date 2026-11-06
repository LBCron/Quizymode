import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import PageViewAnalyticsPage from "./PageViewAnalyticsPage";

const VISITOR = "8f14e45f-ceea-4672-9a3b-1f2d3c4b5a69";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isAdmin: true }),
}));
vi.mock("@/api/admin", () => ({ adminApi: { getPageViewAnalytics: vi.fn() } }));
vi.mock("../components/InternalBrowserToggle", () => ({ default: () => null }));
vi.mock("../components/AcquisitionTab", () => ({ default: () => null }));
vi.mock("../components/FunnelTab", () => ({ default: () => null }));
vi.mock("../components/LearningTab", () => ({ default: () => null }));
vi.mock("../components/ContentTab", () => ({ default: () => null }));
vi.mock("../components/LifecycleTab", () => ({ default: () => null }));
vi.mock("../components/QuestionQualityTab", () => ({ default: () => null }));
vi.mock("../components/TrendsTab", () => ({ default: () => null }));
vi.mock("../components/SessionsTab", () => ({
  default: (props: {
    sessionId?: string;
    visitorId?: string;
    onSessionIdChange?: (value: string | undefined) => void;
  }) => (
    <div>
      <div data-testid="session">{props.sessionId ?? "none"}</div>
      <div data-testid="visitor">{props.visitorId ?? "none"}</div>
      <button onClick={() => props.onSessionIdChange?.("picked-1")}>pick</button>
      <button onClick={() => props.onSessionIdChange?.(undefined)}>clear</button>
    </div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="search">{location.search}</div>;
}

function renderAt(url: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <PageViewAnalyticsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PageViewAnalyticsPage URL state", () => {
  it("reads the session and visitor filters from the URL", () => {
    renderAt(`/admin/page-views?tab=sessions&session=abc-1&visitor=${VISITOR}`);

    expect(screen.getByTestId("session")).toHaveTextContent("abc-1");
    expect(screen.getByTestId("visitor")).toHaveTextContent(VISITOR);
  });

  it("ignores an invalid visitor id and an over-length session id", () => {
    renderAt(`/admin/page-views?tab=sessions&session=${"x".repeat(129)}&visitor=nope`);

    expect(screen.getByTestId("session")).toHaveTextContent("none");
    expect(screen.getByTestId("visitor")).toHaveTextContent("none");
  });

  it("writes and clears the session filter in the URL", async () => {
    renderAt("/admin/page-views?tab=sessions");

    await userEvent.click(screen.getByText("pick"));
    expect(screen.getByTestId("search")).toHaveTextContent("session=picked-1");

    await userEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("search").textContent).not.toContain("session=");
  });

  it("drops the filters when switching tabs", async () => {
    renderAt("/admin/page-views?tab=sessions&session=abc-1");

    await userEvent.click(screen.getByRole("button", { name: /Funnel/ }));
    const search = screen.getByTestId("search").textContent ?? "";
    expect(search).toContain("tab=funnel");
    expect(search).not.toContain("session=");
  });
});
