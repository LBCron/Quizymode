import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import QuizModePage from "./QuizModePage";
import { itemsApi } from "@/api/items";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import { collectionsApi } from "@/api/collections";
import { QUIZ_COMPLETED_EVENT, createQuizRun, reduceQuizRun, type QuizCompletionSnapshot, type QuizRunState } from "@/features/items/quiz/quizRun";
import { resetStudyHotkeysPreferenceForTests } from "@/components/study/studyHotkeysPreference";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { readGuestHistory, resetGuestHistoryMemoryForTests } from "@/features/guestHistory/guestHistoryStorage";

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
  mockAuth: { isAuthenticated: false, isLoading: false, userId: undefined as string | undefined },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/api/items", () => ({ itemsApi: { getRandom: vi.fn(), getById: vi.fn(), getAll: vi.fn() } }));
vi.mock("@/api/categories", () => ({ categoriesApi: { getAll: vi.fn() } }));
vi.mock("@/api/keywords", () => ({ keywordsApi: { getKeywordDescriptions: vi.fn() } }));
vi.mock("@/api/collections", () => ({
  collectionsApi: { getItems: vi.fn(), getById: vi.fn(), getRating: vi.fn() },
}));
vi.mock("@/components/CommentsDrawer", () => ({ CommentsDrawer: () => null }));
vi.mock("@/components/ItemCollectionsModal", () => ({ default: () => null }));
vi.mock("@/components/ItemRatingsComments", () => ({ default: () => <div>ratings-and-comments</div> }));
vi.mock("@/components/ItemCollectionControls", () => ({ ItemCollectionControls: () => <div>collection-controls</div> }));

const GUID_1 = "11111111-1111-4111-8111-111111111111";
const GUID_2 = "22222222-2222-4222-8222-222222222222";
const GUID_3 = "33333333-3333-4333-8333-333333333333";

const base = {
  category: "exams",
  isPrivate: false,
  createdAt: "2026-03-22T00:00:00Z",
  keywords: [],
  collections: [],
  incorrectAnswerSpeech: [],
};
const item1 = { ...base, id: GUID_1, question: "What is 2 + 2?", correctAnswer: "4", incorrectAnswers: ["1", "2", "3"], explanation: "Basic arithmetic." };
const item2 = { ...base, id: GUID_2, question: "Capital of France?", correctAnswer: "Paris", incorrectAnswers: ["Rome", "Berlin", "Madrid"], explanation: "Paris it is." };
const item3 = { ...base, id: GUID_3, question: "Largest planet?", correctAnswer: "Jupiter", incorrectAnswers: ["Mars", "Venus", "Saturn"], explanation: "Gas giant." };
const COLLECTION_ID = "44444444-4444-4444-8444-444444444444";
const IDENTITY = "guest";

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const buildPage = () => (
    <>
      <QuizModePage />
      <LocationDisplay />
    </>
  );
  const buildTree = () => {
    const page = buildPage();
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/quiz/collections/:collectionId/item/:itemId" element={page} />
            <Route path="/quiz/collections/:collectionId/:slug/item/:itemId" element={page} />
            <Route path="/quiz/collections/:collectionId/:slug" element={page} />
            <Route path="/quiz/collections/:collectionId" element={page} />
            <Route path="/quiz/item/:itemId" element={page} />
            <Route path="/quiz/:category/item/:itemId" element={page} />
            <Route path="/quiz" element={page} />
            <Route path="/explore/*" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
  const result = render(buildTree());
  return { ...result, rerenderPage: () => result.rerender(buildTree()) };
}

const TEST_URL = `/quiz/collections/${COLLECTION_ID}/item/${GUID_1}?mode=test`;
const PRACTICE_URL = `/quiz/collections/${COLLECTION_ID}/item/${GUID_1}`;

function option(text: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^[A-D]\\. ${text}$`) });
}

async function startTest(limit?: "custom-1"): Promise<void> {
  await screen.findByRole("heading", { name: "Test mode" });
  if (limit === "custom-1") {
    fireEvent.change(screen.getByLabelText("Time limit"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Custom time limit in minutes"), { target: { value: "1" } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Start test" }));
}

function questionAnswered(): { itemId: string; isCorrect: boolean; position: number }[] {
  return mockTrackEventDeferredOnce.mock.calls
    .map((call) => call[1] as { name: string; itemId: string; isCorrect: boolean; position: number })
    .filter((event) => event.name === "question_answered");
}

function names(mock: typeof mockTrackEventOnce): string[] {
  return mock.mock.calls.map((call) => (call[1] as { name: string }).name);
}

function storedRun(overrides: Partial<QuizRunState>): void {
  let run = createQuizRun({ kind: "collection", collectionId: COLLECTION_ID }, [GUID_1, GUID_2, GUID_3], IDENTITY, "test");
  run = { ...run, ...overrides };
  sessionStorage.setItem(
    "navigationContext_quiz",
    JSON.stringify({ mode: "quiz", collectionId: COLLECTION_ID, currentIndex: 0, itemIds: run.itemIds, quizRun: run })
  );
}

const SIZED_IDS = [GUID_1, GUID_2, GUID_3, "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"];
const sizedItems = SIZED_IDS.map((id, index) => ({ ...item1, id, question: `Sized question ${index + 1}` }));
const CATEGORY_TEST_URL = `/quiz/exams/item/${GUID_1}?mode=test`;

/** A started category Test saved by a run of the given quiz size (AC 3.6.12, 3.18.7). */
function storeCategoryTest(quizSize: number, startedAt: string, identity: string = IDENTITY): QuizRunState {
  let run = createQuizRun(
    { kind: "category", category: "exams", navigationKeywords: [], filterKeywords: [], quizSize },
    SIZED_IDS,
    identity,
    "test"
  );
  run = reduceQuizRun(run, { type: "start-test", startedAt, timeLimitSec: 600 });
  run = reduceQuizRun(run, { type: "answer", itemId: GUID_1, selectedAnswer: "1", isCorrect: false, completedAt: startedAt });
  run = reduceQuizRun(run, { type: "toggle-flag", itemId: GUID_1 });
  sessionStorage.setItem(
    "navigationContext_quiz",
    JSON.stringify({ mode: "quiz", category: "exams", currentIndex: 0, itemIds: SIZED_IDS, items: sizedItems, quizRun: run })
  );
  return run;
}

let onTestEnd: (() => void) | null = null;

describe("QuizModePage Test mode (AC 3.18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.userId = undefined;
    installMemoryLocalStorage();
    resetGuestHistoryMemoryForTests();
    resetStudyHotkeysPreferenceForTests();
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [{ category: "exams" }] } as Awaited<ReturnType<typeof categoriesApi.getAll>>);
    vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: [item1] } as Awaited<ReturnType<typeof itemsApi.getRandom>>);
    vi.mocked(keywordsApi.getKeywordDescriptions).mockResolvedValue({ keywords: [] } as Awaited<ReturnType<typeof keywordsApi.getKeywordDescriptions>>);
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [item1, item2, item3] } as Awaited<ReturnType<typeof collectionsApi.getItems>>);
    vi.mocked(collectionsApi.getById).mockResolvedValue({
      id: COLLECTION_ID,
      name: "Exam",
      description: "",
      itemCount: 3,
      createdBy: "someone",
      createdAt: "2026-10-15T00:00:00Z",
      isPublic: true,
    } as Awaited<ReturnType<typeof collectionsApi.getById>>);
    vi.mocked(collectionsApi.getRating).mockResolvedValue({ averageStars: null, count: 0, myStars: null });
  });

  afterEach(() => {
    onTestEnd?.();
    onTestEnd = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keyboard-skips a loaded final picture as persisted unscored with no completion credit", async () => {
    const pictured = { ...item1, questionImage: { key: "curated:flags/fr", altText: "Flag" } };
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [pictured] } as Awaited<ReturnType<typeof collectionsApi.getItems>>);
    const view = renderPage(TEST_URL); await startTest("custom-1");
    fireEvent.load(await screen.findByAltText("Flag"));
    const skip = screen.getByRole("button", { name: "Skip question (not scored)" }); skip.focus(); await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("navigationContext_quiz")!).quizRun.skipped).toEqual([GUID_1]));
    const before = JSON.parse(sessionStorage.getItem("navigationContext_quiz")!).quizRun;
    expect(before.skippedReasons[GUID_1]).toBe("picture-inaccessible");
    expect(before.picturePausedAt).toBeNull();
    view.unmount(); renderPage(TEST_URL);
    await screen.findByText("What is 2 + 2?");
    expect(screen.queryByRole("button", { name: "Skip question (not scored)" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit test" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("navigationContext_quiz")!).quizRun.submittedAt).not.toBeNull());
    expect(names(mockTrackEventOnce)).not.toContain("quick_quiz_completed"); expect(questionAnswered()).toEqual([]);
    expect(readGuestHistory()).toEqual([]);
  });

  it("shows only the setup card before Start test and sends nothing", async () => {
    renderPage(TEST_URL);

    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
    expect(screen.getByText("3 questions")).toBeInTheDocument();
    expect(screen.getByLabelText("Time limit")).toHaveValue("none");
    expect(screen.getByRole("button", { name: "Start test" })).toBeEnabled();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Question 1/ })).not.toBeInTheDocument();
    expect(names(mockTrackEventOnce)).not.toContain("quick_quiz_started");
    expect(screen.getByRole("radio", { name: "Test" })).toHaveAttribute("aria-checked", "true");
  });

  it("blocks Start for an invalid custom limit and shows the exact message", async () => {
    renderPage(TEST_URL);
    await screen.findByRole("heading", { name: "Test mode" });

    fireEvent.change(screen.getByLabelText("Time limit"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Custom time limit in minutes"), { target: { value: "601" } });
    expect(screen.getByText("Enter 1 to 600 minutes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Custom time limit in minutes"), { target: { value: "600" } });
    expect(screen.queryByText("Enter 1 to 600 minutes.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start test" })).toBeEnabled();
  });

  it("starts the test: sends quick_quiz_started once and hides every feedback surface", async () => {
    renderPage(TEST_URL);
    await startTest();

    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    expect(names(mockTrackEventOnce).filter((name) => name === "quick_quiz_started")).toHaveLength(1);

    fireEvent.click(option("4"));
    expect(option("4")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/Correct Answer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Basic arithmetic.")).not.toBeInTheDocument();
    expect(screen.queryByTitle("View item details")).not.toBeInTheDocument();
    expect(screen.queryByText("ratings-and-comments")).not.toBeInTheDocument();
    expect(screen.queryByText("collection-controls")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read answer aloud" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Scope toolbar/ })).not.toBeInTheDocument();
    expect(option("4").className).not.toMatch(/green|red/);
    // Quiz size is a collection-scope non-control; the radiogroup stays usable.
    expect(screen.getByRole("radiogroup", { name: "Quiz mode" })).toBeInTheDocument();
  });

  it("replaces an earlier answer, sends nothing per answer, and scores the final answer", async () => {
    renderPage(TEST_URL);
    await startTest();
    await screen.findByText("What is 2 + 2?");

    fireEvent.click(option("1"));
    fireEvent.click(option("4"));
    expect(option("4")).toHaveAttribute("aria-pressed", "true");
    expect(option("1")).toHaveAttribute("aria-pressed", "false");
    expect(mockTrackEventDeferredOnce).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit test" }));
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
  });

  it("toggles the flag and names palette entries with answered, flagged and current", async () => {
    renderPage(TEST_URL);
    await startTest();
    await screen.findByText("What is 2 + 2?");

    expect(screen.getByRole("button", { name: "Question 1, unanswered, current" })).toBeInTheDocument();
    fireEvent.click(option("4"));
    const flag = screen.getByRole("button", { name: "Flag for review" });
    expect(flag).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(flag);
    expect(flag).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Question 1, answered, flagged, current" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 2, unanswered" })).toBeInTheDocument();
    expect(screen.getAllByText("1 answered · 2 unanswered · 1 flagged").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Question 3, unanswered" }));
    expect(await screen.findByText("Largest planet?")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/item/${GUID_3}`);
    expect(screen.getByTestId("location")).toHaveTextContent("mode=test");
    expect(screen.getByRole("button", { name: "Question 3, unanswered, current" })).toBeInTheDocument();
  });

  it("opens the palette sheet on narrow screens and closes it with Escape, returning focus", async () => {
    renderPage(TEST_URL);
    await startTest();
    await screen.findByText("What is 2 + 2?");

    const toggle = screen.getByRole("button", { name: /^Questions 1 of 3/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Question 2, unanswered" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Capital of France?")).toBeInTheDocument();
  });

  it("confirms Submit with counts, focuses Return to test, closes with Escape and jumps to unanswered", async () => {
    renderPage(TEST_URL);
    await startTest();
    await screen.findByText("What is 2 + 2?");
    fireEvent.click(option("4"));
    fireEvent.click(screen.getByRole("button", { name: "Flag for review" }));

    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    const dialog = screen.getByRole("dialog", { name: "Submit test?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("2 unanswered and 1 flagged.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Return to test" })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    fireEvent.click(screen.getByRole("button", { name: "Show unanswered" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Capital of France?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    fireEvent.click(screen.getByRole("button", { name: "Show flagged" }));
    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("says all questions are answered when none are missing", async () => {
    renderPage(TEST_URL);
    await startTest();
    await screen.findByText("What is 2 + 2?");
    fireEvent.click(option("4"));
    fireEvent.click(screen.getByRole("button", { name: "Question 2, unanswered" }));
    await screen.findByText("Capital of France?");
    fireEvent.click(option("Paris"));
    fireEvent.click(screen.getByRole("button", { name: "Question 3, unanswered" }));
    await screen.findByText("Largest planet?");
    fireEvent.click(option("Mars"));

    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    expect(within(screen.getByRole("dialog")).getByText("All 3 questions are answered.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show unanswered" })).not.toBeInTheDocument();
  });

  it("no key opens or confirms Submit; Enter only moves to the next question; F flags", async () => {
    renderPage(TEST_URL);
    await startTest();
    await screen.findByText("What is 2 + 2?");

    fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
    expect(screen.getByRole("button", { name: "Flag for review" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1" });
    expect(screen.getAllByRole("button", { pressed: true }).length).toBeGreaterThan(0);

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(await screen.findByText("Capital of France?")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("Largest planet?")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Largest planet?")).toBeInTheDocument();
  });

  it("publishes one completion, records history once and sends analytics in order at submit", async () => {
    const published: QuizCompletionSnapshot[] = [];
    const listener = (event: Event) => published.push((event as CustomEvent<QuizCompletionSnapshot>).detail);
    window.addEventListener(QUIZ_COMPLETED_EVENT, listener);
    try {
      renderPage(TEST_URL);
      await startTest();
      await screen.findByText("What is 2 + 2?");
      fireEvent.click(option("4"));
      fireEvent.click(screen.getByRole("button", { name: "Question 3, unanswered" }));
      await screen.findByText("Largest planet?");
      fireEvent.click(option("Mars"));
      expect(mockTrackEventDeferredOnce).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit test" }));

      const heading = await screen.findByRole("heading", { name: "Test complete" });
      expect(heading).toHaveFocus();
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(screen.getByText(/33% correct · 2 missed · 1 not answered/)).toBeInTheDocument();
      expect(screen.getByText(/^Time taken \d+:\d{2}$/)).toBeInTheDocument();
      expect(screen.queryByText(/Time ran out/)).not.toBeInTheDocument();

      await waitFor(() => expect(published).toHaveLength(1));
      expect(published[0]).toMatchObject({ correct: 1, total: 3, missedItemIds: [GUID_3, GUID_2] });
      expect(readGuestHistory()).toHaveLength(1);

      // One question_answered per answered question (final correctness, roster position), none for the unanswered one.
      const answered = questionAnswered();
      expect(answered).toHaveLength(2);
      expect(answered).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: GUID_1, isCorrect: true, position: 1 }),
          expect.objectContaining({ itemId: GUID_3, isCorrect: false, position: 3 }),
        ])
      );
      const completed = mockTrackEventOnce.mock.calls.find((call) => (call[1] as { name: string }).name === "quiz_completed");
      expect(completed?.[1]).toMatchObject({ score: 1, total: 3 });
      const lastAnswerOrder = Math.max(...mockTrackEventDeferredOnce.mock.invocationCallOrder);
      expect(mockFlushDeferredAnalyticsEvents.mock.invocationCallOrder.some((order) => order > lastAnswerOrder)).toBe(true);
      expect(mockTrackEventOnce.mock.invocationCallOrder[mockTrackEventOnce.mock.calls.indexOf(completed!)]).toBeGreaterThan(lastAnswerOrder);

      // Review all and Review mistakes (with the unanswered question).
      fireEvent.click(screen.getByRole("button", { name: "Review all" }));
      expect(screen.getByRole("heading", { name: "Review all" })).toBeInTheDocument();
      expect(screen.getByText("Correct")).toBeInTheDocument();
      expect(screen.getByText("Incorrect")).toBeInTheDocument();
      expect(screen.getByText("Not answered")).toBeInTheDocument();
      expect(screen.getAllByText("Question 1").length).toBe(1);
      fireEvent.click(screen.getAllByRole("button", { name: "Back to results" })[0]);
      fireEvent.click(await screen.findByRole("button", { name: "Review mistakes" }));
      expect(screen.getByText("Not answered")).toBeInTheDocument();
      expect(screen.getByText("Capital of France?")).toBeInTheDocument();
      expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: "Back to results" })[0]);
      await screen.findByRole("heading", { name: "Test complete" });
      expect(published).toHaveLength(1);
      expect(names(mockTrackEventOnce).filter((name) => name === "quiz_completed")).toHaveLength(1);
    } finally {
      window.removeEventListener(QUIZ_COMPLETED_EVENT, listener);
    }
  });

  it("Play again returns to the setup card with the same limit and cleared state", async () => {
    renderPage(TEST_URL);
    await startTest("custom-1");
    await screen.findByText("What is 2 + 2?");
    fireEvent.click(option("4"));
    fireEvent.click(screen.getByRole("button", { name: "Flag for review" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit test" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit test" }));
    await screen.findByRole("heading", { name: "Test complete" });
    expect(screen.getByText(/Time taken \d+:\d{2} of 1:00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
    expect(screen.getByLabelText("Time limit")).toHaveValue("custom");
    expect(screen.getByLabelText("Custom time limit in minutes")).toHaveValue("1");
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start test" }));
    await screen.findByText("What is 2 + 2?");
    expect(option("4")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Flag for review" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Question 1, unanswered, current" })).toBeInTheDocument();
    expect(names(mockTrackEventOnce).filter((name) => name === "quick_quiz_started")).toHaveLength(2);
  });

  describe("timer", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: new Date("2026-10-20T10:00:00.000Z") });
    });

    it("counts down from the stored start, styles and announces at 5:00 and 1:00, and auto-submits at zero", async () => {
      renderPage(TEST_URL);
      await startTest("custom-1");
      await screen.findByText("What is 2 + 2?");
      fireEvent.click(option("4"));

      const timer = screen.getByRole("timer");
      expect(timer).toHaveAttribute("aria-live", "off");
      expect(timer).toHaveTextContent("Time left 1:00");
      expect(within(timer).queryByText("5 minutes left")).not.toBeInTheDocument();
      // 1 minute limit is already under the 1:00 mark.
      expect(screen.getByText("1 minute left")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByRole("timer")).toHaveTextContent("Time left 0:50");

      // Late answers are ignored.
      act(() => {
        vi.advanceTimersByTime(49_000);
      });
      expect(screen.getByRole("timer")).toHaveTextContent("Time left 0:01");
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(await screen.findByRole("heading", { name: "Test complete" })).toBeInTheDocument();
      expect(screen.getByText("Time ran out. Your test was submitted automatically.")).toBeInTheDocument();
      expect(screen.getByText("Time taken 1:00 of 1:00")).toBeInTheDocument();
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(names(mockTrackEventOnce).filter((name) => name === "quiz_completed")).toHaveLength(1);
      expect(questionAnswered()).toHaveLength(1);
    });

    it("switches the timer to its warning style and announces 5 minutes once", async () => {
      storedRun({
        startedAt: "2026-10-20T09:56:00.000Z",
        timeLimitSec: 600,
        outcomes: { [GUID_1]: { itemId: GUID_1, selectedAnswer: "4", isCorrect: true, inputMode: "choice" } },
        flagged: [GUID_2],
      });
      renderPage(TEST_URL);

      const timer = await screen.findByRole("timer");
      // 10 minutes limit, 4 minutes elapsed: 6:00 left, no announcement yet.
      expect(timer).toHaveTextContent("Time left 6:00");
      expect(screen.queryByText("5 minutes left")).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(61_000);
      });
      expect(screen.getByRole("timer")).toHaveTextContent("Time left 4:59");
      expect(screen.getByText("5 minutes left")).toBeInTheDocument();
      expect(screen.getByRole("timer").className).toMatch(/amber/);
      // Answers and flags were restored.
      expect(option("4")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Question 2, unanswered, flagged" })).toBeInTheDocument();
    });

    it("recalculates from the wall clock when the tab becomes visible again", async () => {
      renderPage(TEST_URL);
      await startTest("custom-1");
      await screen.findByText("What is 2 + 2?");

      // The background tab was throttled: the clock jumped without any interval tick.
      vi.setSystemTime(new Date("2026-10-20T10:00:45.000Z"));
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(screen.getByRole("timer")).toHaveTextContent("Time left 0:15");
    });

    it("restores an expired started run and submits it with the deadline as completion time", async () => {
      const published: QuizCompletionSnapshot[] = [];
      const listener = (event: Event) => published.push((event as CustomEvent<QuizCompletionSnapshot>).detail);
      window.addEventListener(QUIZ_COMPLETED_EVENT, listener);
      onTestEnd = () => window.removeEventListener(QUIZ_COMPLETED_EVENT, listener);
      storedRun({
        startedAt: "2026-10-20T09:00:00.000Z",
        timeLimitSec: 600,
        outcomes: { [GUID_2]: { itemId: GUID_2, selectedAnswer: "Paris", isCorrect: true, inputMode: "choice" } },
      });
      renderPage(TEST_URL);

      expect(await screen.findByRole("heading", { name: "Test complete" })).toBeInTheDocument();
      expect(screen.getByText("Time ran out. Your test was submitted automatically.")).toBeInTheDocument();
      expect(screen.getByText("Time taken 10:00 of 10:00")).toBeInTheDocument();
      // The run is persisted from an effect after the heading renders; vi.waitFor polls on real timers even while timers are faked.
      await vi.waitFor(() => {
        const stored = JSON.parse(sessionStorage.getItem("navigationContext_quiz")!) as { quizRun: QuizRunState };
        expect(stored.quizRun.submittedAt).toBe("2026-10-20T09:10:00.000Z");
        expect(stored.quizRun.completedAt).toBe("2026-10-20T09:10:00.000Z");
      });
      expect(published).toHaveLength(1);
      expect(names(mockTrackEventOnce).filter((name) => name === "quiz_completed")).toHaveLength(1);
      expect(readGuestHistory()).toHaveLength(1);
    });
  });

  it("restores a started test with answers, flags and the question after a reload", async () => {
    let run = createQuizRun({ kind: "collection", collectionId: COLLECTION_ID }, [GUID_1, GUID_2, GUID_3], IDENTITY, "test");
    run = reduceQuizRun(run, { type: "start-test", startedAt: new Date().toISOString(), timeLimitSec: null });
    run = reduceQuizRun(run, { type: "answer", itemId: GUID_1, selectedAnswer: "1", isCorrect: false, completedAt: new Date().toISOString() });
    run = reduceQuizRun(run, { type: "toggle-flag", itemId: GUID_1 });
    sessionStorage.setItem("navigationContext_quiz", JSON.stringify({ mode: "quiz", collectionId: COLLECTION_ID, quizRun: run }));
    renderPage(TEST_URL);

    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    expect(option("1")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Question 1, answered, flagged, current" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Test mode" })).not.toBeInTheDocument();
    expect(screen.queryByText(/We could not restore/)).not.toBeInTheDocument();
  });

  it("does not repeat completion on remount of a submitted Test snapshot", async () => {
    const published: QuizCompletionSnapshot[] = [];
    const listener = (event: Event) => published.push((event as CustomEvent<QuizCompletionSnapshot>).detail);
    window.addEventListener(QUIZ_COMPLETED_EVENT, listener);
    try {
      let run = createQuizRun({ kind: "collection", collectionId: COLLECTION_ID }, [GUID_1, GUID_2, GUID_3], IDENTITY, "test");
      run = reduceQuizRun(run, { type: "start-test", startedAt: "2026-10-20T09:00:00.000Z", timeLimitSec: null });
      run = reduceQuizRun(run, { type: "answer", itemId: GUID_1, selectedAnswer: "4", isCorrect: true, completedAt: "2026-10-20T09:01:00.000Z" });
      run = reduceQuizRun(run, { type: "submit", submittedAt: "2026-10-20T09:05:00.000Z", reason: "manual" });
      run = reduceQuizRun(run, { type: "mark-completion-emitted" });
      expect(run.completionEmitted).toBe(true);
      sessionStorage.setItem("navigationContext_quiz", JSON.stringify({ mode: "quiz", collectionId: COLLECTION_ID, quizRun: run }));

      renderPage(TEST_URL);
      expect(await screen.findByRole("heading", { name: "Test complete" })).toBeInTheDocument();
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(screen.queryByText("We could not restore your earlier test, so we started a new one.")).not.toBeInTheDocument();
      expect(published).toHaveLength(0);
      expect(readGuestHistory()).toHaveLength(0);
      expect(names(mockTrackEventOnce)).not.toContain("quiz_completed");
      expect(mockTrackEventDeferredOnce).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(QUIZ_COMPLETED_EVENT, listener);
    }
  });

  it("starts a new run with a notice for a version 1 snapshot or a mode mismatch", async () => {
    storedRun({ startedAt: new Date().toISOString(), timeLimitSec: null, schemaVersion: 1 as never });
    const { unmount } = renderPage(TEST_URL);
    expect(await screen.findByText("We could not restore your earlier test, so we started a new one.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
    unmount();

    sessionStorage.clear();
    sessionStorage.setItem(
      "navigationContext_quiz",
      JSON.stringify({
        mode: "quiz",
        collectionId: COLLECTION_ID,
        quizRun: createQuizRun({ kind: "collection", collectionId: COLLECTION_ID }, [GUID_1, GUID_2, GUID_3], IDENTITY),
      })
    );
    renderPage(TEST_URL);
    expect(await screen.findByText("We could not restore your earlier test, so we started a new one.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
  });

  it("switches silently with no answers, and keeps mode=test across Next and Prev", async () => {
    renderPage(PRACTICE_URL);
    await screen.findByText("What is 2 + 2?");
    expect(screen.getByRole("radio", { name: "Practice" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Test" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("mode=test");

    fireEvent.click(screen.getByRole("button", { name: "Start test" }));
    await screen.findByText("What is 2 + 2?");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Capital of France?");
    expect(screen.getByTestId("location")).toHaveTextContent(`/item/${GUID_2}?return=`.replace("?return=", ""));
    expect(screen.getByTestId("location")).toHaveTextContent("mode=test");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("What is 2 + 2?");
    expect(screen.getByTestId("location")).toHaveTextContent("mode=test");
  });

  it("asks before leaving a run with answers: Keep current run, then Switch and restart", async () => {
    renderPage(PRACTICE_URL);
    await screen.findByText("What is 2 + 2?");
    fireEvent.click(option("4"));
    expect(await screen.findByText(/Correct Answer: 4/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Test" }));
    const dialog = screen.getByRole("dialog", { name: "Switch to Test?" });
    expect(within(dialog).getByRole("button", { name: "Keep current run" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(/Correct Answer: 4/)).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("mode=test");

    fireEvent.click(screen.getByRole("radio", { name: "Test" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch and restart" }));
    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
    expect(screen.queryByText(/We could not restore/)).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("mode=test");

    // Back to Practice: the parameter is removed.
    fireEvent.click(screen.getByRole("radio", { name: "Practice" }));
    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("mode=test");
  });

  it("keeps Explore and List links free of mode=test", async () => {
    renderPage(TEST_URL);
    await screen.findByRole("heading", { name: "Test mode" });
    fireEvent.click(screen.getByRole("tab", { name: /Flashcards/i }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toMatch(/^\/explore\//));
    expect(screen.getByTestId("location").textContent).not.toContain("mode=");
  });

  it("keeps mode=test when the quiz size changes on the setup card, and disables Quiz size once started", async () => {
    vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: [item1, item2, item3] } as Awaited<ReturnType<typeof itemsApi.getRandom>>);
    vi.mocked(itemsApi.getById).mockResolvedValue(item1 as Awaited<ReturnType<typeof itemsApi.getById>>);
    renderPage(`/quiz/item/${GUID_1}?mode=test`);
    await screen.findByRole("heading", { name: "Test mode" });

    const size = screen.getByLabelText("Quiz size:");
    expect(size).toBeEnabled();
    fireEvent.change(size, { target: { value: "3" } });
    fireEvent.blur(size);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("mode=test"));
    expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start test" }));
    expect(await screen.findByLabelText("Quiz size:")).toBeDisabled();
  });

  it("shows an empty message without a run when no question is playable", async () => {
    vi.mocked(collectionsApi.getItems).mockResolvedValue({
      items: [{ ...item1, incorrectAnswers: [] }],
    } as Awaited<ReturnType<typeof collectionsApi.getItems>>);
    renderPage(TEST_URL);

    expect(await screen.findByText("No multiple-choice questions are available for Test here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start test" })).not.toBeInTheDocument();
    expect(names(mockTrackEventOnce)).not.toContain("quick_quiz_started");
    expect(screen.getByRole("button", { name: "Switch to Practice" })).toBeInTheDocument();
  });

  it("caps the roster at 500 questions and says so", async () => {
    const many = Array.from({ length: 520 }, (_, index) => ({
      ...item1,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      question: `Question text ${index}`,
    }));
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: many } as Awaited<ReturnType<typeof collectionsApi.getItems>>);
    renderPage(`/quiz/collections/${COLLECTION_ID}?mode=test`);

    expect(await screen.findByText("500 questions")).toBeInTheDocument();
    expect(screen.getByText("Your test will use 500 of 520.")).toBeInTheDocument();
  });

  describe("category Test restore keeps the saved quiz size (AC 3.6.12, 3.18.7)", () => {
    it.each([5, 10])("restores a started size-%i category Test without setup or a new roster", async (size) => {
      const startedAt = new Date(Date.now() - 60_000).toISOString();
      storeCategoryTest(size, startedAt);
      renderPage(CATEGORY_TEST_URL);

      expect(await screen.findByText("Sized question 1")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Test mode" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start test" })).not.toBeInTheDocument();
      expect(option("1")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Question 1, answered, flagged, current" })).toBeInTheDocument();
      expect(screen.getByRole("timer")).toBeInTheDocument();
      const sizeInput = screen.getByLabelText("Quiz size:");
      expect(sizeInput).toHaveValue(size);
      expect(sizeInput).toBeDisabled();
      expect(screen.queryByText(/Only \d+ questions? available/)).not.toBeInTheDocument();
      expect(screen.queryByText(/We could not restore/)).not.toBeInTheDocument();
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
      const stored = JSON.parse(sessionStorage.getItem("navigationContext_quiz")!) as { quizRun: QuizRunState };
      expect(stored.quizRun.startedAt).toBe(startedAt);
    });

    it("ignores the saved size when the roster comes from the Categories list", async () => {
      storeCategoryTest(5, new Date(Date.now() - 60_000).toISOString());
      sessionStorage.setItem(
        "quiz_scope_items_from_categories",
        JSON.stringify({ items: [item1, item2, item3] })
      );
      renderPage(CATEGORY_TEST_URL);

      expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
      expect(screen.getByLabelText("Quiz size:")).toHaveValue(10);
      expect(screen.getByLabelText("Quiz size:")).toBeEnabled();
    });
  });

  describe("restore waits for auth to settle (AC 3.6.12, 3.18.7, #393)", () => {
    function settleAs(isAuthenticated: boolean, userId?: string): void {
      mockAuth.isLoading = false;
      mockAuth.isAuthenticated = isAuthenticated;
      mockAuth.userId = userId;
    }

    function startLoading(): void {
      mockAuth.isLoading = true;
      mockAuth.isAuthenticated = false;
      mockAuth.userId = undefined;
    }

    it.each([5, 10])("restores a signed-in size-%i category Test after auth loading", async (size) => {
      const startedAt = new Date(Date.now() - 60_000).toISOString();
      storeCategoryTest(size, startedAt, "user:user-1");
      const before = sessionStorage.getItem("navigationContext_quiz");
      startLoading();
      const { rerenderPage } = renderPage(CATEGORY_TEST_URL);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Test mode" })).not.toBeInTheDocument();
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("navigationContext_quiz")).toBe(before);

      settleAs(true, "user-1");
      rerenderPage();

      expect(await screen.findByText("Sized question 1")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start test" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Question 1, answered, flagged, current" })).toBeInTheDocument();
      expect(screen.getByRole("timer")).toBeInTheDocument();
      const sizeInput = screen.getByLabelText("Quiz size:");
      expect(sizeInput).toHaveValue(size);
      expect(sizeInput).toBeDisabled();
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
      const stored = JSON.parse(sessionStorage.getItem("navigationContext_quiz")!) as { quizRun: QuizRunState };
      expect(stored.quizRun.startedAt).toBe(startedAt);
    });

    it("still restores a guest size-5 Test after auth loading", async () => {
      storeCategoryTest(5, new Date(Date.now() - 60_000).toISOString());
      startLoading();
      const { rerenderPage } = renderPage(CATEGORY_TEST_URL);
      expect(screen.getByRole("status")).toBeInTheDocument();

      settleAs(false);
      rerenderPage();

      expect(await screen.findByText("Sized question 1")).toBeInTheDocument();
      expect(screen.getByLabelText("Quiz size:")).toHaveValue(5);
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
    });

    it("does not restore a run saved by another user", async () => {
      storeCategoryTest(5, new Date(Date.now() - 60_000).toISOString(), "user:other");
      startLoading();
      const { rerenderPage } = renderPage(CATEGORY_TEST_URL);

      settleAs(true, "user-1");
      rerenderPage();

      expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
      expect(screen.getByLabelText("Quiz size:")).toHaveValue(10);
      await waitFor(() => {
        const stored = JSON.parse(sessionStorage.getItem("navigationContext_quiz")!) as { quizRun?: QuizRunState };
        expect(stored.quizRun?.identityKey).toBe("user:user-1");
        expect(stored.quizRun?.flagged ?? []).toEqual([]);
      });
    });

    it("does not restore a saved user run for a settled guest", async () => {
      storeCategoryTest(5, new Date(Date.now() - 60_000).toISOString(), "user:user-1");
      settleAs(false);
      renderPage(CATEGORY_TEST_URL);

      expect(await screen.findByRole("heading", { name: "Test mode" })).toBeInTheDocument();
      expect(screen.getByLabelText("Quiz size:")).toHaveValue(10);
    });
  });
});
