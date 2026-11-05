import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import HomePage from "./HomePage";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { featuredApi } from "@/api/featured";
import { interestsApi } from "@/api/learningLoop";
import { usersApi } from "@/api/users";
import { studySessionsApi } from "@/api/studySessions";
import { studyPlansApi } from "@/api/studyPlans";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { renderWithProviders } from "@/features/learningLoop/learningLoopTestUtils";
import { writeLocalInterests } from "@/features/learningLoop/localLearningState";

// Layout rules for the personalized Home (#382). The base HomePage.test.tsx covers the default (guest, no topics) page.
const auth = vi.hoisted(() => ({
  value: { isAuthenticated: false, isLoading: false, userId: null as string | null },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/api/categories", () => ({ categoriesApi: { getAll: vi.fn() } }));
vi.mock("@/api/collections", () => ({ collectionsApi: { discover: vi.fn(), getById: vi.fn() } }));
vi.mock("@/api/featured", () => ({ featuredApi: { get: vi.fn() } }));
vi.mock("@/api/users", () => ({ usersApi: { getSettings: vi.fn(), updateSetting: vi.fn() } }));
vi.mock("@/api/studyPlans", () => ({ studyPlansApi: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() } }));
vi.mock("@/api/studySessions", () => ({ studySessionsApi: { list: vi.fn() } }));
vi.mock("@/api/learningLoop", () => ({
  interestsApi: { popularCategories: vi.fn(), get: vi.fn(), replace: vi.fn() },
  dailyQuizApi: { get: vi.fn() },
  reviewQueueApi: { getSummary: vi.fn() },
}));

const hero = () => screen.getByRole("heading", { name: /learn something new in five questions/i });
const exploreSummary = () => screen.getByText("Explore all topics").closest("summary")!;

function headingOrder(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent ?? "")
    .filter((text) => ["Today", "Continue", "For you", "Make Home yours"].includes(text));
}

describe("HomePage personalized layout (#382)", () => {
  it("#383: a refined choice keeps its full branch in topic and game links", async () => {
    writeLocalInterests(["languages/french/core"]);
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole("link", { name: "Languages › French › Core" })).toHaveAttribute("href", "/categories/languages/french/core");
    expect(screen.getByRole("link", { name: "Play a game in Languages › French › Core" })).toHaveAttribute("href", "/games/languages?nav=french%2Ccore");
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    window.sessionStorage.clear();
    auth.value = { isAuthenticated: false, isLoading: false, userId: null };
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [] });
    vi.mocked(collectionsApi.discover).mockResolvedValue({ items: [], totalCount: 0 });
    vi.mocked(featuredApi.get).mockResolvedValue({ sets: [], collections: [] });
    vi.mocked(interestsApi.popularCategories).mockResolvedValue([]);
    vi.mocked(studySessionsApi.list).mockResolvedValue([]);
    vi.mocked(studyPlansApi.list).mockResolvedValue([]);
    vi.mocked(usersApi.getSettings).mockResolvedValue({ settings: {} });
    const { dailyQuizApi, reviewQueueApi } = await import("@/api/learningLoop");
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-27", items: [], completion: null, streak: 0 });
    vi.mocked(reviewQueueApi.getSummary).mockResolvedValue({ dueCount: 0, totalCount: 0, nextDueAt: null });
  });

  it("guest with local topics gets the focused Home: compact hero, lanes in order, game link, collapsed catalog", async () => {
    writeLocalInterests(["science", "history"]);
    renderWithProviders(<HomePage />);

    expect(hero()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /play a 5-question quiz/i })).toBeInTheDocument();
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/five quick questions, from flags to space to AI/i)).not.toBeInTheDocument();
    expect(headingOrder()).toEqual(["Today", "For you"]);

    const game = screen.getByRole("link", { name: /Play a game in Science/ });
    expect(game).toHaveAttribute("href", "/games/science");

    const details = exploreSummary().closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText("Categories")).toBeInTheDocument();
    // The Explore section comes after the For-you lane and the game link.
    const order = [screen.getByRole("heading", { name: "For you" }), game, details];
    order.slice(1).forEach((node, index) => {
      expect(order[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(screen.queryByRole("region", { name: "Make Home yours" })).not.toBeInTheDocument();
  });

  it("guest with no topics keeps the full Home and never sees the onboarding card", async () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByText(/five quick questions, from flags to space to AI/i)).toBeInTheDocument();
    expect(screen.queryByText("Explore all topics")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Play a game in/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "For you" })).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("region", { name: "Make Home yours" })).not.toBeInTheDocument();
  });

  it("signed in while topics load: hero stays, a pending skeleton replaces the lanes", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<HomePage />);

    expect(hero()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /play a 5-question quiz/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your home");
    expect(screen.queryByRole("heading", { name: "Today" })).not.toBeInTheDocument();
    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
  });

  it("auth still loading with no local picks is pending below the hero", () => {
    auth.value = { isAuthenticated: false, isLoading: true, userId: null };
    renderWithProviders(<HomePage />);

    expect(hero()).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your home");
  });

  it("signed in with topics: focused Home, then the pending state resolves", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue(["history"]);
    renderWithProviders(<HomePage />);

    expect(await screen.findByText("Explore all topics")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/no account needed/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Play a game in History/ })).toHaveAttribute("href", "/games/history");
  });

  it("signed in cold start (no topics): full Home with the onboarding card above Today", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue([]);
    renderWithProviders(<HomePage />);

    expect(await screen.findByRole("region", { name: "Make Home yours" })).toBeInTheDocument();
    expect(headingOrder()).toEqual(["Make Home yours", "Today", "For you"]);
    expect(screen.getByText(/five quick questions, from flags to space to AI/i)).toBeInTheDocument();
    expect(screen.queryByText("Explore all topics")).not.toBeInTheDocument();
  });

  it("a failed topics load falls back to the full Home without the onboarding card", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockRejectedValue(new Error("down"));
    renderWithProviders(<HomePage />);

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByText(/five quick questions, from flags to space to AI/i)).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.queryByText("Explore all topics")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Make Home yours" })).not.toBeInTheDocument();
    // The error settles the layout: no pending/full loop, so the GET is not hammered.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(vi.mocked(interestsApi.get).mock.calls.length).toBeLessThanOrEqual(3);
    const settledCalls = vi.mocked(interestsApi.get).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(interestsApi.get).toHaveBeenCalledTimes(settledCalls);
  });

  it("a later Home mount refetches a failed topics load and recovers into the focused layout", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    let failing = true;
    vi.mocked(interestsApi.get).mockImplementation(() => (failing ? Promise.reject(new Error("down")) : Promise.resolve(["history"])));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <HelmetProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>
        </QueryClientProvider>
      </HelmetProvider>
    );
    const first = render(tree);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByText("Explore all topics")).not.toBeInTheDocument();
    first.unmount();
    failing = false;

    render(tree);
    expect(await screen.findByText("Explore all topics")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Play a game in History/ })).toBeInTheDocument();
  });

  it("signed in focused Home keeps Continue between Today and For you", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue(["history"]);
    vi.mocked(studySessionsApi.list).mockResolvedValue([
      {
        id: "s1",
        origin: "quiz",
        runId: "run-1",
        completedAt: new Date().toISOString(),
        correct: 3,
        total: 5,
        source: { kind: "category", categorySlug: "science", navigationKeywords: [], filterKeywords: [] },
        missedItemIds: [],
      },
    ]);
    renderWithProviders(<HomePage />);

    await screen.findByRole("heading", { name: "Continue" });
    expect(headingOrder()).toEqual(["Today", "Continue", "For you"]);
  });

  it("signed in focused Home shows test-date plan cards inside Today, before the daily quiz", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue(["history"]);
    const testDate = new Date();
    testDate.setDate(testDate.getDate() + 4);
    vi.mocked(studyPlansApi.list).mockResolvedValue([
      {
        collectionId: "00000000-0000-4000-8000-000000000001",
        available: true,
        collectionName: "Spanish basics",
        itemCount: 10,
        testDate: `${testDate.getFullYear()}-${String(testDate.getMonth() + 1).padStart(2, "0")}-${String(testDate.getDate()).padStart(2, "0")}`,
        createdAt: new Date().toISOString(),
        firstLearnAt: null,
        lastActivityAt: null,
      },
    ]);
    renderWithProviders(<HomePage />);

    const card = await screen.findByRole("link", { name: /Learn the basics/ });
    expect(card).toHaveTextContent("Spanish basics · Test in 4 days");
    expect(card.compareDocumentPosition(screen.getByRole("link", { name: /Daily quiz/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headingOrder()).toEqual(["Today", "For you"]);
  });
});
