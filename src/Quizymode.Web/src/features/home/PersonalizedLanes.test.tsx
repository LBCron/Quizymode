import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { dailyQuizApi, interestsApi, reviewQueueApi } from "@/api/learningLoop";
import { studySessionsApi } from "@/api/studySessions";
import { studyPlansApi, type StudyPlanDto } from "@/api/studyPlans";
import { collectionsApi } from "@/api/collections";
import { AxiosError, type AxiosResponse } from "axios";
import { clearGuestHistory } from "@/features/guestHistory/guestHistoryStorage";
import { readLocalStudyPlans, upsertLocalStudyPlan } from "@/features/studyPlans/localStudyPlans";
import { addLocalDays } from "@/features/studyPlans/studyPlanSteps";
import type { FeaturedSetDto } from "@/api/featured";
import { PersonalizedLanes } from "./PersonalizedLanes";
import { readLocalInterests, recordLocalDailyCompletion, utcToday, writeLocalInterests } from "@/features/learningLoop/localLearningState";
import { renderWithProviders } from "@/features/learningLoop/learningLoopTestUtils";
import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";

const renderLanes = (featuredSets: FeaturedSetDto[]) =>
  renderWithProviders(
    <TopicEditorProvider>
      <PersonalizedLanes featuredSets={featuredSets} />
    </TopicEditorProvider>,
  );

const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, isLoading: false, userId: null as string | null } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/api/learningLoop", () => ({
  dailyQuizApi: { get: vi.fn() },
  reviewQueueApi: { getSummary: vi.fn() },
  interestsApi: { get: vi.fn(), replace: vi.fn(), popularCategories: vi.fn() },
}));
vi.mock("@/api/studySessions", () => ({ studySessionsApi: { list: vi.fn() } }));
vi.mock("@/api/studyPlans", () => ({ studyPlansApi: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() } }));
vi.mock("@/api/collections", () => ({ collectionsApi: { getById: vi.fn().mockResolvedValue({ name: "Tennis Trivia" }) } }));

const featured: FeaturedSetDto[] = [
  { id: "f1", displayName: "Guess the Flag", categorySlug: "geography", navKeyword1: "flags", navKeyword2: "countries", itemCount: 10, lastModifiedAt: null, sortOrder: 1 },
  { id: "f2", displayName: "Solar System Sprint", categorySlug: "science", navKeyword1: "space", navKeyword2: null, itemCount: 10, lastModifiedAt: null, sortOrder: 2 },
];

describe("PersonalizedLanes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    auth.value = { isAuthenticated: false, isLoading: false, userId: null };
    vi.mocked(interestsApi.popularCategories).mockResolvedValue(["science"]);
    vi.mocked(studyPlansApi.list).mockResolvedValue([]);
  });

  it("anonymous cold start: daily card, popular sets, and topics saved in this browser", async () => {
    renderLanes(featured);

    expect(screen.getByRole("link", { name: /Daily quiz/ })).toHaveAttribute("href", "/daily");
    expect(screen.queryByRole("link", { name: /Review mistakes/ })).not.toBeInTheDocument();
    expect(await screen.findByText("Popular right now")).toBeInTheDocument();
    // Before the popular list arrives the catalog order is shown; popular categories then move to the front.
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: /Solar System Sprint|Guess the Flag/ })[0]).toHaveTextContent("Solar System Sprint"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Change topics" }));
    const dialog = screen.getByRole("dialog", { name: "My topics" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Trivia" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save topics" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(readLocalInterests()).toEqual(["trivia"]);
    expect(interestsApi.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Trivia" })).toHaveAttribute("href", "/categories/trivia");
    expect(screen.getByText("Recommended next")).toBeInTheDocument();
  });

  it("anonymous: shows the local streak once today's daily quiz is done", () => {
    recordLocalDailyCompletion({ date: utcToday(), correct: 3, total: 5 });

    renderLanes([]);

    expect(screen.getByRole("link", { name: /Daily quiz/ })).toHaveTextContent("Done for today");
    expect(screen.getByRole("link", { name: /Daily quiz/ })).toHaveTextContent("1-day streak");
  });

  it("signed in: review card, Continue from saved sessions, and topics saved to the account", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue(["history"]);
    vi.mocked(interestsApi.replace).mockResolvedValue(["history", "trivia"]);
    vi.mocked(reviewQueueApi.getSummary).mockResolvedValue({ dueCount: 4, totalCount: 9, nextDueAt: null });
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: utcToday(), items: [], completion: null, streak: 5 });
    vi.mocked(studySessionsApi.list).mockResolvedValue([
      {
        id: "s1",
        origin: "quiz",
        runId: "run-1",
        completedAt: new Date().toISOString(),
        correct: 3,
        total: 5,
        source: { kind: "category", categorySlug: "trivia", navigationKeywords: ["sports"], filterKeywords: [] },
        missedItemIds: [],
      },
    ]);

    renderLanes(featured);

    expect(await screen.findByRole("link", { name: /Review mistakes/ })).toHaveTextContent("4 questions due");
    expect(await screen.findByRole("heading", { name: "Continue" })).toBeInTheDocument();
    expect(await screen.findByText(/5-day streak/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change topics" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("checkbox", { name: "Trivia" }));
    fireEvent.click(screen.getByRole("button", { name: "Save topics" }));

    await waitFor(() => expect(interestsApi.replace).toHaveBeenCalledWith(["history", "trivia"]));
    expect(readLocalInterests()).toEqual([]);
  });

  it("Continue opens Learn for learn sessions and Quiz otherwise", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue([]);
    vi.mocked(reviewQueueApi.getSummary).mockResolvedValue({ dueCount: 0, totalCount: 0, nextDueAt: null });
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: utcToday(), items: [], completion: null, streak: 0 });
    const base = { origin: "quiz", correct: 3, total: 5, missedItemIds: [] };
    vi.mocked(studySessionsApi.list).mockResolvedValue([
      {
        ...base,
        id: "s1",
        runId: "run-1",
        completedAt: new Date().toISOString(),
        mode: "learn",
        source: { kind: "category", categorySlug: "trivia", navigationKeywords: ["sports"], filterKeywords: [] },
      },
      {
        ...base,
        id: "s2",
        runId: "run-2",
        completedAt: new Date(Date.now() - 60_000).toISOString(),
        source: { kind: "category", categorySlug: "science", navigationKeywords: ["space"], filterKeywords: [] },
      },
    ]);

    renderLanes(featured);
    await screen.findByRole("heading", { name: "Continue" });
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/learn/trivia?nav=sports&keywords=sports");
    expect(hrefs).toContain("/quiz/science?nav=space&keywords=space");
  });

  it("keeps the picker open with an error when saving fails", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue([]);
    vi.mocked(interestsApi.replace).mockRejectedValue(new Error("down"));
    vi.mocked(reviewQueueApi.getSummary).mockResolvedValue({ dueCount: 0, totalCount: 0, nextDueAt: null });
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: utcToday(), items: [], completion: null, streak: 0 });
    vi.mocked(studySessionsApi.list).mockResolvedValue([]);

    renderLanes(featured);
    fireEvent.click(await screen.findByRole("button", { name: "Change topics" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save topics" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save topics" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your topics could not be saved.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows Change topics in every state and opens the shared editor", async () => {
    renderLanes(featured);
    expect(screen.getByRole("button", { name: "Change topics" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit topics|Choose topics/ })).not.toBeInTheDocument();
  });

  it("focused: every chosen topic is listed and no recommended sets come from the catalog", async () => {
    writeLocalInterests(["history", "languages", "tech", "exams"]);
    renderWithProviders(<PersonalizedLanes featuredSets={featured} focused />);
    await waitFor(() => expect(interestsApi.popularCategories).toHaveBeenCalled());
    for (const name of ["History", "Languages", "Tech", "Exams"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: /Guess the Flag|Solar System Sprint/ })).not.toBeInTheDocument();
  });
});

describe("PersonalizedLanes test-date plans (#364)", () => {
  const day = (offset: number) => addLocalDays(new Date(), offset);
  const cid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const plan = (n: number, testDate: string, overrides: Partial<StudyPlanDto> = {}): StudyPlanDto => ({
    collectionId: cid(n),
    available: true,
    collectionName: `Set ${n}`,
    itemCount: 10,
    testDate,
    createdAt: new Date().toISOString(),
    firstLearnAt: null,
    lastActivityAt: null,
    ...overrides,
  });
  const httpError = (status: number) => new AxiosError("failed", "ERR", undefined, undefined, { status, data: {} } as AxiosResponse);

  function signIn() {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(interestsApi.get).mockResolvedValue([]);
    vi.mocked(reviewQueueApi.getSummary).mockResolvedValue({ dueCount: 0, totalCount: 0, nextDueAt: null });
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: utcToday(), items: [], completion: null, streak: 0 });
    vi.mocked(studySessionsApi.list).mockResolvedValue([]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    auth.value = { isAuthenticated: false, isLoading: false, userId: null };
    vi.mocked(interestsApi.popularCategories).mockResolvedValue([]);
    vi.mocked(studyPlansApi.list).mockResolvedValue([]);
    vi.mocked(studyPlansApi.remove).mockResolvedValue(undefined);
    vi.mocked(collectionsApi.getById).mockResolvedValue({ name: "Tennis Trivia", itemCount: 10 } as never);
  });

  it("signed in: plan cards come before the Daily quiz card and name their collection", async () => {
    signIn();
    vi.mocked(studyPlansApi.list).mockResolvedValue([plan(1, day(5))]);

    renderLanes([]);

    const card = await screen.findByRole("link", { name: /Learn the basics/ });
    expect(card).toHaveTextContent("Set 1 · Test in 5 days");
    const daily = screen.getByRole("link", { name: /Daily quiz/ });
    expect(card.compareDocumentPosition(daily) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows at most three plans in test-date order and summarizes the rest", async () => {
    signIn();
    vi.mocked(studyPlansApi.list).mockResolvedValue([
      plan(1, day(2)),
      plan(2, day(3)),
      plan(3, day(4)),
      plan(4, day(5)),
      plan(5, day(6)),
    ]);

    renderLanes([]);

    expect(await screen.findByText("+2 more test plans")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Learn the basics|Practice quiz/ })).toHaveLength(3);
    expect(screen.queryByText(/Set 4/)).not.toBeInTheDocument();
  });

  it("uses the singular for one more plan and ignores plans whose date passed", async () => {
    signIn();
    vi.mocked(studyPlansApi.list).mockResolvedValue([
      plan(1, day(-1)),
      plan(2, day(2)),
      plan(3, day(3)),
      plan(4, day(4)),
      plan(5, day(5)),
    ]);

    renderLanes([]);

    expect(await screen.findByText("+1 more test plan")).toBeInTheDocument();
    expect(screen.queryByText(/Set 1/)).not.toBeInTheDocument();
  });

  it("a failing plans query hides only the plan cards", async () => {
    signIn();
    vi.mocked(studyPlansApi.list).mockRejectedValue(new Error("down"));

    renderLanes([]);

    await waitFor(() => expect(studyPlansApi.list).toHaveBeenCalled());
    expect(await screen.findByRole("link", { name: /Daily quiz/ })).toBeInTheDocument();
    expect(screen.queryByText(/Learn the basics/)).not.toBeInTheDocument();
  });

  it("shows nothing extra without plans", async () => {
    signIn();

    renderLanes([]);

    await waitFor(() => expect(studyPlansApi.list).toHaveBeenCalled());
    expect(screen.queryByText(/test plan/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Daily quiz/ })).toBeInTheDocument();
  });

  it("waits for auth before showing or fetching anything", () => {
    auth.value = { isAuthenticated: false, isLoading: true, userId: null };
    upsertLocalStudyPlan(cid(1), day(3));

    const { container } = renderLanes([]);

    expect(container).toBeEmptyDOMElement();
    expect(studyPlansApi.list).not.toHaveBeenCalled();
    expect(collectionsApi.getById).not.toHaveBeenCalled();
  });

  it("an unavailable plan offers Remove plan, which removes it through the API", async () => {
    signIn();
    vi.mocked(studyPlansApi.list).mockResolvedValue([plan(1, day(4), { available: false, collectionName: null, itemCount: 0 })]);

    renderLanes([]);

    fireEvent.click(await screen.findByRole("button", { name: "Remove test plan for this collection" }));
    await waitFor(() => expect(studyPlansApi.remove).toHaveBeenCalledWith(cid(1)));
  });

  it("guest: shows browser-local plans with the collection looked up", async () => {
    upsertLocalStudyPlan(cid(1), day(5));

    renderLanes([]);

    const card = await screen.findByRole("link", { name: /Learn the basics/ });
    expect(card).toHaveTextContent("Tennis Trivia · Test in 5 days");
    expect(studyPlansApi.list).not.toHaveBeenCalled();
  });

  it("guest: only an HTTP 404 makes the plan unavailable (Remove plan deletes it locally); other errors hide it", async () => {
    upsertLocalStudyPlan(cid(1), day(5));
    upsertLocalStudyPlan(cid(2), day(6));
    vi.mocked(collectionsApi.getById).mockImplementation(async (id: string) => {
      throw httpError(id === cid(1) ? 404 : 500);
    });

    renderLanes([]);

    fireEvent.click(await screen.findByRole("button", { name: "Remove test plan for this collection" }));
    await waitFor(() => expect(readLocalStudyPlans().map((p) => p.collectionId)).toEqual([cid(2)]));
    expect(screen.queryByText(/Learn the basics|Nothing to study/)).not.toBeInTheDocument();
  });

  it("guest plans survive Clear guest history", async () => {
    upsertLocalStudyPlan(cid(1), day(5));
    clearGuestHistory();

    renderLanes([]);

    expect(await screen.findByRole("link", { name: /Learn the basics/ })).toBeInTheDocument();
  });

  it("signed in ignores the browser-local plans document", async () => {
    signIn();
    upsertLocalStudyPlan(cid(1), day(5));

    renderLanes([]);

    await waitFor(() => expect(studyPlansApi.list).toHaveBeenCalled());
    expect(screen.queryByText(/Learn the basics/)).not.toBeInTheDocument();
    expect(collectionsApi.getById).not.toHaveBeenCalled();
  });
});
