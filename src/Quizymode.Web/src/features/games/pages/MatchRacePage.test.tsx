import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import MatchRacePage from "./MatchRacePage";
import { gamesApi } from "@/api/games";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { QUIZ_COMPLETED_EVENT } from "@/features/items/quiz/quizRun";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";
import { GUEST_HISTORY_STORAGE_KEY } from "@/features/guestHistory/guestHistoryStorage";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { resetMatchRaceBestForTests } from "../matchRace/matchRaceBest";
import { matchRaceGhostKey, readGhost, resetGhostForTests, writeMatchRaceGhostIfBetter } from "../ghostRun";
import type { ItemResponse } from "@/types/api";

const { mockTrackEventOnce, runCounter } = vi.hoisted(() => ({
  mockTrackEventOnce: vi.fn(),
  runCounter: { value: 0 },
}));

vi.mock("@/features/analytics/analyticsEvents", () => ({
  trackEventOnce: mockTrackEventOnce,
  createAnalyticsId: () => `run-${(runCounter.value += 1)}`,
}));
vi.mock("@/features/items/quiz/celebrate", () => ({ celebratePerfectScore: vi.fn() }));

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { isAuthenticated: false, isLoading: false, userId: undefined as string | undefined },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("@/features/studySessions/recordStudySession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/studySessions/recordStudySession")>();
  return { ...actual, recordAuthenticatedCompletion: vi.fn() };
});

vi.mock("@/api/items", () => ({ itemsApi: { getRandom: vi.fn(), getById: vi.fn() } }));
vi.mock("@/api/games", () => ({ gamesApi: { getRoster: vi.fn() } }));
vi.mock("@/api/categories", () => ({ categoriesApi: { getAll: vi.fn() } }));
vi.mock("@/api/collections", () => ({ collectionsApi: { getItems: vi.fn(), getById: vi.fn() } }));

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

function renderPage(path = "/games/match-race/science") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <MatchRacePage />
      <LocationDisplay />
    </>
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TopicEditorProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games/match-race/collections/:collectionId/:slug?" element={page} />
          <Route path="/games/match-race/:category?" element={page} />
          <Route path="/games/*" element={<LocationDisplay />} />
          <Route path="/quiz/*" element={<LocationDisplay />} />
          <Route path="/learn/*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </TopicEditorProvider>
    </QueryClientProvider>,
  );
}

let clock = 1_000_000;

function tile(kind: "question" | "answer", n: number): HTMLElement {
  const text = kind === "question" ? `Question number ${n}?` : `right-${n}`;
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(`^${escaped}( Wrong| Matched)?$`) });
}

/** The item numbers on the board. */
function boardItems(): number[] {
  return Array.from({ length: 12 }, (_, index) => index + 1).filter((n) => screen.queryByText(`Question number ${n}?`));
}

function match(n: number) {
  fireEvent.click(tile("question", n));
  fireEvent.click(tile("answer", n));
}

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches }));
}

describe("MatchRacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCounter.value = 0;
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    installMemoryLocalStorage();
    resetMatchRaceBestForTests();
    resetGhostForTests();
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "science" }] } as never);
    vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(8) } as never);
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: makeItems(8) } as never);
    vi.mocked(collectionsApi.getById).mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", name: "Practice Set" } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("board size", () => {
    it("uses 3 pairs when matchMedia is unavailable", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      expect(boardItems()).toHaveLength(3);
      expect(gamesApi.getRoster).toHaveBeenCalledWith(["science"], 200);
    });

    it("uses 6 pairs at 640 px and wider", async () => {
      stubMatchMedia(true);
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      expect(boardItems()).toHaveLength(6);
      expect(screen.getByLabelText("0 of 6 matched")).toBeInTheDocument();
    });

    it("uses min(target, pool) pairs", async () => {
      stubMatchMedia(true);
      vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(4) } as never);
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      expect(boardItems()).toHaveLength(4);
    });

    it("loads every item of a collection", async () => {
      renderPage("/games/match-race/collections/11111111-1111-4111-8111-111111111111/practice+set");
      await screen.findByRole("heading", { name: "Match Race" });
      expect(collectionsApi.getItems).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", true);
    });

    it("shows the empty state with Open Quiz when fewer than 3 items qualify", async () => {
      vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(2) } as never);
      renderPage();
      expect(await screen.findByText("Not enough short questions for games here")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("link", { name: "Open Quiz" }));
      expect(await screen.findByTestId("location")).toHaveTextContent("/quiz/science");
    });

    it("shows a retryable alert when loading fails", async () => {
      vi.mocked(gamesApi.getRoster).mockRejectedValueOnce(new Error("boom"));
      renderPage();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("We couldn't load this game.");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("heading", { name: "Match Race" })).toBeInTheDocument();
    });
  });

  describe("playing", () => {
    it("keeps a matched pair in place, inert, and announces it", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      const [n] = boardItems();
      fireEvent.click(tile("question", n));
      expect(screen.getByRole("status")).toHaveTextContent("Selected. Pick an answer.");
      expect(tile("question", n)).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(tile("answer", n));

      expect(tile("question", n)).toHaveAttribute("aria-disabled", "true");
      expect(tile("question", n)).toHaveAccessibleName(`Question number ${n}? Matched`);
      expect(screen.getByRole("status")).toHaveTextContent("Matched. 1 of 3.");
      expect(screen.getByLabelText("1 of 3 matched")).toBeInTheDocument();
      fireEvent.click(tile("question", n));
      expect(screen.getByRole("status")).toHaveTextContent("Matched. 1 of 3.");
    });

    it("lets a tap on the answer column come first and re-tap to clear", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      const [n] = boardItems();
      fireEvent.click(tile("answer", n));
      expect(screen.getByRole("status")).toHaveTextContent("Selected. Pick a question.");
      fireEvent.click(tile("answer", n));
      expect(screen.getByRole("status")).toHaveTextContent("Cleared.");
    });

    it("marks a wrong pair, announces the penalty, then clears it after about 600 ms", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      const [a, b] = boardItems();
      fireEvent.click(tile("question", a));
      fireEvent.click(tile("answer", b));
      expect(screen.getByRole("status")).toHaveTextContent("Not a match. Plus 1 second.");
      expect(tile("question", a)).toHaveAccessibleName(`Question number ${a}? Wrong`);
      await waitFor(() => expect(tile("question", a)).toHaveAccessibleName(`Question number ${a}?`), { timeout: 2000 });
    });

    it("re-announces a repeated message, such as two misses in a row", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      const [a, b] = boardItems();
      fireEvent.click(tile("question", a));
      fireEvent.click(tile("answer", b));
      const first = screen.getByText("Not a match. Plus 1 second.");
      fireEvent.click(tile("question", a));
      fireEvent.click(tile("answer", b));
      const second = screen.getByText("Not a match. Plus 1 second.");
      expect(second).not.toBe(first);
    });

    it("selects the focused tile with Enter", async () => {
      const user = userEvent.setup();
      renderPage();
      const heading = await screen.findByRole("heading", { name: "Match Race" });
      await waitFor(() => expect(heading).toHaveFocus());
      const [n] = boardItems();
      tile("question", n).focus();
      await user.keyboard("{Enter}");
      expect(tile("question", n)).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("finishing", () => {
    async function playToTheEnd(missFirst: boolean) {
      await screen.findByRole("heading", { name: "Match Race" });
      const items = boardItems();
      clock = 2_000_000;
      if (missFirst) {
        fireEvent.click(tile("question", items[0]));
        fireEvent.click(tile("answer", items[1]));
      }
      items.forEach((n, index) => {
        clock = 2_000_000 + (index + 1) * 1000;
        match(n);
      });
    }

    it("shows the time with the 1 second penalty included, a new best, and Play again", async () => {
      const completed = vi.fn();
      window.addEventListener(QUIZ_COMPLETED_EVENT, completed);
      renderPage();
      await playToTheEnd(true);

      expect(await screen.findByRole("heading", { name: "Done!" })).toHaveFocus();
      // 3 s from the first tap to the last match + 1 s for the miss.
      expect(screen.getByText("0:04.0")).toBeInTheDocument();
      expect(screen.getByText("New best!")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Done in 0:04.0. New best!");
      expect(screen.getByRole("link", { name: "Back to games" })).toHaveAttribute("href", "/games/science");

      expect(recordAuthenticatedCompletion).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).toBeNull();
      expect(completed).not.toHaveBeenCalled();
      window.removeEventListener(QUIZ_COMPLETED_EVENT, completed);
    });

    it("reports game_started once and game_completed once with the first-try score", async () => {
      renderPage();
      await playToTheEnd(true);
      await screen.findByRole("heading", { name: "Done!" });

      const started = mockTrackEventOnce.mock.calls.filter(([, payload]) => payload.name === "game_started");
      const completed = mockTrackEventOnce.mock.calls.filter(([, payload]) => payload.name === "game_completed");
      expect(started).toHaveLength(1);
      expect(started[0][1]).toMatchObject({ runId: "run-1", total: 3, contextType: "game" });
      expect(completed).toHaveLength(1);
      expect(completed[0][1]).toMatchObject({
        runId: "run-1",
        score: 2,
        total: 3,
        contextType: "game",
        contextId: "match-race:category:science",
      });
      expect(completed[0][1]).not.toHaveProperty("itemId");
    });

    it("starts a fresh board and run with Play again", async () => {
      renderPage();
      await playToTheEnd(false);
      fireEvent.click(await screen.findByRole("button", { name: "Play again" }));

      expect(await screen.findByRole("heading", { name: "Match Race" })).toHaveFocus();
      expect(screen.getByLabelText("0 of 3 matched")).toBeInTheDocument();
      expect(gamesApi.getRoster).toHaveBeenCalledTimes(1);
      fireEvent.click(tile("question", boardItems()[0]));
      const started = mockTrackEventOnce.mock.calls.filter(([, payload]) => payload.name === "game_started");
      expect(started.map(([, payload]) => payload.runId)).toEqual(["run-1", "run-2"]);
    });

    it("remembers the best time across remounts and shows it when not beaten", async () => {
      const first = renderPage();
      await playToTheEnd(false);
      expect(await screen.findByText("0:02.0")).toBeInTheDocument();
      first.unmount();

      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      const items = boardItems();
      clock = 3_000_000;
      items.forEach((n, index) => {
        clock = 3_000_000 + (index + 1) * 5000;
        match(n);
      });
      expect(await screen.findByText("0:10.0")).toBeInTheDocument();
      expect(screen.getByText("Best 0:02.0")).toBeInTheDocument();
      expect(screen.queryByText("New best!")).toBeNull();
    });

    it("still finishes when localStorage throws", async () => {
      vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("full");
      });
      renderPage();
      await playToTheEnd(false);
      expect(await screen.findByRole("heading", { name: "Done!" })).toBeInTheDocument();
      expect(screen.getByText("New best!")).toBeInTheDocument();
    });
  });

  describe("ghost", () => {
    const ghostKey = matchRaceGhostKey("category:science|nav=|kw=", 3);

    async function playQuickly() {
      await screen.findByRole("heading", { name: "Match Race" });
      boardItems().forEach((n, index) => {
        clock = 2_000_000 + index * 1000;
        match(n);
      });
    }

    it("shows no ghost track without a stored ghost", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      expect(screen.queryByText(/^Ghost:/)).toBeNull();
    });

    it("makes the first finished run the ghost and says so", async () => {
      renderPage();
      await playQuickly();
      expect(await screen.findByText("First run: this is your ghost now.")).toBeInTheDocument();
      expect(readGhost(ghostKey)).toEqual([0, 1000, 2000]);
      expect(screen.getByRole("status")).toHaveTextContent("Done in 0:02.0. New best! First run: this is your ghost now.");
      expect(screen.getByRole("status").textContent).not.toContain("..");
    });

    it("shows the ghost progress by elapsed time while playing", async () => {
      writeMatchRaceGhostIfBetter(ghostKey, [500, 1500, 2500]);
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      expect(screen.getByText("Ghost: 0 of 3")).toBeInTheDocument();
      const [first, second] = boardItems();
      clock = 2_000_000;
      match(first);
      expect(screen.getByText("Ghost: 0 of 3")).toBeInTheDocument();
      clock = 2_001_000;
      match(second);
      expect(screen.getByText("Ghost: 1 of 3")).toBeInTheDocument();
    });

    it("reports how far ahead of a slower ghost, announces it and replaces the ghost", async () => {
      writeMatchRaceGhostIfBetter(ghostKey, [0, 5000, 10000]);
      renderPage();
      await playQuickly();
      expect(await screen.findByText("8.0 s ahead of your ghost.")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Done in 0:02.0. New best! 8.0 s ahead of your ghost.");
      expect(screen.getByRole("status").textContent).not.toContain("..");
      expect(readGhost(ghostKey)).toEqual([0, 1000, 2000]);
    });

    it("reports how far behind a faster ghost and keeps that ghost", async () => {
      writeMatchRaceGhostIfBetter(ghostKey, [0, 500, 1000]);
      renderPage();
      await playQuickly();
      expect(await screen.findByText("1.0 s behind your ghost.")).toBeInTheDocument();
      expect(readGhost(ghostKey)).toEqual([0, 500, 1000]);
    });

    it("includes the miss penalty in the ghost times", async () => {
      renderPage();
      await screen.findByRole("heading", { name: "Match Race" });
      const items = boardItems();
      clock = 2_000_000;
      fireEvent.click(tile("question", items[0]));
      fireEvent.click(tile("answer", items[1]));
      items.forEach((n, index) => {
        clock = 2_000_000 + (index + 1) * 1000;
        match(n);
      });
      await screen.findByRole("heading", { name: "Done!" });
      expect(readGhost(ghostKey)).toEqual([1000, 2000, 3000].map((ms) => ms + 1000));
    });
  });
});
