import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import LearnModePage from "./LearnModePage";
import { itemsApi } from "@/api/items";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { QUIZ_COMPLETED_EVENT } from "@/features/items/quiz/quizRun";
import { recordAuthenticatedCompletion, toRecordRequest } from "@/features/studySessions/recordStudySession";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import {
  resetStudyHotkeysPreferenceForTests,
  setStudyHotkeysEnabled,
} from "@/components/study/studyHotkeysPreference";
import {
  GUEST_HISTORY_STORAGE_KEY,
  readGuestHistory,
  resetGuestHistoryMemoryForTests,
} from "@/features/guestHistory/guestHistoryStorage";
import { LEARN_STORAGE_KEY } from "@/features/items/learn/learnStorage";
import type { ItemResponse } from "@/types/api";

const { mockTrackEventOnce, mockTrackEventDeferredOnce, mockFlushDeferredAnalyticsEvents } = vi.hoisted(() => ({
  mockTrackEventOnce: vi.fn(),
  mockTrackEventDeferredOnce: vi.fn(),
  mockFlushDeferredAnalyticsEvents: vi.fn(),
}));

vi.mock("@/features/analytics/analyticsEvents", () => ({
  trackEventOnce: mockTrackEventOnce,
  trackEventDeferredOnce: mockTrackEventDeferredOnce,
  flushDeferredAnalyticsEvents: mockFlushDeferredAnalyticsEvents,
}));

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { isAuthenticated: true, isLoading: false, userId: "user-1" as string | undefined },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/features/studySessions/recordStudySession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/studySessions/recordStudySession")>();
  return { ...actual, recordAuthenticatedCompletion: vi.fn() };
});

vi.mock("@/api/items", () => ({
  itemsApi: { getRandom: vi.fn(), getById: vi.fn(), getAll: vi.fn() },
}));
vi.mock("@/api/categories", () => ({ categoriesApi: { getAll: vi.fn() } }));
vi.mock("@/api/collections", () => ({
  collectionsApi: { getItems: vi.fn(), getById: vi.fn(), getRating: vi.fn() },
}));

const COLLECTION_ID = "11111111-1111-4111-8111-111111111111";
const guid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeItem(n: number): ItemResponse {
  return {
    id: guid(n),
    category: "science",
    isPrivate: false,
    question: `Question number ${n}?`,
    correctAnswer: `right-${n}`,
    incorrectAnswers: [`wrong-${n}-a`, `wrong-${n}-b`, `wrong-${n}-c`],
    explanation: `Because ${n}.`,
    createdAt: "2026-03-22T00:00:00Z",
    keywords: [],
    collections: [],
  };
}
const makeItems = (count: number): ItemResponse[] => Array.from({ length: count }, (_, index) => makeItem(index + 1));

function LocationDisplay() {
  const location = useLocation();
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state)}>
      {`${location.pathname}${location.search}`}
    </div>
  );
}

function renderPage(path: string, state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (
    <>
      <LearnModePage />
      <LocationDisplay />
    </>
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[state ? { pathname: path, state } : path]}>
        <Routes>
          <Route path="/learn/collections/:collectionId/:slug?" element={page} />
          <Route path="/learn/:category?" element={page} />
          <Route path="/explore/*" element={<LocationDisplay />} />
          <Route path="/quiz/*" element={<LocationDisplay />} />
          <Route path="/collections/*" element={<LocationDisplay />} />
          <Route path="/categories/*" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function press(init: KeyboardEventInit) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

/** The item whose question is on screen. */
function currentItem(items: ItemResponse[]): ItemResponse {
  const found = items.find((item) => screen.queryByText(item.question));
  if (!found) throw new Error("No question on screen");
  return found;
}

function clickOption(text: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^[A-D]\\. ${text}$`) }));
}

/** Answers the question on screen and continues with the button. */
function answerAndContinue(items: ItemResponse[], correct: boolean) {
  const item = currentItem(items);
  clickOption(correct ? item.correctAnswer : item.incorrectAnswers[0]);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

const COLLECTION_PATH = `/learn/collections/${COLLECTION_ID}/practice+set`;

describe("LearnModePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    installMemoryLocalStorage();
    resetStudyHotkeysPreferenceForTests();
    resetGuestHistoryMemoryForTests();
    mockAuth.isAuthenticated = true;
    mockAuth.isLoading = false;
    mockAuth.userId = "user-1";
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "science" }] } as never);
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: makeItems(3) } as never);
    vi.mocked(collectionsApi.getById).mockResolvedValue({
      id: COLLECTION_ID,
      name: "Practice Set",
      description: "",
      itemCount: 3,
      createdBy: "user-1",
      createdAt: "2026-10-15T00:00:00Z",
      isPublic: true,
    } as never);
    vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: makeItems(4) } as never);
    vi.mocked(recordAuthenticatedCompletion).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("loading (AC 3.17.1)", () => {
    it("loads a collection with the mastery bar, round header and mode copy", async () => {
      renderPage(COLLECTION_PATH);

      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 3" })).toHaveAttribute("aria-valuemax", "3");
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
      expect(screen.getByText(/Round 1 · 1 of 3/)).toBeInTheDocument();
      expect(screen.getByText("Quiz: one pass. Learn: repeat until mastered. Review: spaced, due items.")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Learn", selected: true })).toBeInTheDocument();
      expect(screen.queryByText(/Learning \d+ of/)).toBeNull();
    });

    it("caps a large collection at 50 and says so", async () => {
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: makeItems(60) } as never);
      renderPage(COLLECTION_PATH);

      expect(await screen.findByText("Learning 50 of 60")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "50");
    });

    it("shows only the playable items", async () => {
      const unplayable = { ...makeItem(9), incorrectAnswers: [] };
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [...makeItems(2), unplayable] } as never);
      renderPage(COLLECTION_PATH);

      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 2" })).toBeInTheDocument();
    });

    it("shows the empty state with Open flashcards and no run when nothing is playable", async () => {
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [{ ...makeItem(1), incorrectAnswers: [] }] } as never);
      renderPage(COLLECTION_PATH);

      expect(await screen.findByText("Nothing to learn here yet")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Open flashcards" }));
      expect(await screen.findByTestId("location")).toHaveTextContent(`/explore/collections/${COLLECTION_ID}/practice+set`);
      expect(localStorage.getItem(LEARN_STORAGE_KEY)).toBeNull();
    });

    it("shows a retryable alert when loading fails", async () => {
      vi.mocked(collectionsApi.getItems).mockRejectedValueOnce(new Error("boom"));
      renderPage(COLLECTION_PATH);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("We couldn't load these questions.");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 3" })).toBeInTheDocument();
    });

    it("uses the requested size and keywords for a category and shows the real playable count", async () => {
      vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: [...makeItems(3), { ...makeItem(8), incorrectAnswers: [] }] } as never);
      renderPage("/learn/science?nav=a&keywords=a,b");

      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 3" })).toBeInTheDocument();
      expect(itemsApi.getRandom).toHaveBeenCalledWith("science", 10, ["b"], { navigationKeywords: ["a"] });
      expect(screen.getByLabelText("Items to learn:")).toHaveValue(10);
    });
  });

  describe("playing (AC 3.17.4, 3.17.6, 3.17.13)", () => {
    it("ignores Enter until answered, answers by key once, and Enter continues", async () => {
      const items = makeItems(3);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      const first = currentItem(items);

      press({ key: "Enter", code: "Enter" });
      expect(screen.getByText(first.question)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

      const options = screen.getAllByRole("button", { name: /^[A-D]\. / });
      options.forEach((option, index) => {
        expect(option).toHaveAttribute("aria-keyshortcuts", `${index + 1} ${String.fromCharCode(65 + index)}`);
      });
      const correctIndex = options.findIndex((option) => option.textContent?.includes(first.correctAnswer));
      press({ key: String(correctIndex + 1), code: `Digit${correctIndex + 1}` });

      expect(screen.getByText("Correct. Mastered.")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
      expect(screen.getByRole("progressbar", { name: "Mastered 1 of 3" })).toBeInTheDocument();
      press({ key: "2", code: "Digit2" });
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

      press({ key: "Enter", code: "Enter" });
      expect(screen.getByText(/Round 1 · 2 of 3/)).toBeInTheDocument();
      expect(currentItem(items).id).not.toBe(first.id);
    });

    it("answers by letter key", async () => {
      const items = makeItems(3);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      const first = currentItem(items);
      const options = screen.getAllByRole("button", { name: /^[A-D]\. / });
      const correctIndex = options.findIndex((option) => option.textContent?.includes(first.correctAnswer));

      press({ key: String.fromCharCode(97 + correctIndex), code: `Key${String.fromCharCode(65 + correctIndex)}` });

      expect(screen.getByText("Correct. Mastered.")).toBeInTheDocument();
    });

    it("turns the shortcuts off when the preference is disabled", async () => {
      setStudyHotkeysEnabled(false);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      press({ key: "1", code: "Digit1" });
      press({ key: "a", code: "KeyA" });

      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    });

    it("moves focus to the question heading on each new question", async () => {
      const items = makeItems(3);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      await waitFor(() => expect(screen.getByRole("heading", { name: "Question" })).toHaveFocus());

      const item = currentItem(items);
      clickOption(item.correctAnswer);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => expect(screen.getByRole("heading", { name: "Question" })).toHaveFocus());
    });

    it("explains a miss, keeps the item in play, and recaps the round with a text status", async () => {
      const items = makeItems(2);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      const missed = currentItem(items);
      clickOption(missed.incorrectAnswers[0]);
      expect(screen.getByText(new RegExp(`Not quite. Correct answer: ${missed.correctAnswer}. Answer it correctly 2 more times`))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      answerAndContinue(items, true);

      const heading = await screen.findByRole("heading", { name: "Round 1 complete" });
      await waitFor(() => expect(heading).toHaveFocus());
      expect(screen.getByText("1 of 2 correct. Mastered 1 of 2 so far.")).toBeInTheDocument();
      expect(screen.getByText("Missed, coming back")).toBeInTheDocument();
      expect(screen.getByText("Mastered")).toBeInTheDocument();

      press({ key: "Enter", code: "Enter" });
      expect(await screen.findByText(/Round 2 · 1 of 1/)).toBeInTheDocument();
      expect(screen.getByText(missed.question)).toBeInTheDocument();
    });

    it("splits 8 items into a round of 7 and then the rest", async () => {
      const items = makeItems(8);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      for (let index = 0; index < 7; index += 1) answerAndContinue(items, true);
      expect(await screen.findByText("7 of 7 correct. Mastered 7 of 8 so far.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByText(/Round 2 · 1 of 1/)).toBeInTheDocument();
    });

    it("confirms before starting over", async () => {
      const items = makeItems(3);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      answerAndContinue(items, true);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
      expect(screen.getByText("Start over? Your progress in this set will be lost.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Keep learning" }));
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
      fireEvent.click(screen.getByRole("button", { name: "Start over" }));
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });
  });

  describe("finishing a signed-in run (AC 3.17.9, 3.17.11)", () => {
    it("finishes on Continue after the last mastering answer and saves exactly one session", async () => {
      const items = makeItems(2);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      const completed = vi.fn();
      window.addEventListener(QUIZ_COMPLETED_EVENT, completed);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      // Miss the first question, then answer everything correctly.
      const missed = currentItem(items);
      clickOption(missed.incorrectAnswers[0]);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      answerAndContinue(items, true);
      fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
      answerAndContinue(items, true);
      fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
      const last = currentItem(items);
      clickOption(last.correctAnswer);

      expect(screen.getByText("Correct. Mastered.")).toBeInTheDocument();
      press({ key: "Enter", code: "Enter" });

      expect(await screen.findByRole("heading", { name: "You've mastered all 2 items" })).toBeInTheDocument();
      expect(screen.getByText("First try: 1 / 2")).toBeInTheDocument();
      expect(screen.getByText("50% right first time")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to collection" })).toHaveAttribute("href", expect.stringContaining(`/collections/${COLLECTION_ID}`));

      await waitFor(() => expect(recordAuthenticatedCompletion).toHaveBeenCalledTimes(1));
      const snapshot = vi.mocked(recordAuthenticatedCompletion).mock.calls[0][0];
      expect(toRecordRequest(snapshot)).toMatchObject({
        correct: 1,
        total: 2,
        missedItemIds: [missed.id],
        source: { kind: "collection", collectionId: COLLECTION_ID },
        mode: "learn",
      });
      expect(await screen.findByText("Misses were added to your review queue.")).toBeInTheDocument();
      expect(completed).not.toHaveBeenCalled();
      window.removeEventListener(QUIZ_COMPLETED_EVENT, completed);

      // The finish screen is restored without a second save.
      cleanup();
      renderPage(COLLECTION_PATH);
      expect(await screen.findByRole("heading", { name: "You've mastered all 2 items" })).toBeInTheDocument();
      expect(recordAuthenticatedCompletion).toHaveBeenCalledTimes(1);
    });

    it("reports analytics under context type learn: one start, first attempts only, one completion", async () => {
      const items = makeItems(2);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      clickOption(currentItem(items).incorrectAnswers[0]);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      answerAndContinue(items, true);
      await screen.findByRole("heading", { name: "Round 1 complete" });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      answerAndContinue(items, true);
      await screen.findByRole("heading", { name: "Round 2 complete" });

      const learnContext = { contextType: "learn", contextId: `collection:${COLLECTION_ID}` };
      const starts = mockTrackEventOnce.mock.calls.filter(([, event]) => event.name === "quick_quiz_started");
      expect(starts).toHaveLength(1);
      expect(starts[0][1]).toMatchObject({ ...learnContext, total: 2 });
      const answers = mockTrackEventDeferredOnce.mock.calls.filter(([, event]) => event.name === "question_answered");
      expect(answers).toHaveLength(2);
      expect(answers.every(([, event]) => event.contextType === "learn")).toBe(true);
      expect(answers.map(([, event]) => event.position).sort()).toEqual([1, 2]);
    });

    it("offers Try again with the same run id when the save fails", async () => {
      const items = makeItems(1);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      vi.mocked(recordAuthenticatedCompletion).mockResolvedValueOnce(false);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      clickOption(currentItem(items).correctAnswer);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      const alert = await screen.findByText(/We couldn't save this session\./);
      expect(alert).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(recordAuthenticatedCompletion).toHaveBeenCalledTimes(2));
      const [first, second] = vi.mocked(recordAuthenticatedCompletion).mock.calls;
      expect(second[0].runId).toBe(first[0].runId);
      await waitFor(() => expect(screen.queryByText(/We couldn't save this session\./)).toBeNull());
    });

    it("Learn again starts a new run id", async () => {
      const items = makeItems(1);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      clickOption(currentItem(items).correctAnswer);
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("heading", { name: "You've mastered all 1 item" });

      fireEvent.click(screen.getByRole("button", { name: "Learn again" }));

      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 1" })).toBeInTheDocument();
      const runIds = mockTrackEventOnce.mock.calls.filter(([, event]) => event.name === "quick_quiz_started").map(([, event]) => event.runId);
      expect(new Set(runIds).size).toBe(2);
    });
  });

  describe("guests (AC 3.17.8, 3.17.10)", () => {
    beforeEach(() => {
      mockAuth.isAuthenticated = false;
      mockAuth.userId = undefined;
    });

    it("records a finished guest run in guest history and never calls the study-session API", async () => {
      const items = makeItems(2);
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      answerAndContinue(items, true);
      answerAndContinue(items, true);

      await screen.findByRole("heading", { name: "You've mastered all 2 items" });
      expect(recordAuthenticatedCompletion).not.toHaveBeenCalled();
      const history = readGuestHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ correct: 2, total: 2, source: { kind: "collection", collectionId: COLLECTION_ID } });
      expect(localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).not.toBeNull();
    });

    it("snapshots items for a guest category run and restores it from storage without fetching", async () => {
      const items = makeItems(4);
      vi.mocked(itemsApi.getRandom).mockResolvedValue({ items } as never);
      const view = renderPage("/learn/science");
      await screen.findByRole("progressbar", { name: "Mastered 0 of 4" });
      answerAndContinue(items, true);
      expect(localStorage.getItem(LEARN_STORAGE_KEY)).toContain("Question number");
      view.unmount();

      vi.mocked(itemsApi.getRandom).mockClear();
      vi.mocked(itemsApi.getRandom).mockRejectedValue(new Error("should not refetch"));
      renderPage("/learn/science");

      expect(await screen.findByRole("progressbar", { name: "Mastered 1 of 4" })).toBeInTheDocument();
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
      expect(screen.getByText(/Round 1 · 2 of 4/)).toBeInTheDocument();
      expect(screen.queryByText(/couldn't be restored/)).toBeNull();
    });
  });

  describe("restore (AC 3.17.7, 3.17.8)", () => {
    it("restores a signed-in collection run by ids and keeps no question text", async () => {
      const items = makeItems(3);
      const view = renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      answerAndContinue(items, true);
      // A miss as well, so a selected wrong answer would be stored if the attempt kept answer text.
      clickOption(currentItem(items).incorrectAnswers[0]);
      const stored = localStorage.getItem(LEARN_STORAGE_KEY) ?? "";
      expect(stored).not.toContain("Question number");
      expect(stored).not.toMatch(/right-\d|wrong-\d/);
      expect(stored).toContain("selectedIndex");
      view.unmount();

      renderPage(COLLECTION_PATH);

      expect(await screen.findByRole("progressbar", { name: "Mastered 1 of 3" })).toBeInTheDocument();
      expect(screen.queryByText(/couldn't be restored/)).toBeNull();
      // The wrong pick is highlighted again from its stored index.
      expect(document.querySelector(".border-red-500")).not.toBeNull();
    });

    it("restarts with the notice when a stored collection item is no longer in the roster", async () => {
      const items = makeItems(3);
      const view = renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      answerAndContinue(items, true);
      view.unmount();

      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: makeItems(3).map((item, index) => (index === 0 ? makeItem(20) : item)) } as never);
      // Every stored id must still be playable; replacing items removes at least one stored id when it was in the run.
      const stored = JSON.parse(localStorage.getItem(LEARN_STORAGE_KEY) ?? "{}");
      stored.runs[0].state.itemIds = [guid(99), ...stored.runs[0].state.itemIds.slice(1)];
      localStorage.setItem(LEARN_STORAGE_KEY, JSON.stringify(stored));
      renderPage(COLLECTION_PATH);

      expect(await screen.findByText("Your saved Learn progress couldn't be restored, so we started over.")).toBeInTheDocument();
      expect(await screen.findByRole("progressbar", { name: /Mastered 0 of/ })).toBeInTheDocument();
    });

    it("starts over with the notice on corrupt data and silently for another identity", async () => {
      localStorage.setItem(LEARN_STORAGE_KEY, "{broken");
      const view = renderPage(COLLECTION_PATH);
      expect(await screen.findByText(/couldn't be restored/)).toBeInTheDocument();
      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 3" })).toBeInTheDocument();
      view.unmount();

      localStorage.removeItem(LEARN_STORAGE_KEY);
      mockAuth.userId = "user-2";
      const items = makeItems(3);
      const other = renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");
      answerAndContinue(items, true);
      other.unmount();

      mockAuth.userId = "user-3";
      renderPage(COLLECTION_PATH);
      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 3" })).toBeInTheDocument();
      expect(screen.queryByText(/couldn't be restored/)).toBeNull();
    });

    it("refetches a signed-in category run by id and restarts with the notice if one is inaccessible", async () => {
      const items = makeItems(3);
      vi.mocked(itemsApi.getRandom).mockResolvedValue({ items } as never);
      const view = renderPage("/learn/science");
      await screen.findByRole("progressbar");
      answerAndContinue(items, true);
      view.unmount();

      vi.mocked(itemsApi.getById).mockImplementation(async (id: string) => items.find((item) => item.id === id) as ItemResponse);
      const restored = renderPage("/learn/science");
      expect(await screen.findByRole("progressbar", { name: "Mastered 1 of 3" })).toBeInTheDocument();
      expect(itemsApi.getById).toHaveBeenCalledTimes(3);
      restored.unmount();

      vi.mocked(itemsApi.getById).mockRejectedValue(new Error("404"));
      renderPage("/learn/science");
      expect(await screen.findByText(/couldn't be restored/)).toBeInTheDocument();
      expect(await screen.findByRole("progressbar", { name: "Mastered 0 of 3" })).toBeInTheDocument();
    });

    it("keeps playing and shows the status line when storage fails", async () => {
      const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
      renderPage(COLLECTION_PATH);

      expect(await screen.findByRole("progressbar")).toBeInTheDocument();
      expect(await screen.findByText("We couldn't save your progress on this device.")).toBeInTheDocument();
      setItem.mockRestore();
    });
  });

  describe("items to learn", () => {
    it("asks inline before changing the size over existing progress", async () => {
      const items = makeItems(4);
      vi.mocked(itemsApi.getRandom).mockResolvedValue({ items } as never);
      const confirm = vi.spyOn(window, "confirm");
      renderPage("/learn/science");
      await screen.findByRole("progressbar");
      answerAndContinue(items, true);

      const input = screen.getByLabelText("Items to learn:");
      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.blur(input);
      expect(screen.getByText("Change size and start over?")).toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Keep learning" }));
      expect(input).toHaveValue(10);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.blur(input);
      fireEvent.click(within(screen.getByRole("group", { name: "Change size" })).getByRole("button", { name: "Start over" }));
      await waitFor(() => expect(itemsApi.getRandom).toHaveBeenLastCalledWith("science", 5, undefined, { navigationKeywords: undefined }));
      expect(await screen.findByRole("progressbar", { name: /Mastered 0 of/ })).toBeInTheDocument();
    });
  });

  describe("mode switcher", () => {
    it("navigates to Quiz with the same scope", async () => {
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      fireEvent.click(screen.getByRole("tab", { name: "Quiz" }));

      expect(await screen.findByTestId("location")).toHaveTextContent(`/quiz/collections/${COLLECTION_ID}/practice+set`);
    });
  });
});

describe("LearnModePage question pictures (#403)", () => {
  const pictureItems = (): ItemResponse[] =>
    makeItems(3).map((item) => ({ ...item, questionImage: { key: "curated:flags/zz", altText: "Not bundled" } }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    installMemoryLocalStorage();
    resetStudyHotkeysPreferenceForTests();
    resetGuestHistoryMemoryForTests();
    mockAuth.isAuthenticated = true;
    mockAuth.isLoading = false;
    mockAuth.userId = "user-1";
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "science" }] } as never);
    vi.mocked(collectionsApi.getById).mockResolvedValue({
      id: COLLECTION_ID,
      name: "Practice Set",
      description: "",
      itemCount: 3,
      createdBy: "user-1",
      createdAt: "2026-10-15T00:00:00Z",
      isPublic: true,
    } as never);
    vi.mocked(recordAuthenticatedCompletion).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ignores answer keys while the picture is unavailable, and Skip moves on without a miss", async () => {
    const items = pictureItems();
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
    renderPage(`/learn/collections/${COLLECTION_ID}/practice-set`);
    await screen.findByRole("progressbar");
    const first = currentItem(items);

    expect(screen.getByText("Picture isn't available")).toBeInTheDocument();
    press({ key: "1", code: "Digit1" });
    press({ key: "b", code: "KeyB" });
    expect(screen.queryByText(/Correct\.|Not quite/)).not.toBeInTheDocument();
    screen.getAllByRole("button", { name: /^[A-D]\. / }).forEach((option) => expect(option).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Skip question (not scored)" }));

    expect(screen.getByText(/Round 1 · 2 of 3/)).toBeInTheDocument();
    expect(currentItem(items).id).not.toBe(first.id);
    expect(screen.getByRole("progressbar", { name: "Mastered 0 of 2" })).toBeInTheDocument();
    expect(screen.queryByText(/Not quite/)).not.toBeInTheDocument();
  });

  it("finishes with nothing scored when every picture is skipped, saving no session", async () => {
    const items = pictureItems();
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as never);
    renderPage(`/learn/collections/${COLLECTION_ID}/practice-set`);
    await screen.findByRole("progressbar");

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(await screen.findByRole("button", { name: "Skip question (not scored)" }));
    }

    expect(await screen.findByText("No questions were scored")).toBeInTheDocument();
    expect(screen.getByText("3 questions skipped because the picture was unavailable. Not scored.")).toBeInTheDocument();
    expect(recordAuthenticatedCompletion).not.toHaveBeenCalled();
  });

  describe("Make a quiz notice (#363)", () => {
    const notice =
      "2 of 3 sections were made. 1 section couldn't be made and wasn't counted against your limit. Retry from your study guide.";

    it("shows the one-line notice once with a link back to the study guide, and drops it from the history state", async () => {
      renderPage(COLLECTION_PATH, { quickNotice: notice, documentId: "doc-1" });

      const status = await screen.findByText(notice);
      expect(status.closest('[role="status"]')).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open study guide" })).toHaveAttribute("href", "/study-guides/documents/doc-1");
      await waitFor(() => expect(screen.getByTestId("location")).toHaveAttribute("data-state", "null"));
      expect(screen.getByText(notice)).toBeInTheDocument();
    });

    it("can be dismissed", async () => {
      renderPage(COLLECTION_PATH, { quickNotice: notice, documentId: "doc-1" });
      await screen.findByText(notice);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));

      expect(screen.queryByText(notice)).not.toBeInTheDocument();
    });

    it("shows no notice without one in the navigation state", async () => {
      renderPage(COLLECTION_PATH);
      await screen.findByRole("progressbar");

      expect(screen.queryByRole("button", { name: "Dismiss notice" })).not.toBeInTheDocument();
    });
  });
});
