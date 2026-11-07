import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import SurvivalPage from "./SurvivalPage";
import { gamesApi } from "@/api/games";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { reviewQueueApi } from "@/api/learningLoop";
import { QUIZ_COMPLETED_EVENT } from "@/features/items/quiz/quizRun";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";
import { GUEST_HISTORY_STORAGE_KEY } from "@/features/guestHistory/guestHistoryStorage";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { readGameBest, resetGameBestForTests, survivalBestKey } from "../gameBest";
import { readGhost, resetGhostForTests, survivalGhostKey, writeSurvivalGhostIfBetter } from "../ghostRun";
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
vi.mock("@/api/learningLoop", () => ({ reviewQueueApi: { enqueue: vi.fn() } }));

const guid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeItem(n: number, overrides: Partial<ItemResponse> = {}): ItemResponse {
  return {
    id: guid(n),
    category: "science",
    isPrivate: false,
    question: `Question number ${n}?`,
    correctAnswer: `right-${n}`,
    incorrectAnswers: [`wrong-${n}`, `other-${n}`, `third-${n}`],
    explanation: "",
    createdAt: "2026-03-22T00:00:00Z",
    keywords: [],
    collections: [],
    ...overrides,
  };
}
const makeItems = (count: number): ItemResponse[] => Array.from({ length: count }, (_, index) => makeItem(index + 1));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(path = "/games/survival/science") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <SurvivalPage />
      <LocationDisplay />
    </>
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TopicEditorProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games/survival/collections/:collectionId/:slug?" element={page} />
          <Route path="/games/survival/:category?" element={page} />
          <Route path="/games/*" element={<LocationDisplay />} />
          <Route path="/quiz/*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </TopicEditorProvider>
    </QueryClientProvider>,
  );
}

/** Renders the page and switches to fake timers (Date included) once the first question is on screen. */
async function openPage(path?: string) {
  const view = renderPage(path);
  await screen.findByRole("heading", { name: "Survival" });
  // The initial focus runs in a passive effect; wait for it under real timers, or faking them can stall it.
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  return view;
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function questionEl(): HTMLElement {
  return screen.getByText(/^Question number \d+\?$/).closest("p")!;
}
const currentN = (): number => Number(/(\d+)/.exec(questionEl().textContent ?? "")![1]);
const option = (text: string): HTMLElement => screen.getByRole("button", { name: new RegExp(`^${text}( Correct| Wrong| Right answer)?$`) });
const optionButtons = (): HTMLElement[] => within(screen.getByRole("group", { name: /^Question number/ })).getAllByRole("button");

const pickRight = () => fireEvent.click(option(`right-${currentN()}`));
const pickWrong = () => fireEvent.click(option(`wrong-${currentN()}`));
const trackedEvents = (name: string) => mockTrackEventOnce.mock.calls.filter(([, payload]) => payload.name === name);

/** Wrong answers on the next questions: waits out the click guard, then continues. */
async function missAndContinue() {
  pickWrong();
  await advance(400);
  fireEvent.click(screen.getByRole("button", { name: /^(Next|See results)$/ }));
}

describe("SurvivalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCounter.value = 0;
    installMemoryLocalStorage();
    resetGameBestForTests();
    resetGhostForTests();
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "science" }] } as never);
    vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(8) } as never);
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: makeItems(8) } as never);
    vi.mocked(collectionsApi.getById).mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", name: "Practice Set" } as never);
    vi.mocked(reviewQueueApi.enqueue).mockResolvedValue({ itemId: "x", intervalDays: 1, dueAt: "" });
  });

  afterEach(() => {
    cleanup();
    // Restore spies on the fake timer functions before switching back to the real ones.
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("loading", () => {
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
      expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load this game.");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("heading", { name: "Survival" })).toBeInTheDocument();
    });

    it("loads a collection through getItems", async () => {
      renderPage("/games/survival/collections/11111111-1111-4111-8111-111111111111/practice+set");
      await screen.findByRole("heading", { name: "Survival" });
      expect(collectionsApi.getItems).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", true);
    });
  });

  describe("a question", () => {
    it("shows 4 plain options, 3 hearts, a zero streak and a focused question", async () => {
      await openPage();
      expect(questionEl()).toHaveFocus();
      expect(optionButtons()).toHaveLength(4);
      expect(option(`right-${currentN()}`)).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "3 of 3 hearts left" })).toBeInTheDocument();
      expect(screen.getByText("Streak 0")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /speak|listen|pronounc/i })).toBeNull();
      expect(trackedEvents("game_started")).toHaveLength(0);
    });

    it("shows 2 options for an item with one short distractor and never a long one", async () => {
      vi.mocked(gamesApi.getRoster).mockResolvedValue({
        items: [
          makeItem(1, { incorrectAnswers: ["wrong-1", "z".repeat(26)] }),
          makeItem(2, { incorrectAnswers: ["wrong-2"] }),
          makeItem(3, { incorrectAnswers: ["wrong-3"] }),
        ],
      } as never);
      await openPage();
      expect(optionButtons()).toHaveLength(2);
      expect(screen.queryByText("z".repeat(26))).toBeNull();
    });

    it("turns a correct answer green, announces the streak and moves on after about 0.6 s with the new question focused", async () => {
      await openPage();
      const first = currentN();
      pickRight();
      expect(option(`right-${first}`)).toHaveAccessibleName(`right-${first} Correct`);
      expect(screen.getByRole("status")).toHaveTextContent("Correct. Streak 1.");
      expect(screen.getByText("Streak 1")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
      for (const button of optionButtons()) expect(button).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(option(`wrong-${first}`));
      expect(screen.getByRole("status")).toHaveTextContent("Correct. Streak 1.");

      await advance(100);
      expect(currentN()).toBe(first);
      await advance(900);
      expect(currentN()).not.toBe(first);
      expect(questionEl()).toHaveFocus();
      expect(optionButtons()[0]).not.toHaveAttribute("aria-disabled");
    });

    it("marks a wrong answer, reveals the right one, costs a heart and waits for Next, which has focus", async () => {
      await openPage();
      const first = currentN();
      pickWrong();

      expect(option(`wrong-${first}`)).toHaveAccessibleName(`wrong-${first} Wrong`);
      expect(option(`right-${first}`)).toHaveAccessibleName(`right-${first} Right answer`);
      expect(screen.getByRole("img", { name: "2 of 3 hearts left" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Wrong. 2 hearts left.");
      const next = screen.getByRole("button", { name: "Next" });
      expect(next).toHaveFocus();

      await advance(2000);
      expect(currentN()).toBe(first);

      await advance(0);
      fireEvent.click(next);
      expect(currentN()).not.toBe(first);
      expect(questionEl()).toHaveFocus();
    });

    it("ignores clicks on Next during its first 300 ms", async () => {
      await openPage();
      const first = currentN();
      pickWrong();
      const next = screen.getByRole("button", { name: "Next" });
      fireEvent.click(next);
      expect(currentN()).toBe(first);
      await advance(350);
      fireEvent.click(next);
      expect(currentN()).not.toBe(first);
    });

    it("announces singular and empty hearts", async () => {
      await openPage();
      await missAndContinue();
      expect(screen.getByRole("status")).toHaveTextContent("Wrong. 2 hearts left.");
      pickWrong();
      expect(screen.getByRole("status")).toHaveTextContent("Wrong. 1 heart left.");
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      pickWrong();
      expect(screen.getByRole("status")).toHaveTextContent("Wrong. No hearts left.");
      expect(screen.getByRole("button", { name: "See results" })).toHaveFocus();
    });

    it("shows every item once before repeating, then repeats without back-to-back duplicates", async () => {
      vi.mocked(gamesApi.getRoster).mockResolvedValue({ items: makeItems(3) } as never);
      await openPage();
      const seen: number[] = [];
      for (let step = 0; step < 6; step += 1) {
        seen.push(currentN());
        pickRight();
        await advance(700);
      }
      expect([...seen.slice(0, 3)].sort()).toEqual([1, 2, 3]);
      expect([...seen.slice(3, 6)].sort()).toEqual([1, 2, 3]);
      seen.forEach((n, index) => {
        if (index > 0) expect(n).not.toBe(seen[index - 1]);
      });
    });

    it("clears its timers on unmount", async () => {
      const view = await openPage();
      pickRight();
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
      view.unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      const errorSpy = vi.spyOn(console, "error");
      await advance(2000);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("game over", () => {
    async function playToGameOver(correctFirst: number) {
      await openPage();
      for (let step = 0; step < correctFirst; step += 1) {
        pickRight();
        await advance(700);
      }
      await missAndContinue();
      await missAndContinue();
      pickWrong();
    }

    it("reports and stores the best streak when the third heart is lost, before See results", async () => {
      await playToGameOver(2);
      expect(screen.getByRole("button", { name: "See results" })).toBeInTheDocument();
      expect(readGameBest(survivalBestKey("category:science|nav=|kw="))).toBe(2);
      const completed = trackedEvents("game_completed");
      expect(completed).toHaveLength(1);
      expect(completed[0][1]).toMatchObject({
        runId: "run-1",
        score: 2,
        total: 5,
        contextType: "game",
        contextId: "survival:category:science",
      });
      expect(completed[0][1]).not.toHaveProperty("itemId");
    });

    it("shows Game over with the longest streak, counts, New best! and the misses", async () => {
      const completedEvent = vi.fn();
      window.addEventListener(QUIZ_COMPLETED_EVENT, completedEvent);
      await playToGameOver(2);
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));

      const heading = await screen.findByRole("heading", { name: "Game over" });
      expect(heading).toHaveFocus();
      expect(screen.getByText("Streak 2")).toBeInTheDocument();
      expect(screen.getByText("2 of 5 right")).toBeInTheDocument();
      expect(screen.getByText("New best!")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Game over. Streak 2. New best!");
      expect(within(screen.getByRole("region", { name: "Misses" })).getAllByRole("listitem")).toHaveLength(3);
      expect(screen.queryByRole("button", { name: "Add misses to Review" })).toBeNull();
      expect(screen.getByRole("link", { name: "Back to games" })).toHaveAttribute("href", "/games/science");

      expect(trackedEvents("game_started")).toHaveLength(1);
      expect(trackedEvents("game_started")[0][1]).toMatchObject({ runId: "run-1", total: 8 });
      expect(trackedEvents("game_completed")).toHaveLength(1);
      expect(recordAuthenticatedCompletion).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).toBeNull();
      expect(completedEvent).not.toHaveBeenCalled();
      window.removeEventListener(QUIZ_COMPLETED_EVENT, completedEvent);
    });

    it("does not store or celebrate a streak of 0", async () => {
      await playToGameOver(0);
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));
      await screen.findByRole("heading", { name: "Game over" });
      expect(screen.getByText("Streak 0")).toBeInTheDocument();
      expect(screen.queryByText("New best!")).toBeNull();
      expect(screen.queryByText(/^Best streak/)).toBeNull();
      expect(readGameBest(survivalBestKey("category:science|nav=|kw="))).toBeNull();
    });

    it("keeps the best streak across a remount and shows it when not beaten", async () => {
      const first = await playToGameOver(3);
      void first;
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));
      await screen.findByRole("heading", { name: "Game over" });
      cleanup();
      vi.useRealTimers();

      await playToGameOver(1);
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));
      await screen.findByRole("heading", { name: "Game over" });
      expect(screen.getByText("Best streak 3")).toBeInTheDocument();
      expect(screen.queryByText("New best!")).toBeNull();
    });

    it("starts a fresh run over the same items with Play again, without refetching", async () => {
      await playToGameOver(1);
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));
      fireEvent.click(await screen.findByRole("button", { name: "Play again" }));

      expect(screen.getByRole("img", { name: "3 of 3 hearts left" })).toBeInTheDocument();
      expect(screen.getByText("Streak 0")).toBeInTheDocument();
      expect(gamesApi.getRoster).toHaveBeenCalledTimes(1);
      pickRight();
      expect(trackedEvents("game_started").map(([, payload]) => payload.runId)).toEqual(["run-1", "run-2"]);
    });

    it("offers Add misses to Review only when signed in and queues each missed item once", async () => {
      mockAuth.isAuthenticated = true;
      await playToGameOver(0);
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));
      await screen.findByRole("heading", { name: "Game over" });

      fireEvent.click(screen.getByRole("button", { name: "Add misses to Review" }));
      await waitFor(() => expect(screen.getByText("Added 3 to Review.")).toBeInTheDocument());
      expect(reviewQueueApi.enqueue).toHaveBeenCalledTimes(3);
      expect(new Set(vi.mocked(reviewQueueApi.enqueue).mock.calls.map(([id]) => id)).size).toBe(3);
    });
  });

  describe("ghost", () => {
    const ghostKey = survivalGhostKey("category:science|nav=|kw=");

    async function playToResults(correctFirst: number) {
      await openPage();
      for (let step = 0; step < correctFirst; step += 1) {
        pickRight();
        await advance(700);
      }
      await missAndContinue();
      await missAndContinue();
      pickWrong();
      await advance(400);
      fireEvent.click(screen.getByRole("button", { name: "See results" }));
    }

    it("shows no ghost track without a stored ghost", async () => {
      await openPage();
      expect(screen.queryByText(/^Ghost:/)).toBeNull();
    });

    it("steps the ghost marker with the run clock", async () => {
      writeSurvivalGhostIfBetter(ghostKey, [0, 2000, 60000]);
      await openPage();
      expect(screen.getByText("Ghost: 0")).toBeInTheDocument();
      pickRight();
      expect(screen.getByText("Ghost: 1")).toBeInTheDocument();
      await advance(3000);
      expect(screen.getByText("Ghost: 2")).toBeInTheDocument();
    });

    it("makes the first run the ghost and says so", async () => {
      await playToResults(2);
      expect(screen.getByText("First run: this is your ghost now.")).toBeInTheDocument();
      expect(readGhost(ghostKey)).toHaveLength(2);
    });

    it("reports answers ahead of the ghost at the same moment, announces it and replaces a shorter ghost", async () => {
      writeSurvivalGhostIfBetter(ghostKey, [0]);
      await playToResults(2);
      expect(screen.getByText(/^1 answer ahead of your ghost at 0:0\d\.$/)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/Game over\. Streak 2\..*1 answer ahead of your ghost at 0:0\d\.$/);
      expect(readGhost(ghostKey)).toHaveLength(2);
    });

    it("reports answers behind the ghost and keeps the stronger ghost", async () => {
      const strong = [0, 10, 20, 30, 40];
      writeSurvivalGhostIfBetter(ghostKey, strong);
      await playToResults(2);
      expect(screen.getByText(/^3 answers behind your ghost at 0:0\d\.$/)).toBeInTheDocument();
      expect(readGhost(ghostKey)).toEqual(strong);
    });
  });
});
