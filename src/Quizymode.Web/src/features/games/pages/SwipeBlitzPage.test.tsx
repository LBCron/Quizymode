import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import SwipeBlitzPage from "./SwipeBlitzPage";
import { gamesApi } from "@/api/games";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { reviewQueueApi } from "@/api/learningLoop";
import { QUIZ_COMPLETED_EVENT } from "@/features/items/quiz/quizRun";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";
import { GUEST_HISTORY_STORAGE_KEY } from "@/features/guestHistory/guestHistoryStorage";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { writeLocalInterests } from "@/features/learningLoop/localLearningState";
import { resetGameBestForTests } from "../gameBest";
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

function renderPage(path = "/games/swipe-blitz/science") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <SwipeBlitzPage />
      <LocationDisplay />
    </>
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TopicEditorProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/games/swipe-blitz/collections/:collectionId/:slug?" element={page} />
          <Route path="/games/swipe-blitz/:category?" element={page} />
          <Route path="/games/*" element={<LocationDisplay />} />
          <Route path="/quiz/*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </TopicEditorProvider>
    </QueryClientProvider>,
  );
}

/** Renders the page and switches to fake timers (Date included) once the first card is on screen. */
async function openPage(path?: string) {
  const view = renderPage(path);
  await screen.findByRole("heading", { name: "Swipe Blitz" });
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

function card(): HTMLElement {
  return screen.getByRole("group", { name: /^Question number \d+\?$/ });
}

/** The card on screen: its item number and whether the shown answer is the correct one. */
function cardInfo(): { n: number; isTrue: boolean } {
  const el: HTMLElement = card();
  const n = Number(/Question number (\d+)\?/.exec(el.textContent ?? "")![1]);
  const shown: string = within(el).getByText(/^(right|wrong)-\d+$/).textContent ?? "";
  return { n, isTrue: shown === `right-${n}` };
}

/** The text of the revealed answer line, or null when no miss is shown. */
function revealLine(): string | null {
  const line = screen.queryByText(/^Answer:/);
  return line ? (line.textContent ?? null) : null;
}

const wrongButton = (): HTMLElement => screen.getByRole("button", { name: "Wrong" });
const rightButton = (): HTMLElement => screen.getByRole("button", { name: "Right" });
const correctButtonFor = (isTrue: boolean): HTMLElement => (isTrue ? rightButton() : wrongButton());
const wrongButtonFor = (isTrue: boolean): HTMLElement => (isTrue ? wrongButton() : rightButton());

/** A right call by button (fireEvent click has detail 0, like keyboard activation). */
function decideRight() {
  fireEvent.click(correctButtonFor(cardInfo().isTrue));
}
async function decideMiss(): Promise<number> {
  const { n, isTrue } = cardInfo();
  fireEvent.click(wrongButtonFor(isTrue));
  await advance(1000);
  return n;
}

function swipe(dx: number, dy = 0) {
  fireEvent.touchStart(card(), { touches: [{ clientX: 100, clientY: 100 }] });
  fireEvent.touchEnd(card(), { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
}

const scoreLabel = (n: number): HTMLElement => screen.getByLabelText(`Score ${n}`);
const trackedEvents = (name: string) => mockTrackEventOnce.mock.calls.filter(([, payload]) => payload.name === name);

describe("SwipeBlitzPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runCounter.value = 0;
    installMemoryLocalStorage();
    resetGameBestForTests();
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.userId = undefined;
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

  it("#384: editor hotkeys and background focus cannot change the running game", async () => {
    await openPage();
    const original = cardInfo();
    fireEvent.click(screen.getByRole("button", { name: "Change topics" }));
    const dialog = screen.getByRole("dialog", { name: "My topics" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    fireEvent.keyDown(cancel, { key: "ArrowRight", code: "ArrowRight" });
    expect(cardInfo()).toEqual(original);
    expect(mockTrackEventOnce).not.toHaveBeenCalled();
    act(() => { card().focus(); });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(gamesApi.getRoster).toHaveBeenCalledTimes(1);
  });

  it("#384: changing identity starts a separate run even in the same URL scope", async () => {
    await openPage();
    fireEvent.click(correctButtonFor(cardInfo().isTrue));
    const firstRun = mockTrackEventOnce.mock.calls.find(call => call[1]?.name === "game_started")?.[1].runId;
    mockAuth.isAuthenticated = true;
    mockAuth.userId = "another-user";
    act(() => { writeLocalInterests(["history"]); });
    await waitFor(() => expect(gamesApi.getRoster).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card()).toBeInTheDocument());
    fireEvent.click(correctButtonFor(cardInfo().isTrue));
    const runs = mockTrackEventOnce.mock.calls.filter(call => call[1]?.name === "game_started").map(call => call[1].runId);
    expect(runs).toHaveLength(2);
    expect(runs[1]).not.toBe(firstRun);
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
      expect(await screen.findByRole("heading", { name: "Swipe Blitz" })).toBeInTheDocument();
    });

    it("loads every item of a collection", async () => {
      renderPage("/games/swipe-blitz/collections/11111111-1111-4111-8111-111111111111/practice+set");
      await screen.findByRole("heading", { name: "Swipe Blitz" });
      expect(collectionsApi.getItems).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", true);
    });
  });

  describe("playing", () => {
    it("shows the card, the ready hint and the full clock before the first decision", async () => {
      await openPage();
      expect(card()).toHaveFocus();
      expect(screen.getByText("Answer?")).toBeInTheDocument();
      expect(screen.getByText("Clock starts on your first pick.")).toBeInTheDocument();
      expect(scoreLabel(0)).toBeInTheDocument();
      expect(screen.getByText("1:00")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Right" })).toHaveAttribute("aria-keyshortcuts", "ArrowRight");
      expect(screen.getByRole("button", { name: "Wrong" })).toHaveAttribute("aria-keyshortcuts", "ArrowLeft");
      expect(trackedEvents("game_started")).toHaveLength(0);
    });

    it("scores a right call by button, starts the clock and reports game_started once with the deck size", async () => {
      await openPage();
      decideRight();
      expect(scoreLabel(1)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Score 1.");
      expect(screen.queryByText("Clock starts on your first pick.")).toBeNull();
      decideRight();
      expect(scoreLabel(2)).toBeInTheDocument();
      const started = trackedEvents("game_started");
      expect(started).toHaveLength(1);
      expect(started[0][1]).toMatchObject({ runId: "run-1", total: 8, contextId: "swipe-blitz:category:science" });
    });

    it("decides with ArrowRight and ArrowLeft", async () => {
      await openPage();
      const first = cardInfo();
      fireEvent.keyDown(window, { key: first.isTrue ? "ArrowRight" : "ArrowLeft" });
      expect(scoreLabel(1)).toBeInTheDocument();
      const second = cardInfo();
      fireEvent.keyDown(window, { key: second.isTrue ? "ArrowRight" : "ArrowLeft" });
      expect(scoreLabel(2)).toBeInTheDocument();
    });

    it("decides with a right or left touch swipe and ignores short or vertical ones", async () => {
      await openPage();
      swipe(30);
      swipe(80, 90);
      expect(scoreLabel(0)).toBeInTheDocument();
      const first = cardInfo();
      swipe(first.isTrue ? 80 : -80, 10);
      expect(scoreLabel(1)).toBeInTheDocument();
      const second = cardInfo();
      swipe(second.isTrue ? 80 : -80);
      expect(scoreLabel(2)).toBeInTheDocument();
    });

    it("ignores arrows with a modifier, on key repeat, while typing and when already handled", async () => {
      await openPage();
      const { isTrue } = cardInfo();
      const key = isTrue ? "ArrowRight" : "ArrowLeft";
      fireEvent.keyDown(window, { key, ctrlKey: true });
      fireEvent.keyDown(window, { key, shiftKey: true });
      fireEvent.keyDown(window, { key, altKey: true });
      fireEvent.keyDown(window, { key, metaKey: true });
      fireEvent.keyDown(window, { key, repeat: true });
      const input = document.createElement("input");
      document.body.appendChild(input);
      fireEvent.keyDown(input, { key });
      input.remove();
      const handled = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      handled.preventDefault();
      window.dispatchEvent(handled);
      expect(scoreLabel(0)).toBeInTheDocument();
      expect(trackedEvents("game_started")).toHaveLength(0);
    });

    it("lets arrow keys work while the card has focus and decides once while a button has focus", async () => {
      await openPage();
      expect(card()).toHaveFocus();
      const first = cardInfo();
      fireEvent.keyDown(card(), { key: first.isTrue ? "ArrowRight" : "ArrowLeft" });
      expect(scoreLabel(1)).toBeInTheDocument();

      const second = cardInfo();
      const button = correctButtonFor(second.isTrue);
      button.focus();
      fireEvent.keyDown(button, { key: second.isTrue ? "ArrowRight" : "ArrowLeft" });
      expect(scoreLabel(2)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Score 2.");
      expect(button).toHaveFocus();
    });

    it("keeps focus on the button after keyboard activation but moves it to the card after a pointer click", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await openPage();
      const first = cardInfo();
      const button = correctButtonFor(first.isTrue);
      button.focus();
      await user.keyboard("{Enter}");
      expect(scoreLabel(1)).toBeInTheDocument();
      expect(button).toHaveFocus();

      const second = cardInfo();
      await user.click(correctButtonFor(second.isTrue));
      expect(scoreLabel(2)).toBeInTheDocument();
      expect(card()).toHaveFocus();
    });

    it("moves focus to the card after a swipe", async () => {
      await openPage();
      wrongButton().focus();
      swipe(cardInfo().isTrue ? 80 : -80);
      expect(card()).toHaveFocus();
    });
  });

  describe("a wrong call", () => {
    it("shows the answer for 1 second, blocks input meanwhile, then shows the next card", async () => {
      await openPage();
      const { n, isTrue } = cardInfo();
      fireEvent.click(wrongButtonFor(isTrue));

      expect(revealLine()).toBe(`Answer: right-${n}`);
      expect(screen.getByRole("status")).toHaveTextContent("Missed. Answer shown.");
      expect(wrongButton()).toHaveAttribute("aria-disabled", "true");
      expect(rightButton()).toHaveAttribute("aria-disabled", "true");
      expect(screen.queryByText("Answer?")).toBeNull();

      fireEvent.click(rightButton());
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      swipe(80);
      expect(scoreLabel(0)).toBeInTheDocument();
      expect(revealLine()).toBe(`Answer: right-${n}`);

      await advance(300);
      expect(revealLine()).toBe(`Answer: right-${n}`);
      await advance(800);
      expect(revealLine()).toBeNull();
      expect(screen.getByText("Answer?")).toBeInTheDocument();
      expect(cardInfo().n).not.toBe(n);
      expect(card()).toHaveFocus();
      expect(wrongButton()).toHaveAttribute("aria-disabled", "false");
    });

    it("keeps announcements free of question and answer text", async () => {
      await openPage();
      const seen: string[] = [];
      decideRight();
      seen.push(screen.getByRole("status").textContent ?? "");
      fireEvent.click(wrongButtonFor(cardInfo().isTrue));
      seen.push(screen.getByRole("status").textContent ?? "");
      for (const text of seen) expect(text).not.toMatch(/Question|right-|wrong-/);
      expect(seen).toEqual(["Score 1.", "Missed. Answer shown."]);
    });
  });

  describe("the round", () => {
    it("announces 10 seconds left once", async () => {
      await openPage();
      decideRight();
      await advance(49_000);
      expect(screen.getByRole("status")).not.toHaveTextContent("10 seconds left.");
      await advance(1_500);
      expect(screen.getByRole("status")).toHaveTextContent("10 seconds left.");
      decideRight();
      await advance(2_000);
      expect(screen.getByRole("status")).toHaveTextContent("Score 2.");
    });

    it("finishes when time runs out with the score, decisions, New best! and focus on the heading", async () => {
      const completedEvent = vi.fn();
      window.addEventListener(QUIZ_COMPLETED_EVENT, completedEvent);
      await openPage();
      decideRight();
      decideRight();
      await decideMiss();
      await advance(60_000);

      const heading = await screen.findByRole("heading", { name: "Time's up!" });
      expect(heading).toHaveFocus();
      expect(screen.getByText("2 of 3 right")).toBeInTheDocument();
      expect(screen.getByText("New best!")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Time's up. Score 2. New best!");
      expect(screen.getByRole("link", { name: "Back to games" })).toHaveAttribute("href", "/games/science");
      expect(trackedEvents("game_started")).toHaveLength(1);
      const completed = trackedEvents("game_completed");
      expect(completed).toHaveLength(1);
      expect(completed[0][1]).toMatchObject({
        runId: "run-1",
        score: 2,
        total: 3,
        contextType: "game",
        contextId: "swipe-blitz:category:science",
      });
      expect(completed[0][1]).not.toHaveProperty("itemId");

      expect(recordAuthenticatedCompletion).not.toHaveBeenCalled();
      expect(localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).toBeNull();
      expect(completedEvent).not.toHaveBeenCalled();
      window.removeEventListener(QUIZ_COMPLETED_EVENT, completedEvent);
    });

    it("ends the round when time runs out during a reveal and stops the reveal timer", async () => {
      await openPage();
      decideRight();
      await advance(58_500);
      fireEvent.click(wrongButtonFor(cardInfo().isTrue));
      expect(revealLine()).not.toBeNull();
      await advance(1_600);
      expect(await screen.findByRole("heading", { name: "Time's up!" })).toBeInTheDocument();
      expect(screen.getByText("1 of 2 right")).toBeInTheDocument();
      expect(revealLine()).toBeNull();
      await advance(3_000);
      expect(screen.getByRole("heading", { name: "Time's up!" })).toBeInTheDocument();
      expect(trackedEvents("game_completed")).toHaveLength(1);
    });

    it("rechecks the deadline when the tab becomes visible again", async () => {
      await openPage();
      decideRight();
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      // The wall clock moves on while the tab is hidden and no timer fires.
      vi.setSystemTime(Date.now() + 61_000);
      expect(screen.queryByRole("heading", { name: "Time's up!" })).toBeNull();
      visibility.mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await screen.findByRole("heading", { name: "Time's up!" })).toBeInTheDocument();
    });

    it("clears its timers on unmount", async () => {
      const view = await openPage();
      decideRight();
      fireEvent.click(wrongButtonFor(cardInfo().isTrue));
      const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
      const clearIntervalSpy = vi.spyOn(window, "clearInterval");
      view.unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(clearIntervalSpy).toHaveBeenCalled();
      const errorSpy = vi.spyOn(console, "error");
      await advance(70_000);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("finishing", () => {
    it("ignores a decision made after the deadline", async () => {
      await openPage();
      decideRight();
      vi.setSystemTime(Date.now() + 60_500);
      decideRight();
      expect(await screen.findByRole("heading", { name: "Time's up!" })).toBeInTheDocument();
      expect(screen.getByText("1 of 1 right")).toBeInTheDocument();
    });

    it("remembers the best score across remounts and shows it when not beaten", async () => {
      const first = await openPage();
      decideRight();
      decideRight();
      await advance(60_000);
      await screen.findByRole("heading", { name: "Time's up!" });
      first.unmount();
      cleanup();
      vi.useRealTimers();

      await openPage();
      decideRight();
      await advance(60_000);
      await screen.findByRole("heading", { name: "Time's up!" });
      expect(screen.getByText("Best 2")).toBeInTheDocument();
      expect(screen.queryByText("New best!")).toBeNull();
    });

    it("never stores or celebrates a score of 0", async () => {
      await openPage();
      await decideMiss();
      await advance(60_000);
      await screen.findByRole("heading", { name: "Time's up!" });
      expect(screen.queryByText("New best!")).toBeNull();
      expect(screen.queryByText(/^Best /)).toBeNull();
      expect(screen.getByText("0 of 1 right")).toBeInTheDocument();
    });

    it("starts a fresh run over the same items with Play again, without refetching", async () => {
      await openPage();
      decideRight();
      await advance(60_000);
      fireEvent.click(await screen.findByRole("button", { name: "Play again" }));

      expect(scoreLabel(0)).toBeInTheDocument();
      expect(screen.getByText("1:00")).toBeInTheDocument();
      expect(card()).toHaveFocus();
      expect(gamesApi.getRoster).toHaveBeenCalledTimes(1);
      decideRight();
      expect(trackedEvents("game_started").map(([, payload]) => payload.runId)).toEqual(["run-1", "run-2"]);
    });
  });

  describe("misses and Review", () => {
    async function finishWithMisses(): Promise<number[]> {
      await openPage();
      const missed = [await decideMiss(), await decideMiss()];
      await advance(60_000);
      await screen.findByRole("heading", { name: "Time's up!" });
      return missed;
    }

    it("lists the misses in order but offers no Review button to a guest", async () => {
      const missed = await finishWithMisses();
      const region = screen.getByRole("region", { name: "Misses" });
      const rows = within(region).getAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toEqual(
        missed.map((n) => `Question number ${n}?right-${n}`),
      );
      expect(screen.getByRole("heading", { name: "Misses" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add misses to Review" })).toBeNull();
    });

    it("adds each missed item once when signed in", async () => {
      mockAuth.isAuthenticated = true;
      mockAuth.userId = "user-1";
      const missed = await finishWithMisses();
      const button = screen.getByRole("button", { name: "Add misses to Review" });
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(`Added ${missed.length} to Review.`)).toBeInTheDocument());
      expect(vi.mocked(reviewQueueApi.enqueue).mock.calls.map(([id]) => id)).toEqual(missed.map(guid));
      expect(screen.getByRole("button", { name: "Added" })).toHaveAttribute("aria-disabled", "true");
    });

    it("shows a retryable error when adding fails", async () => {
      mockAuth.isAuthenticated = true;
      vi.mocked(reviewQueueApi.enqueue).mockRejectedValue({ response: { status: 500 } });
      const missed = await finishWithMisses();
      fireEvent.click(screen.getByRole("button", { name: "Add misses to Review" }));
      expect(await screen.findByText(`Couldn't add ${missed.length} to Review.`)).toBeInTheDocument();
      vi.mocked(reviewQueueApi.enqueue).mockResolvedValue({ itemId: "x", intervalDays: 1, dueAt: "" });
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText(`Added ${missed.length} to Review.`)).toBeInTheDocument();
    });
  });
});
