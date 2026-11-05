import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import QuizModePage from "./QuizModePage";
import { itemsApi } from "@/api/items";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import { collectionsApi } from "@/api/collections";
import { QUIZ_COMPLETED_EVENT, createQuizRun, reduceQuizRun, seedQuizRoster, type QuizCompletionSnapshot, type QuizRunState } from "@/features/items/quiz/quizRun";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import {
  GUEST_HISTORY_STORAGE_KEY,
  readGuestHistory,
  resetGuestHistoryMemoryForTests,
} from "@/features/guestHistory/guestHistoryStorage";

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

const { navigateCalls } = vi.hoisted(() => ({ navigateCalls: [] as string[] }));

// Records the target of every navigate(to) call and delegates to the real router.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  const react = await import("react");
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return react.useCallback(
        (to: unknown, options?: unknown) => {
          if (typeof to === "string") navigateCalls.push(to);
          return (navigate as (a: unknown, b?: unknown) => unknown)(to, options);
        },
        [navigate]
      );
    },
  };
});

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { isAuthenticated: true, isLoading: false, userId: "user-1" as string | undefined },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

vi.mock("@/api/items", () => ({
  itemsApi: {
    getRandom: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock("@/api/categories", () => ({
  categoriesApi: {
    getAll: vi.fn(),
  },
}));

vi.mock("@/api/keywords", () => ({
  keywordsApi: {
    getKeywordDescriptions: vi.fn(),
  },
}));

vi.mock("@/api/collections", () => ({
  collectionsApi: {
    getItems: vi.fn(),
    getById: vi.fn(),
    getRating: vi.fn(),
  },
}));

vi.mock("@/components/CommentsDrawer", () => ({
  CommentsDrawer: () => null,
}));

vi.mock("@/components/ItemCollectionsModal", () => ({
  default: () => null,
}));

vi.mock("@/components/ItemRatingsComments", () => ({
  default: () => null,
}));

vi.mock("@/components/ItemCollectionControls", () => ({
  ItemCollectionControls: () => null,
}));

const item = {
  id: "item-1",
  category: "exams",
  isPrivate: false,
  question: "What is 2 + 2?",
  correctAnswer: "4",
  incorrectAnswers: ["1", "2", "3"],
  explanation: "Basic arithmetic.",
  createdAt: "2026-03-22T00:00:00Z",
  keywords: [],
  collections: [],
};

const secondItem = {
  ...item,
  id: "item-2",
  question: "What is the capital of France?",
  correctAnswer: "Paris",
  incorrectAnswers: ["Rome", "Berlin", "Madrid"],
  explanation: "Paris is the capital of France.",
};

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      test-back
    </button>
  );
}

function renderPageWithEntries(initialEntries: string[], initialIndex?: number) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const buildPage = () => (
    <>
      <QuizModePage />
      <LocationDisplay />
      <BackButton />
    </>
  );

  const buildTree = () => {
    const page = buildPage();
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
          <Routes>
            <Route path="/quiz/item/:itemId" element={page} />
            <Route path="/quiz/:category/item/:itemId" element={page} />
            <Route path="/quiz/:category" element={page} />
            <Route path="/quiz/collections/:collectionId/item/:itemId" element={page} />
            <Route path="/quiz/collections/:collectionId/:slug/item/:itemId" element={page} />
            <Route path="/quiz/collections/:collectionId/:slug" element={page} />
            <Route path="/categories/:category/:kw1/:kw2" element={<LocationDisplay />} />
            <Route path="/prev" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
  const view = render(buildTree());
  return { ...view, queryClient, rerenderPage: () => view.rerender(buildTree()) };
}

function renderPage(initialEntry: string) {
  return renderPageWithEntries([initialEntry]);
}

describe("QuizModePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    navigateCalls.length = 0;
    sessionStorage.clear();
    mockAuth.isAuthenticated = true;
    mockAuth.isLoading = false;
    mockAuth.userId = "user-1";
    installMemoryLocalStorage();
    resetGuestHistoryMemoryForTests();

    vi.mocked(categoriesApi.getAll).mockResolvedValue({
      categories: [{ category: "exams" }],
    } as Awaited<ReturnType<typeof categoriesApi.getAll>>);

    vi.mocked(itemsApi.getRandom).mockResolvedValue({
      items: [item],
    } as Awaited<ReturnType<typeof itemsApi.getRandom>>);

    vi.mocked(itemsApi.getAll).mockResolvedValue({
      items: [item],
      totalCount: 623,
      page: 1,
      pageSize: 1,
      totalPages: 623,
    } as Awaited<ReturnType<typeof itemsApi.getAll>>);

    vi.mocked(itemsApi.getById).mockResolvedValue(
      item as Awaited<ReturnType<typeof itemsApi.getById>>
    );

    vi.mocked(keywordsApi.getKeywordDescriptions).mockResolvedValue({
      keywords: [
        { description: "ACT exam" },
        { description: "Math section" },
      ],
    } as Awaited<ReturnType<typeof keywordsApi.getKeywordDescriptions>>);

    vi.mocked(collectionsApi.getItems).mockResolvedValue({
      items: [item, secondItem],
    } as Awaited<ReturnType<typeof collectionsApi.getItems>>);
    vi.mocked(collectionsApi.getById).mockResolvedValue({
      id: "collection-1",
      name: "Practice Set",
      description: "Two questions",
      itemCount: 2,
      createdBy: "user-1",
      createdAt: "2026-10-15T00:00:00Z",
      isPublic: true,
    } as Awaited<ReturnType<typeof collectionsApi.getById>>);
    vi.mocked(collectionsApi.getRating).mockResolvedValue({
      averageStars: null,
      count: 0,
      myStars: null,
    });
  });

  it("seeds the quiz size from the size deep link (clamped to 1-50) and strips it from the URL (#462)", async () => {
    renderPage("/quiz/exams?size=999");

    expect(await screen.findByLabelText("Quiz size:")).toHaveValue(50);
    await waitFor(() => expect(itemsApi.getRandom).toHaveBeenCalled());
    expect(vi.mocked(itemsApi.getRandom).mock.calls[0][1]).toBe(50);
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("size="));
  });

  it("ignores an invalid size deep link and keeps the default size (#462)", async () => {
    renderPage("/quiz/exams/item/item-1?size=abc");

    expect(await screen.findByLabelText("Quiz size:")).toHaveValue(10);
  });

  it("shows the shared leaf scope header and keeps Sets hidden in quiz mode", async () => {
    const user = userEvent.setup({ delay: null });

    renderPage(
      "/quiz/exams/item/item-1?nav=act,math&keywords=act,math,algebra"
    );

    expect(
      await screen.findByText(/Test your knowledge with interactive quizzes/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/item count/i)).toHaveTextContent("(623)");
    expect(screen.getByRole("button", { name: "act" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "math" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "algebra" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /sets/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Quiz Mode/i })
    ).not.toBeInTheDocument();

    await waitFor(() =>
      expect(keywordsApi.getKeywordDescriptions).toHaveBeenCalledWith("exams", [
        "act",
        "math",
      ])
    );

    await waitFor(() =>
      expect(itemsApi.getAll).toHaveBeenCalledWith(
        "exams",
        undefined,
        ["algebra"],
        undefined,
        undefined,
        1,
        1,
        { navigationKeywords: ["act", "math"] }
      )
    );

    await user.click(screen.getByRole("tab", { name: /list/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/categories/exams/act/math?view=items&keywords=algebra"
      )
    );
  });

  it("locks first answers, completes a collection, reviews mistakes, and replays", async () => {
    const user = userEvent.setup({ delay: null });
    const completions: QuizCompletionSnapshot[] = [];
    const onComplete = (event: Event) => {
      completions.push((event as CustomEvent<QuizCompletionSnapshot>).detail);
    };
    window.addEventListener(QUIZ_COMPLETED_EVENT, onComplete);

    renderPage("/quiz/collections/collection-1/practice+set/item/item-1");

    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /4/i }));
    expect(screen.getByText(/Correct Answer: 4/i)).toBeInTheDocument();
    expect(screen.getByText(/Score: 1 \/ 1 correct/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText("What is the capital of France?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Rome/i }));

    expect(screen.getByText(/You answered every question/i)).toBeInTheDocument();
    await waitFor(() => expect(completions).toHaveLength(1));
    expect(completions[0]).toMatchObject({ correct: 1, total: 2, missedItemIds: ["item-2"] });

    await user.click(screen.getByRole("button", { name: /view results/i }));
    expect(screen.getByRole("heading", { name: /quiz complete/i })).toHaveFocus();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText(/50% correct · 1 missed/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /review mistakes/i }));
    expect(screen.getByRole("heading", { name: /review mistakes/i })).toHaveFocus();
    expect(screen.getByText(/Your answer:/i).closest("p")).toHaveTextContent("Rome");
    expect(screen.getByText(/Correct answer:/i).closest("p")).toHaveTextContent("Paris");
    expect(screen.getByText(/Paris is the capital of France/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to results/i }));
    await user.click(screen.getByRole("button", { name: /play again/i }));
    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.getByText(/Score: 0 \/ 0 correct/i)).toBeInTheDocument();
    expect(completions).toHaveLength(1);

    // Funnel telemetry (AC 5.4.9): one start and one completion for the run, then a new start for the replay.
    const telemetry = mockTrackEventOnce.mock.calls.map(([, input]) => input);
    expect(telemetry).toEqual([
      expect.objectContaining({ name: "quick_quiz_started", total: 2, contextType: "collection", contextId: "collection-1" }),
      expect.objectContaining({ name: "quiz_completed", score: 1, total: 2, contextType: "collection", contextId: "collection-1" }),
      expect.objectContaining({ name: "quick_quiz_started", total: 2 }),
    ]);
    expect(telemetry[1].runId).toBe(telemetry[0].runId);
    expect(telemetry[1].runId).toBe(completions[0].runId);
    expect(telemetry[2].runId).not.toBe(telemetry[0].runId);

    window.removeEventListener(QUIZ_COMPLETED_EVENT, onComplete);
  });

  it("records one anonymous completion in browser-local guest history and a replay adds one more", async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.userId = undefined;
    const user = userEvent.setup({ delay: null });
    const view = renderPage("/quiz/collections/collection-1/practice+set/item/item-1");

    await user.click(await screen.findByRole("button", { name: /4/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(await screen.findByRole("button", { name: /Rome/i }));
    await waitFor(() => expect(readGuestHistory()).toHaveLength(1));
    expect(readGuestHistory()[0]).toMatchObject({ correct: 1, total: 2 });
    // Non-GUID test identifiers are not persisted as practice sources or missed references.
    expect(readGuestHistory()[0]).toMatchObject({ source: null, missedItemIds: [] });
    expect(localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).not.toMatch(/What is|Paris|Rome/);

    // Remounting the completed run (reload restore) must not duplicate it.
    view.unmount();
    renderPage("/quiz/collections/collection-1/practice+set/item/item-2");
    await user.click(await screen.findByRole("button", { name: /view results/i }));
    expect(readGuestHistory()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /play again/i }));
    await user.click(await screen.findByRole("button", { name: /4/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(await screen.findByRole("button", { name: /Paris/i }));
    await waitFor(() => expect(readGuestHistory()).toHaveLength(2));
  });

  it("never copies an authenticated completion into guest history", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage("/quiz/collections/collection-1/practice+set/item/item-1");

    await user.click(await screen.findByRole("button", { name: /4/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(await screen.findByRole("button", { name: /Rome/i }));
    expect(await screen.findByText(/You answered every question/i)).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("restores submitted feedback when navigating back without inflating score", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage("/quiz/collections/collection-1/practice+set/item/item-1");

    await user.click(await screen.findByRole("button", { name: /4/i }));
    await user.click(screen.getByRole("button", { name: /^next$/i }));
    await user.click(screen.getByRole("button", { name: /Rome/i }));
    await user.click(screen.getByRole("button", { name: /^previous$/i }));

    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.getByText(/Correct Answer: 4/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /4/i })).toBeDisabled();
    expect(screen.getByText(/Score: 1 \/ 2 correct/i)).toBeInTheDocument();
  });

  it("restores a locked answer after reload", async () => {
    const user = userEvent.setup({ delay: null });
    const firstRender = renderPage("/quiz/collections/collection-1/practice+set/item/item-1");

    await user.click(await screen.findByRole("button", { name: /4/i }));
    expect(screen.getByText(/Correct Answer: 4/i)).toBeInTheDocument();
    firstRender.unmount();

    renderPage("/quiz/collections/collection-1/practice+set/item/item-1");
    expect(await screen.findByText(/Correct Answer: 4/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /4/i })).toBeDisabled();
    expect(screen.getByText(/Score: 1 \/ 1 correct/i)).toBeInTheDocument();
  });

  it("restores a signed-in size-5 Practice category run with a locked answer after auth loading (#393)", async () => {
    const ids = ["item-1", "item-2", "item-3", "item-4", "item-5"];
    const items = ids.map((id) => ({ ...item, id, question: `Sized question ${id}` }));
    let run = createQuizRun(
      { kind: "category", category: "exams", navigationKeywords: [], filterKeywords: [], quizSize: 5 },
      ids,
      "user:user-1",
    );
    run = reduceQuizRun(run, {
      type: "answer",
      itemId: "item-1",
      selectedAnswer: "4",
      isCorrect: true,
      completedAt: new Date().toISOString(),
    });
    sessionStorage.setItem(
      "navigationContext_quiz",
      JSON.stringify({ mode: "quiz", category: "exams", currentIndex: 0, itemIds: ids, items, quizRun: run }),
    );
    mockAuth.isLoading = true;
    mockAuth.isAuthenticated = false;
    mockAuth.userId = undefined;

    const { rerenderPage } = renderPage("/quiz/exams/item/item-1");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(itemsApi.getRandom).not.toHaveBeenCalled();

    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = true;
    mockAuth.userId = "user-1";
    rerenderPage();

    expect(await screen.findByText("Sized question item-1")).toBeInTheDocument();
    expect(screen.getByLabelText("Quiz size:")).toHaveValue(5);
    expect(screen.getByText(/Correct Answer: 4/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^[A-D]\. 4$/ })).toBeDisabled();
    expect(itemsApi.getRandom).not.toHaveBeenCalled();
  });

  it("restores a size-5 Practice category run with its answer locked and the size control at 5", async () => {
    const ids = ["item-1", "item-2", "item-3", "item-4", "item-5"];
    const items = ids.map((id) => ({ ...item, id, question: `Sized question ${id}` }));
    let run = createQuizRun(
      { kind: "category", category: "exams", navigationKeywords: [], filterKeywords: [], quizSize: 5 },
      ids,
      "user:user-1",
    );
    run = reduceQuizRun(run, {
      type: "answer",
      itemId: "item-1",
      selectedAnswer: "4",
      isCorrect: true,
      completedAt: new Date().toISOString(),
    });
    sessionStorage.setItem(
      "navigationContext_quiz",
      JSON.stringify({ mode: "quiz", category: "exams", currentIndex: 0, itemIds: ids, items, quizRun: run }),
    );

    renderPage("/quiz/exams/item/item-1");

    expect(await screen.findByText("Sized question item-1")).toBeInTheDocument();
    expect(screen.getByLabelText("Quiz size:")).toHaveValue(5);
    expect(screen.getByText(/Correct Answer: 4/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^[A-D]\. 4$/ })).toBeDisabled();
    expect(itemsApi.getRandom).not.toHaveBeenCalled();

    // A real size change after the restore still starts a new random set (AC 3.6.5).
    const size = screen.getByLabelText("Quiz size:");
    fireEvent.change(size, { target: { value: "3" } });
    fireEvent.blur(size);
    await waitFor(() => expect(itemsApi.getRandom).toHaveBeenCalled());
    await waitFor(() => {
      const stored = sessionStorage.getItem("navigationContext_quiz");
      const storedRun = stored ? (JSON.parse(stored) as { quizRun?: QuizRunState }).quizRun : undefined;
      expect(storedRun?.scope).not.toMatchObject({ quizSize: 5 });
    });
  });

  it("keeps an authenticated category quiz playable when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    const user = userEvent.setup({ delay: null });

    renderPage("/quiz/exams/item/item-1?nav=act,math&keywords=act,math,algebra");
    await user.click(await screen.findByRole("button", { name: /4/i }));
    expect(screen.getByText(/You answered every question/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view results/i }));
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /review mistakes/i })).not.toBeInTheDocument();
  });

  it("counts only the first answer during rapid submissions", async () => {
    renderPage("/quiz/exams/item/item-1?nav=act,math&keywords=act,math,algebra");
    const wrongAnswer = await screen.findByRole("button", { name: /1/i });
    const correctAnswer = screen.getByRole("button", { name: /4/i });

    act(() => {
      fireEvent.click(wrongAnswer);
      fireEvent.click(correctAnswer);
    });

    expect(screen.getByText(/Score: 0 \/ 1 correct/i)).toBeInTheDocument();
    expect(wrongAnswer).toBeDisabled();
    // AC 5.5.2: the first call carries the scored (wrong) answer. The deferred tracker's own
    // key-based dedupe (verified in analyticsEvents.test.tsx) drops any later call for the same item.
    expect(mockTrackEventDeferredOnce.mock.calls[0][1]).toMatchObject({
      name: "question_answered",
      itemId: "item-1",
      position: 1,
      isCorrect: false,
    });
  });

  it("flushes deferred analytics events when leaving the quiz", async () => {
    const { unmount } = renderPage(
      "/quiz/exams/item/item-1?nav=act,math&keywords=act,math,algebra"
    );
    await screen.findByText("What is 2 + 2?");
    mockFlushDeferredAnalyticsEvents.mockClear();

    unmount();

    expect(mockFlushDeferredAnalyticsEvents).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state without completing an empty collection", async () => {
    vi.mocked(collectionsApi.getItems).mockResolvedValueOnce({ items: [] });
    renderPage("/quiz/collections/collection-1/practice+set");

    expect(await screen.findByText(/no playable quiz items/i)).toBeInTheDocument();
    expect(screen.queryByText(/quiz complete/i)).not.toBeInTheDocument();
  });

  it("leaves legacy unplayable items out of a collection quiz roster", async () => {
    // AC 3.6.17
    const legacy = { ...secondItem, id: "item-legacy", incorrectAnswers: ["  ", ""] };
    vi.mocked(collectionsApi.getItems).mockResolvedValueOnce({ items: [legacy, item] });
    renderPage("/quiz/collections/collection-1/practice+set");

    expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.queryByText(legacy.question)).not.toBeInTheDocument();
  });

  it("shows the empty state when every collection item is unplayable", async () => {
    // AC 3.6.17
    const legacy = { ...item, incorrectAnswers: [] };
    vi.mocked(collectionsApi.getItems).mockResolvedValueOnce({ items: [legacy] });
    renderPage("/quiz/collections/collection-1/practice+set");

    expect(await screen.findByText(/no playable quiz items/i)).toBeInTheDocument();
  });

  it("shows No items found for a deep link to an unplayable item", async () => {
    // AC 3.6.17
    const legacy = { ...item, incorrectAnswers: [""] };
    vi.mocked(itemsApi.getById).mockResolvedValue(legacy as Awaited<ReturnType<typeof itemsApi.getById>>);
    vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: [legacy] } as Awaited<
      ReturnType<typeof itemsApi.getRandom>
    >);
    vi.mocked(itemsApi.getAll).mockResolvedValue({
      items: [legacy],
      totalCount: 1,
      page: 1,
      pageSize: 1,
      totalPages: 1,
    } as Awaited<ReturnType<typeof itemsApi.getAll>>);
    renderPage("/quiz/exams/item/item-1");

    expect(await screen.findByText(/no items found/i)).toBeInTheDocument();
    // AC 3.6.17 (#275): with nothing playable the URL is left unchanged.
    expect(screen.getByTestId("location")).toHaveTextContent("/quiz/exams/item/item-1");
  });

  it("shows a retryable public browse route when a collection quiz fails", async () => {
    vi.mocked(collectionsApi.getItems).mockRejectedValueOnce(new Error("gone"));
    renderPage("/quiz/collections/collection-1/practice+set/item/item-1");

    expect(await screen.findByText(/collection quiz is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse categories/i })).toHaveAttribute("href", "/categories");
  });

  describe("deep link to an item outside the playable roster", () => {
    const legacy = {
      ...secondItem,
      id: "item-legacy",
      question: "Legacy unplayable question?",
      correctAnswer: "4",
      incorrectAnswers: ["  ", "4"],
    };
    const elsewhere = {
      ...secondItem,
      id: "item-elsewhere",
      question: "Playable item outside the random set?",
    };

    // The page briefly shows a spinner while the new URL's single-item query loads, so wait for the
    // location and the playable question together instead of asserting them one after the other.
    async function expectShown(location: string | RegExp, question: string, hidden?: string) {
      await waitFor(() => {
        expect(screen.getByTestId("location")).toHaveTextContent(location);
        expect(screen.getByText(question)).toBeInTheDocument();
      });
      if (hidden) expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }

    function mockRoster(items: unknown[]) {
      vi.mocked(itemsApi.getRandom).mockResolvedValue({ items } as Awaited<
        ReturnType<typeof itemsApi.getRandom>
      >);
    }

    function mockById(...known: Array<{ id: string }>) {
      vi.mocked(itemsApi.getById).mockImplementation(
        async (id: string) =>
          known.find((k) => k.id === id) as Awaited<ReturnType<typeof itemsApi.getById>>
      );
    }

    it("replaces an unplayable category deep link with the item shown", async () => {
      // AC 3.6.17 (#275)
      mockRoster([legacy, item, secondItem]);
      mockById(legacy, item, secondItem);
      renderPage("/quiz/exams/item/item-legacy");

      await expectShown("/quiz/exams/item/item-1", "What is 2 + 2?", legacy.question);
    });

    it("keeps the return query parameter when rewriting", async () => {
      // AC 3.6.17 (#275)
      mockRoster([legacy, item, secondItem]);
      mockById(legacy, item, secondItem);
      renderPage("/quiz/exams/item/item-legacy?return=%2Fcategories");

      await expectShown("/quiz/exams/item/item-1?return=%2Fcategories", "What is 2 + 2?");
    });

    it.each(["%2F%2Fevil.com", "%2F%5Cevil.com", "https%3A%2F%2Fevil.com"])(
      "drops the unsafe return value %s instead of forwarding it (AC 4.3.5c)",
      async (bad) => {
        mockRoster([legacy, item, secondItem]);
        mockById(legacy, item, secondItem);
        renderPage(`/quiz/exams/item/item-legacy?return=${bad}`);

        await expectShown("/quiz/exams/item/item-1", "What is 2 + 2?", legacy.question);
        expect(screen.getByTestId("location")).not.toHaveTextContent("evil");
        expect(screen.getByTestId("location")).not.toHaveTextContent("return=");
      }
    );

    it("rewrites a collection deep link to the unplayable item", async () => {
      // AC 3.6.17 (#275)
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [legacy, item, secondItem] });
      renderPage("/quiz/collections/collection-1/practice+set/item/item-legacy");

      await expectShown(
        "/quiz/collections/collection-1/practice+set/item/item-1",
        "What is 2 + 2?",
        legacy.question
      );
    });

    it("rewrites a slugless collection deep link to the canonical slug and starts once", async () => {
      // AC 3.6.17 (#275)
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [legacy, item, secondItem] });
      renderPage("/quiz/collections/collection-1/item/item-legacy");

      await expectShown(
        "/quiz/collections/collection-1/practice+set/item/item-1",
        "What is 2 + 2?"
      );
      const starts = mockTrackEventOnce.mock.calls.filter(
        ([, input]) => input?.name === "quick_quiz_started"
      );
      expect(starts).toHaveLength(1);
    });

    it("adds the canonical slug even when collection details resolve after the items", async () => {
      // AC 3.6.17 (#275)
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [legacy, item, secondItem] });
      let resolveInfo: (value: Awaited<ReturnType<typeof collectionsApi.getById>>) => void = () => {};
      vi.mocked(collectionsApi.getById).mockReturnValue(
        new Promise((resolve) => {
          resolveInfo = resolve;
        })
      );
      renderPage("/quiz/collections/collection-1/item/item-legacy");

      // Let the items settle first; the location must not be rewritten without the slug.
      await screen.findByText("What is 2 + 2?");
      expect(screen.getByTestId("location")).toHaveTextContent(
        /^\/quiz\/collections\/collection-1\/item\/item-legacy$/
      );

      await act(async () => {
        resolveInfo({
          id: "collection-1",
          name: "Practice Set",
        } as Awaited<ReturnType<typeof collectionsApi.getById>>);
      });

      await expectShown(
        "/quiz/collections/collection-1/practice+set/item/item-1",
        "What is 2 + 2?"
      );
    });

    function startEvents() {
      return mockTrackEventOnce.mock.calls.filter(
        ([, input]) => input?.name === "quick_quiz_started"
      );
    }

    // AC 3.6.17 (#278)
    it("starts a cold global deep link on the linked item and keeps the roster across Next/Prev", async () => {
      const user = userEvent.setup({ delay: null });
      mockRoster([item, secondItem]);
      mockById(elsewhere, item, secondItem);
      renderPage("/quiz/item/item-elsewhere");

      expect(await screen.findByText(elsewhere.question)).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/quiz\/item\/item-elsewhere$/);
      expect(screen.getByText("1 of 3")).toBeInTheDocument();
      expect(navigateCalls).toEqual([]);

      await user.click(screen.getByRole("button", { name: /^next$/i }));
      expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^next$/i }));
      expect(await screen.findByText("What is the capital of France?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^previous$/i }));
      await user.click(screen.getByRole("button", { name: /^previous$/i }));
      expect(await screen.findByText(elsewhere.question)).toBeInTheDocument();
      await act(async () => {});

      expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
      expect(screen.getByText("1 of 3")).toBeInTheDocument();
      expect(itemsApi.getById).toHaveBeenCalledTimes(1);
      expect(itemsApi.getRandom).toHaveBeenCalledTimes(1);
      expect(startEvents()).toHaveLength(1);
      expect(startEvents()[0][1]).toMatchObject({ total: 3 });
    });

    it("starts a cold category deep link on the linked item and de-duplicates the random set", async () => {
      mockRoster([item, secondItem]);
      mockById(item, secondItem);
      renderPage("/quiz/exams/item/item-2");

      expect(await screen.findByText("What is the capital of France?")).toBeInTheDocument();
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/quiz\/exams\/item\/item-2$/);
      await act(async () => {});
      expect(startEvents()).toHaveLength(1);
    });

    it("keeps the roster when the URL slug differs in case from the canonical slug", async () => {
      const user = userEvent.setup({ delay: null });
      mockRoster([item, secondItem]);
      const sameCategory = { ...elsewhere, category: "exams" };
      mockById(sameCategory, item, secondItem);
      renderPage("/quiz/Exams/item/item-elsewhere");

      expect(await screen.findByText(elsewhere.question)).toBeInTheDocument();
      expect(screen.getByText("1 of 3")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /^next$/i }));
      expect(await screen.findByText("What is 2 + 2?")).toBeInTheDocument();
      expect(screen.getByText("2 of 3")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^previous$/i }));
      expect(await screen.findByText(elsewhere.question)).toBeInTheDocument();
      await act(async () => {});

      expect(screen.getByText("1 of 3")).toBeInTheDocument();
      expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
      expect(itemsApi.getById).toHaveBeenCalledTimes(1);
      expect(startEvents()).toHaveLength(1);
    });

    it("keeps the quiz size when the linked item is added to a full random set", async () => {
      const random = Array.from({ length: 10 }, (_, i) => ({
        ...secondItem,
        id: `random-${i}`,
        question: `Random question ${i}?`,
      }));
      mockRoster(random);
      mockById(elsewhere);
      renderPage("/quiz/item/item-elsewhere");

      expect(await screen.findByText(elsewhere.question)).toBeInTheDocument();
      expect(screen.getByText("1 of 10")).toBeInTheDocument();
    });

    it("rewrites a category deep link to an item of another category", async () => {
      const otherCategory = { ...elsewhere, category: "science" };
      mockRoster([item, secondItem]);
      mockById(otherCategory, item, secondItem);
      renderPage("/quiz/exams/item/item-elsewhere");

      await expectShown(/^\/quiz\/exams\/item\/item-1$/, "What is 2 + 2?", elsewhere.question);
    });

    it("rewrites a keyword-scoped deep link instead of adding the linked item", async () => {
      mockRoster([item, secondItem]);
      mockById(elsewhere, item, secondItem);
      renderPage("/quiz/exams/item/item-elsewhere?nav=act");

      await expectShown("/quiz/exams/item/item-1?nav=act", "What is 2 + 2?", elsewhere.question);
    });

    it("rewrites a global deep link to a private item instead of seeding it", async () => {
      const privateItem = { ...elsewhere, isPrivate: true };
      mockRoster([item, secondItem]);
      mockById(privateItem, item, secondItem);
      renderPage("/quiz/item/item-elsewhere");

      await expectShown(/^\/quiz\/item\/item-1$/, "What is 2 + 2?", elsewhere.question);
    });

    it("waits for the category roster before starting a cold category link", async () => {
      let resolveCategories: (value: Awaited<ReturnType<typeof categoriesApi.getAll>>) => void =
        () => {};
      vi.mocked(categoriesApi.getAll).mockReturnValue(
        new Promise((resolve) => {
          resolveCategories = resolve;
        })
      );
      mockRoster([item, secondItem]);
      mockById(item, secondItem);
      renderPage("/quiz/exams/item/item-2");

      // getById settles first; no one-item run may start while the roster is pending.
      await waitFor(() => expect(itemsApi.getById).toHaveBeenCalledTimes(1));
      await act(async () => {});
      expect(screen.queryByText("What is the capital of France?")).not.toBeInTheDocument();
      expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
      expect(itemsApi.getRandom).not.toHaveBeenCalled();
      expect(mockTrackEventOnce).not.toHaveBeenCalled();

      await act(async () => {
        resolveCategories({ categories: [{ category: "exams" }] } as Awaited<
          ReturnType<typeof categoriesApi.getAll>
        >);
      });

      expect(await screen.findByText("What is the capital of France?")).toBeInTheDocument();
      await act(async () => {});
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
      expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
      expect(navigateCalls).toEqual([]);
      expect(itemsApi.getRandom).toHaveBeenCalledTimes(1);
      expect(vi.mocked(itemsApi.getRandom).mock.calls[0][0]).toBe("exams");
      expect(startEvents()).toHaveLength(1);
    });

    it("shows the linked item when the categories request fails", async () => {
      vi.mocked(categoriesApi.getAll).mockRejectedValue(new Error("boom"));
      mockById(item, secondItem);
      renderPage("/quiz/exams/item/item-2");

      expect(await screen.findByText("What is the capital of France?")).toBeInTheDocument();
      expect(screen.getByText("1 of 1")).toBeInTheDocument();
    });

    it("falls back to a random item when the linked item cannot be loaded", async () => {
      mockRoster([item, secondItem]);
      vi.mocked(itemsApi.getById).mockRejectedValue(new Error("404"));
      renderPage("/quiz/exams/item/item-gone");

      await expectShown(/^\/quiz\/exams\/item\/item-1$/, "What is 2 + 2?");
    });

    it("does not rewrite a deep link to an item in the roster", async () => {
      // AC 3.6.17 (#275)
      mockRoster([legacy, item, secondItem]);
      mockById(legacy, item, secondItem);
      renderPage("/quiz/exams/item/item-2");

      expect(await screen.findByText("What is the capital of France?")).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(/^\/quiz\/exams\/item\/item-2$/);
    });

    it("names the item shown after the roster shrinks mid-run", async () => {
      // AC 3.6.17 (#275)
      const third = { ...secondItem, id: "item-3", question: "Third question?" };
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [item, secondItem, third] });
      const { queryClient } = renderPageWithEntries([
        "/quiz/collections/collection-1/practice+set/item/item-2",
      ]);
      await expectShown(
        "/quiz/collections/collection-1/practice+set/item/item-2",
        "What is the capital of France?"
      );

      // The linked item leaves the collection: the run restarts on the remaining items and the
      // URL must name the item shown by the restarted run, not one picked from the old run.
      vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [item, third] });
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["collectionItems"] });
      });

      await expectShown(
        "/quiz/collections/collection-1/practice+set/item/item-1",
        "What is 2 + 2?",
        third.question
      );
      // React Router can coalesce a superseded navigation, so check the calls themselves: the stale
      // run must never have been used to pick item-3.
      expect(navigateCalls.some((to) => to.endsWith("/item-3"))).toBe(false);
    });

    it("replaces the history entry instead of pushing one", async () => {
      // AC 3.6.17 (#275)
      const user = userEvent.setup({ delay: null });
      mockRoster([legacy, item, secondItem]);
      mockById(legacy, item, secondItem);
      renderPageWithEntries(["/prev", "/quiz/exams/item/item-legacy"], 1);

      await expectShown("/quiz/exams/item/item-1", "What is 2 + 2?");
      await user.click(screen.getByRole("button", { name: "test-back" }));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/prev$/));
    });
  });
});

describe("seedQuizRoster", () => {
  type Linked = NonNullable<Parameters<typeof seedQuizRoster>[1]>;
  const base = {
    id: "linked",
    category: "Science & Nature",
    isPrivate: false,
    correctAnswer: "a",
    incorrectAnswers: ["b", "c"],
  } as unknown as Linked;
  const rnd = (n: number): Linked[] =>
    Array.from({ length: n }, (_, i) => ({ ...base, id: `r${i}` }));
  const opts = { navigationKeywords: [], filterKeywords: [], quizSize: 10 };

  it("returns the random items when there is no linked item", () => {
    expect(seedQuizRoster(rnd(2), null, opts)).toHaveLength(2);
    expect(seedQuizRoster(rnd(2), undefined, opts)).toHaveLength(2);
  });

  it("does not seed an unplayable or private linked item", () => {
    expect(seedQuizRoster(rnd(2), { ...base, incorrectAnswers: [] }, opts)).toHaveLength(2);
    expect(seedQuizRoster(rnd(2), { ...base, isPrivate: true }, opts).map((i) => i.id)).toEqual([
      "r0",
      "r1",
    ]);
  });

  it("puts the linked item first without duplicating it", () => {
    const random = [...rnd(2), base];
    expect(seedQuizRoster(random, base, opts).map((i) => i.id)).toEqual(["linked", "r0", "r1"]);
  });

  it("caps the roster at the quiz size, dropping the last random item", () => {
    const result = seedQuizRoster(rnd(10), base, opts);
    expect(result).toHaveLength(10);
    expect(result[0].id).toBe("linked");
    expect(result.some((i) => i.id === "r9")).toBe(false);
  });

  it("seeds only the linked item when there are no random items", () => {
    expect(seedQuizRoster([], base, opts).map((i) => i.id)).toEqual(["linked"]);
  });

  it("does not seed under filter keywords, or under nav keywords for a category", () => {
    expect(seedQuizRoster(rnd(1), base, { ...opts, filterKeywords: ["x"] })).toHaveLength(1);
    expect(
      seedQuizRoster(rnd(1), base, {
        ...opts,
        categorySlug: "science-nature",
        navigationKeywords: ["x"],
      })
    ).toHaveLength(1);
  });

  it("matches the category by slug, ignoring case and punctuation", () => {
    expect(seedQuizRoster(rnd(1), base, { ...opts, categorySlug: "Science-Nature" })[0].id).toBe(
      "linked"
    );
    expect(seedQuizRoster(rnd(1), base, { ...opts, categorySlug: "exams" })[0].id).toBe("r0");
  });

  it("treats a missing linked category as out of scope for a category quiz", () => {
    const noCategory = { ...base, category: "" };
    expect(seedQuizRoster(rnd(1), noCategory, { ...opts, categorySlug: "exams" })[0].id).toBe("r0");
    expect(seedQuizRoster(rnd(1), noCategory, opts)[0].id).toBe("linked");
  });
});
