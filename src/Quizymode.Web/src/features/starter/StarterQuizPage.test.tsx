import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { starterApi } from "@/api/starter";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";
import { trackEventOnce } from "@/features/analytics/analyticsEvents";
import {
  readGuestHistory,
  resetGuestHistoryMemoryForTests,
} from "@/features/guestHistory/guestHistoryStorage";
import StarterQuizPage from "./StarterQuizPage";
import { readStarterSeen } from "./starterSeen";
import { fullPool } from "./starterTestUtils";

const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, isLoading: false, userId: null as string | null } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/api/starter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/starter")>()),
  starterApi: { getPool: vi.fn() },
}));
vi.mock("@/features/studySessions/recordStudySession", () => ({
  recordAuthenticatedCompletion: vi.fn().mockResolvedValue(true),
  saveStudySession: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/features/analytics/analyticsEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/analytics/analyticsEvents")>()),
  trackEventOnce: vi.fn(),
  trackEventDeferredOnce: vi.fn(),
  flushDeferredAnalyticsEvents: vi.fn(),
}));

// The picture gate would block answering until a real image loads; the pool here has no pictures.
const pool = fullPool(3).map((entry) => ({ ...entry, item: { ...entry.item, questionImage: null } }));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/start"]}>
          <Routes>
            <Route path="/start" element={<StarterQuizPage />} />
            <Route path="*" element={<LocationDisplay />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

async function answer(correct: boolean) {
  const button = await screen.findByRole("button", { name: correct ? /Right / : /Wrong / });
  fireEvent.click(button);
}

async function finishRun() {
  for (let question = 1; question <= 5; question += 1) {
    await answer(true);
    fireEvent.click(await screen.findByRole("button", { name: question === 5 ? "See my score" : "Next" }));
  }
  await screen.findByRole("heading", { name: "Quiz complete" });
}

describe("StarterQuizPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    resetGuestHistoryMemoryForTests();
    auth.value = { isAuthenticated: false, isLoading: false, userId: null };
    vi.mocked(starterApi.getPool).mockResolvedValue({ version: "v1", items: pool });
  });

  it("shows a loading status, then five questions starting with a flag", async () => {
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your quiz");

    expect(await screen.findByText("Question 1 of 5")).toBeInTheDocument();
    expect(screen.getByText(/Question flags/)).toBeInTheDocument();
    expect(trackEventOnce).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "quick_quiz_started", contextType: "home", contextId: "starter", total: 5 }),
    );
  });

  it("replaces the options with a wow card in a live region, focuses Next, and Enter advances exactly once", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await answer(true);

    const card = await screen.findByTestId("wow-card");
    expect(card).toHaveTextContent("Correct!");
    expect(card).toHaveTextContent("Answer: Right flags");
    expect(card).toHaveTextContent("Did you know?");
    expect(card).toHaveTextContent("Wow flags");
    expect(card.closest("[aria-live='polite']")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("group", { name: "Answer options" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Correct Answer:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();

    const next = screen.getByRole("button", { name: "Next" });
    await waitFor(() => expect(next).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Question 2 of 5")).toBeInTheDocument();
    expect(screen.queryByText("Question 3 of 5")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wow-card")).not.toBeInTheDocument();
  });

  it("explains a wrong answer and advances when the card itself is tapped", async () => {
    renderPage();
    await answer(false);

    const card = await screen.findByTestId("wow-card");
    expect(card).toHaveTextContent("Not quite.");
    expect(card).toHaveTextContent("You picked: Wrong flags");
    fireEvent.click(card);

    expect(await screen.findByText("Question 2 of 5")).toBeInTheDocument();
  });

  it("marks each question as seen when it is shown, not before", async () => {
    renderPage();
    await screen.findByText("Question 1 of 5");

    expect(readStarterSeen()).toHaveLength(1);
    await answer(true);
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findByText("Question 2 of 5");
    expect(readStarterSeen()).toHaveLength(2);
  });

  it("finishes with a one-line score, three explore cards, and records a source-less guest run", async () => {
    renderPage();
    for (let question = 1; question <= 5; question += 1) {
      await answer(question !== 3);
      const next = await screen.findByRole("button", { name: question === 5 ? "See my score" : "Next" });
      fireEvent.click(next);
    }

    expect(await screen.findByRole("heading", { name: "Quiz complete" })).toBeInTheDocument();
    expect(screen.getByText("You got 4 of 5.")).toBeInTheDocument();
    expect(screen.getAllByText("Quiz complete")).toHaveLength(1);
    expect(trackEventOnce).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "quiz_completed", contextType: "home", contextId: "starter", score: 4, total: 5 }),
    );

    const cards = screen.getByRole("list");
    const links = Array.from(cards.querySelectorAll("a"));
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute(
      "href",
      "/quiz/geography?nav=flags%2Ccountries&keywords=flags%2Ccountries&size=10",
    );
    expect(screen.getByRole("link", { name: "Explore all topics" })).toHaveAttribute("href", "/categories");
    expect(screen.getByRole("button", { name: "Another random five" })).toBeInTheDocument();
    expect(screen.queryByText(/% correct/)).not.toBeInTheDocument();

    const history = readGuestHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ correct: 4, total: 5, source: null });
    expect(history[0]?.missedItemIds).toHaveLength(1);
  });

  it("sends starter_next_clicked once for the explore card that is tapped", async () => {
    renderPage();
    await finishRun();

    fireEvent.click(screen.getByRole("link", { name: /Guess 10 more flags/ }));

    expect(trackEventOnce).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "starter_next_clicked", position: 1, contextType: "home", contextId: "next:flags" }),
    );
    expect(vi.mocked(trackEventOnce).mock.calls.filter(([, event]) => event.name === "starter_next_clicked")).toHaveLength(1);
  });

  it("sends starter_next_clicked at position 5 for Explore all topics", async () => {
    renderPage();
    await finishRun();

    fireEvent.click(screen.getByRole("link", { name: "Explore all topics" }));

    expect(trackEventOnce).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "starter_next_clicked", position: 5, contextType: "home" }),
    );
  });

  it("Another random five starts a new run with different questions and reports position 4", async () => {
    renderPage();
    const firstQuestions: string[] = [];
    for (let question = 1; question <= 5; question += 1) {
      firstQuestions.push((await screen.findByText(/^Question (flags|genai|space|animals|food|time|body|places) \d+$/)).textContent ?? "");
      await answer(true);
      fireEvent.click(await screen.findByRole("button", { name: question === 5 ? "See my score" : "Next" }));
    }
    await screen.findByRole("heading", { name: "Quiz complete" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Another random five" }));
    });

    expect(await screen.findByText("Question 1 of 5")).toBeInTheDocument();
    expect(trackEventOnce).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "starter_next_clicked", position: 4, contextType: "home", contextId: "starter" }),
    );
    const secondFirst = (await screen.findByText(/^Question (flags|genai|space|animals|food|time|body|places) \d+$/)).textContent;
    expect(secondFirst).not.toBe(firstQuestions[0]);
  });

  it("saves a signed-in run through the study-session API with no browse source", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    renderPage();
    for (let question = 1; question <= 5; question += 1) {
      await answer(true);
      fireEvent.click(await screen.findByRole("button", { name: question === 5 ? "See my score" : "Next" }));
    }
    await screen.findByRole("heading", { name: "Quiz complete" });

    expect(recordAuthenticatedCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ correct: 5, total: 5, scope: { kind: "collection", collectionId: "starter" } }),
    );
    expect(readGuestHistory()).toHaveLength(0);
  });

  it("falls back to the legacy quick quiz when the request fails", async () => {
    vi.mocked(starterApi.getPool).mockRejectedValue(new Error("boom"));
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/quiz/collections/8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511/fun+trivia+facts",
      ),
    );
  });

  it("falls back when the pool has fewer than five usable questions", async () => {
    vi.mocked(starterApi.getPool).mockResolvedValue({ version: "v1", items: pool.slice(0, 4) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/quiz/collections/"));
  });

  it("skips unknown worlds when composing the run", async () => {
    const withUnknown = [{ ...pool[0]!, world: "mystery" }, ...pool];
    vi.mocked(starterApi.getPool).mockResolvedValue({ version: "v1", items: withUnknown });
    renderPage();

    expect(await screen.findByText("Question 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText(/mystery/)).not.toBeInTheDocument();
  });
});
