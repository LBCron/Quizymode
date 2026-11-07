import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import GamesHubPage from "./GamesHubPage";
import { itemsApi } from "@/api/items";
import { interestsApi } from "@/api/learningLoop";
import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";
import { writeLocalInterests } from "@/features/learningLoop/localLearningState";
import { gamesApi } from "@/api/games";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { resetMatchRaceBestForTests, writeBestIfFaster } from "../matchRace/matchRaceBest";
import { bucketDropBestKey, sortItBestKey, survivalBestKey, swipeBlitzBestKey, writeBestIfHigher } from "../gameBest";
import type { ItemResponse } from "@/types/api";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { isAuthenticated: false, isLoading: false, userId: undefined as string | undefined },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("@/api/learningLoop", () => ({ interestsApi: { get: vi.fn(), replace: vi.fn() } }));
vi.mock("@/api/items", () => ({ itemsApi: { getRandom: vi.fn(), getById: vi.fn() } }));
vi.mock("@/api/games", () => ({ gamesApi: { getRoster: vi.fn() } }));
vi.mock("@/api/categories", () => ({ categoriesApi: { getAll: vi.fn() } }));
vi.mock("@/api/collections", () => ({ collectionsApi: { getItems: vi.fn(), getById: vi.fn() } }));

const COLLECTION_ID = "11111111-1111-4111-8111-111111111111";
const guid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeItem(n: number): ItemResponse {
  return {
    id: guid(n),
    category: "science",
    isPrivate: false,
    question: `Question number ${n}?`,
    correctAnswer: `right-${n}`,
    incorrectAnswers: [`wrong-${n}`],
    explanation: "",
    createdAt: "2026-03-22T00:00:00Z",
    keywords: [],
    collections: [],
  };
}
const makeItems = (count: number): ItemResponse[] => Array.from({ length: count }, (_, index) => makeItem(index + 1));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <GamesHubPage />
      <LocationDisplay />
    </>
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TopicEditorProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games/collections/:collectionId/:slug?" element={page} />
          <Route path="/games/:category?" element={page} />
          <Route path="/games/match-race/*" element={<LocationDisplay />} />
          <Route path="/games/swipe-blitz/*" element={<LocationDisplay />} />
          <Route path="/games/survival/*" element={<LocationDisplay />} />
          <Route path="/learn/*" element={<LocationDisplay />} />
          <Route path="/quiz/*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
      </TopicEditorProvider>
    </QueryClientProvider>,
  );
}

describe("GamesHubPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    resetMatchRaceBestForTests();
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.userId = undefined;
    vi.mocked(interestsApi.get).mockResolvedValue([]);
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "science" }] } as never);
    vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: makeItems(5) } as never);
    vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(5), scopes: [] });
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: makeItems(5) } as never);
    vi.mocked(collectionsApi.getById).mockResolvedValue({ id: COLLECTION_ID, name: "Practice Set" } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the Match Race card with Play to a guest and the Games tab active", async () => {
    renderPage("/games/science?nav=physics&keywords=optics");

    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Match Race" })).toBeInTheDocument();
    expect(screen.getByText("Match each question to its answer.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Games", selected: true })).toBeInTheDocument();
    expect(itemsApi.getRandom).toHaveBeenCalledWith("science", 200, ["optics"], { navigationKeywords: ["physics"], excludeQuestionPictures: true });

    fireEvent.click(screen.getByRole("link", { name: "Play Match Race" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/games/match-race/science?nav=physics&keywords=optics");
  });

  it("shows the four game cards in order with their blurbs and Play links", async () => {
    renderPage("/games/science?nav=physics&keywords=optics");
    await screen.findByRole("heading", { name: "Games" });

    const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(titles).toEqual(["Match Race", "Swipe Blitz", "Survival", "Bucket Drop"]);
    expect(screen.getByText("Right or wrong? Beat the clock.")).toBeInTheDocument();
    expect(screen.getByText("Answer until you miss 3.")).toBeInTheDocument();
    expect(screen.getByText("Catch the answer before it lands.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Play Swipe Blitz" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/games/swipe-blitz/science?nav=physics&keywords=optics");
  });

  it("links Play Survival to the collection scope", async () => {
    renderPage(`/games/collections/${COLLECTION_ID}/practice+set`);
    await screen.findByRole("heading", { name: "Games" });
    const link = await screen.findByRole("link", { name: "Play Survival" });
    await waitFor(() => expect(link).toHaveAttribute("href", `/games/survival/collections/${COLLECTION_ID}/practice+set`));
    fireEvent.click(link);
    expect(await screen.findByTestId("location")).toHaveTextContent(`/games/survival/collections/${COLLECTION_ID}/practice+set`);
  });

  it("shows each game's best for the scope and no label without one", async () => {
    renderPage("/games/science");
    await screen.findByRole("heading", { name: "Games" });
    expect(screen.queryByText(/^Best/)).toBeNull();
    cleanup();

    const scopeKey = "category:science|nav=|kw=";
    writeBestIfHigher(swipeBlitzBestKey(scopeKey), 23);
    writeBestIfHigher(survivalBestKey(scopeKey), 12);
    writeBestIfHigher(bucketDropBestKey(scopeKey), 14);
    renderPage("/games/science");
    expect(await screen.findByText("Best 23")).toBeInTheDocument();
    expect(screen.getByText("Best streak 12")).toBeInTheDocument();
    expect(screen.getByText("Best 14")).toBeInTheDocument();
    expect(screen.queryByText(/^Best 0:/)).toBeNull();
  });

  it("shows the best time for the scope", async () => {
    writeBestIfFaster("category:science|nav=|kw=", 3, 42100);
    renderPage("/games/science");
    expect(await screen.findByText("Best 0:42.1")).toBeInTheDocument();
  });

  it("loads a collection through getItems", async () => {
    renderPage(`/games/collections/${COLLECTION_ID}/practice+set`);
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(collectionsApi.getItems).toHaveBeenCalledWith(COLLECTION_ID, true);
    expect(itemsApi.getRandom).not.toHaveBeenCalled();
    expect(gamesApi.getRoster).not.toHaveBeenCalled();
  });

  describe("roster endpoint", () => {
    it("asks GET /games/roster for a category and navigation scope", async () => {
      renderPage("/games/science?nav=physics");
      await screen.findByRole("heading", { name: "Games" });
      expect(gamesApi.getRoster).toHaveBeenCalledWith(["science/physics"], 200);
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
    });

    it("asks GET /games/roster with no scope for the global hub", async () => {
      renderPage("/games?all=1");
      await screen.findByRole("heading", { name: "Games" });
      expect(gamesApi.getRoster).toHaveBeenCalledWith([], 200);
    });

    it("shows the games for a sparse scope whose few eligible items the server returns", async () => {
      vi.mocked(gamesApi.getRoster).mockResolvedValue({
        items: makeItems(3),
        scopes: [{ scope: "science", available: 3, returned: 3, status: "ok" }],
      });
      renderPage("/games/science");

      expect(await screen.findByRole("link", { name: "Play Match Race" })).toBeInTheDocument();
      expect(screen.queryByText("Not enough short questions for games here")).toBeNull();
    });

    it("falls back to the items endpoint when a scope name contains a slash", async () => {
      vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "ai/ml" }] } as never);
      renderPage("/games/aiml");
      await screen.findByRole("heading", { name: "Games" });
      expect(gamesApi.getRoster).not.toHaveBeenCalled();
      expect(itemsApi.getRandom).toHaveBeenCalledWith("ai/ml", 200, undefined, { navigationKeywords: undefined, excludeQuestionPictures: true });
    });
  });

  it("shows the empty state with Open Quiz when fewer than 3 items qualify", async () => {
    vi.mocked(gamesApi.getRoster).mockResolvedValue({
      items: [...makeItems(2), { ...makeItem(9), question: "q".repeat(81) }],
      scopes: [],
    });
    renderPage("/games/science?keywords=optics");

    expect(await screen.findByText("Not enough short questions for games here")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Play Match Race" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Play Swipe Blitz" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Play Survival" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Open Quiz" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/quiz/science?keywords=optics");
  });

  describe("Sort It card", () => {
    const sortable = (labels: string[], overrides: Partial<ItemResponse> = {}): ItemResponse[] =>
      labels.flatMap((label, g) =>
        Array.from({ length: 4 }, (_, i) => ({
          ...makeItem(100 + g * 10 + i),
          correctAnswer: `${label}-${i}`,
          groupLabel: label,
          ...overrides,
        })),
      );

    it("shows a fifth card with Best and a Play link when the scope has two groups of four", async () => {
      writeBestIfHigher(sortItBestKey("category:science|nav=|kw="), 7);
      vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: [...makeItems(5), ...sortable(["Mammals", "Birds"])], scopes: [] });
      renderPage("/games/science");
      await screen.findByRole("heading", { name: "Games" });

      const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
      expect(titles).toEqual(["Match Race", "Swipe Blitz", "Survival", "Bucket Drop", "Sort It"]);
      expect(screen.getByText("Sort each fact into its group.")).toBeInTheDocument();
      expect(screen.getByText("Best 7")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Play Sort It" })).toHaveAttribute("href", "/games/sort-it/science");
    });

    it("hides the card when the scope has no sortable set", async () => {
      vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: [...makeItems(5), ...sortable(["Mammals"])], scopes: [] });
      renderPage("/games/science");
      await screen.findByRole("heading", { name: "Games" });
      expect(screen.queryByRole("heading", { name: "Sort It" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Play Sort It" })).toBeNull();
    });

    it("shows only Sort It, not the empty state, when little else qualifies but groups are sortable", async () => {
      vi.mocked(gamesApi.getRoster).mockResolvedValue({
        items: sortable(["Mammals", "Birds"], { incorrectAnswers: [] }),
        scopes: [],
      });
      renderPage("/games/science");
      await screen.findByRole("heading", { name: "Games" });
      expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Sort It"]);
      expect(screen.queryByText("Not enough short questions for games here")).toBeNull();
    });
  });

  it("shows a retryable alert when loading fails", async () => {
    vi.mocked(gamesApi.getRoster).mockRejectedValueOnce(new Error("boom"));
    renderPage("/games?all=1");

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load games.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Games" })).toBeInTheDocument();
  });

  it("navigates to Learn from the Learn tab with the scope preserved", async () => {
    renderPage("/games/science?nav=physics");
    await screen.findByRole("heading", { name: "Games" });
    fireEvent.click(screen.getByRole("tab", { name: "Learn" }));
    expect(await screen.findByTestId("location")).toHaveTextContent("/learn/science?nav=physics");
  });

  describe("My topics defaults (#384)", () => {
    it("loads every chosen topic and opens the shared editor", async () => {
      writeLocalInterests(["science", "history"]);
      renderPage("/games");
      await screen.findByRole("heading", { name: "Games" });
      expect(gamesApi.getRoster).toHaveBeenCalledWith(["science", "history"], 200);
      expect(screen.getByText("My topics: Science, History")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Change topics" }));
      expect(await screen.findByRole("dialog", { name: "My topics" })).toBeInTheDocument();
    });

    it("waits for a deliberate all-topics choice when no topics are saved", async () => {
      renderPage("/games");
      expect(await screen.findByRole("heading", { name: "Choose topics for your games" })).toBeInTheDocument();
      expect(gamesApi.getRoster).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("link", { name: "Play all topics" }));
      await screen.findByRole("heading", { name: "Games" });
      expect(gamesApi.getRoster).toHaveBeenCalledWith([], 200);
      expect(screen.getByTestId("location")).toHaveTextContent("/games?all=1");
    });

    it("retains the topics bar when the selected roster fails", async () => {
      writeLocalInterests(["science"]);
      vi.mocked(gamesApi.getRoster).mockRejectedValue(new Error("boom"));
      renderPage("/games");
      expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load games.");
      expect(screen.getByText("My topics: Science")).toBeInTheDocument();
    });

    it("does not load a global roster when account topics fail to load", async () => {
      mockAuth.isAuthenticated = true;
      mockAuth.userId = "user-1";
      vi.mocked(interestsApi.get).mockRejectedValue(new Error("down"));
      renderPage("/games");
      expect(await screen.findByText("My topics unavailable")).toBeInTheDocument();
      expect(gamesApi.getRoster).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Change topics" }));
      expect(await screen.findByRole("dialog", { name: "My topics" })).toBeInTheDocument();
    });

    it("shows the explicit scope and does not apply preferences on a scoped hub", async () => {
      writeLocalInterests(["history"]);
      renderPage("/games/science");
      await screen.findByRole("heading", { name: "Games" });
      expect(gamesApi.getRoster).toHaveBeenCalledWith(["science"], 200);
      expect(screen.getByRole("region", { name: "Game topics" })).toHaveTextContent("Science");
    });

    it("explains unavailable topics while keeping playable selected topics", async () => {
      writeLocalInterests(["science", "history"]);
      vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(5), scopes: [
        { scope: "science", available: 5, returned: 5, status: "ok" },
        { scope: "history", available: 0, returned: 0, status: "empty" },
      ] });
      renderPage("/games");
      await screen.findByRole("heading", { name: "Games" });
      expect(screen.getByRole("status")).toHaveTextContent("No playable questions in: History");
      expect(gamesApi.getRoster).toHaveBeenCalledWith(["science", "history"], 200);
    });
  });
});
