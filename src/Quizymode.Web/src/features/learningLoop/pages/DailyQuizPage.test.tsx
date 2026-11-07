import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { dailyQuizApi } from "@/api/learningLoop";
import { saveStudySession } from "@/features/studySessions/recordStudySession";
import { trackEventOnce } from "@/features/analytics/analyticsEvents";
import DailyQuizPage from "./DailyQuizPage";
import { readDailyCompletions } from "../localLearningState";
import { renderWithProviders, testItem } from "../learningLoopTestUtils";

const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, isLoading: false, userId: null as string | null } }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/api/learningLoop", () => ({ dailyQuizApi: { get: vi.fn(), complete: vi.fn() } }));
vi.mock("@/features/studySessions/recordStudySession", () => ({ saveStudySession: vi.fn().mockResolvedValue(true) }));
vi.mock("@/features/analytics/analyticsEvents", () => ({
  trackEventOnce: vi.fn(),
  trackEventDeferredOnce: vi.fn(),
  flushDeferredAnalyticsEvents: vi.fn(),
}));

const items = [testItem("a"), testItem("b")];

async function answerAll(correctIds: string[]) {
  for (const item of items) {
    const answer = correctIds.includes(item.id) ? item.correctAnswer : item.incorrectAnswers[0];
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(answer) }));
    if (item !== items[items.length - 1]) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "View results" }));
}

describe("DailyQuizPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    auth.value = { isAuthenticated: false, isLoading: false, userId: null };
  });

  it("anonymous: counts the first run in this browser and reports daily analytics", async () => {
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-18", items, completion: null, streak: null });

    renderWithProviders(<DailyQuizPage />);
    await answerAll(["a"]);

    expect(await screen.findByText(/Counted for today · 1-day streak/)).toBeInTheDocument();
    expect(readDailyCompletions()).toEqual([{ date: "2026-10-18", correct: 1, total: 2 }]);
    expect(dailyQuizApi.complete).not.toHaveBeenCalled();
    expect(trackEventOnce).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: "quiz_completed", contextType: "daily", contextId: "2026-10-18", score: 1, total: 2 }),
    );
    expect(screen.getByRole("heading", { name: "Quiz complete" })).toBeInTheDocument();
  });

  it("signed in: records the completion, then saves the run so misses reach the review queue", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-18", items, completion: null, streak: 2 });
    vi.mocked(dailyQuizApi.complete).mockResolvedValue({
      created: true,
      streak: 3,
      completion: { correct: 1, total: 2, completedAt: "2026-10-18T10:00:00Z" },
    });

    renderWithProviders(<DailyQuizPage />);
    expect(await screen.findByText(/2-day streak/)).toBeInTheDocument();
    await answerAll(["b"]);

    expect(await screen.findByText(/Counted for today · 3-day streak/)).toBeInTheDocument();
    expect(dailyQuizApi.complete).toHaveBeenCalledWith("2026-10-18", 1, 2, 0);
    await waitFor(() =>
      expect(saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ source: null, correct: 1, total: 2, missedItemIds: ["a"] })),
    );
    expect(readDailyCompletions()).toEqual([]);
  });

  it("shows the done state when today is already counted and lets the learner practice", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(dailyQuizApi.get).mockResolvedValue({
      date: "2026-10-18",
      items,
      completion: { correct: 2, total: 2, completedAt: "2026-10-18T09:00:00Z" },
      streak: 4,
    });

    renderWithProviders(<DailyQuizPage />);

    expect(await screen.findByText("Done for today: 2 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
    await answerAll([]);
    expect(await screen.findByText(/Practice run: today's result was already counted/)).toBeInTheDocument();
    expect(dailyQuizApi.complete).not.toHaveBeenCalled();
  });

  describe("unavailable pictures (#403)", () => {
    const brokenPicture = { key: "curated:flags/zz", altText: "Not bundled" };
    const pictureItems = [{ ...testItem("a"), questionImage: brokenPicture }, testItem("b")];

    it("signed in: skipping a question posts skipped, scores the rest and keeps the streak", async () => {
      auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
      vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-18", items: pictureItems, completion: null, streak: 2 });
      vi.mocked(dailyQuizApi.complete).mockResolvedValue({
        created: true,
        streak: 3,
        completion: { correct: 1, total: 2, skipped: 1, completedAt: "2026-10-18T10:00:00Z" },
      });

      renderWithProviders(<DailyQuizPage />);
      expect(await screen.findByText("Picture isn't available")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Right a/ })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Skip question (not scored)" }));
      fireEvent.click(await screen.findByRole("button", { name: /Right b/ }));
      fireEvent.click(screen.getByRole("button", { name: "View results" }));

      expect(await screen.findByText(/Counted for today · 3-day streak/)).toBeInTheDocument();
      expect(dailyQuizApi.complete).toHaveBeenCalledWith("2026-10-18", 1, 2, 1);
      expect(screen.getByText("1 / 1")).toBeInTheDocument();
      expect(screen.getByText("1 question skipped because the picture was unavailable. Not scored.")).toBeInTheDocument();
      await waitFor(() =>
        expect(saveStudySession).toHaveBeenCalledWith(expect.objectContaining({ correct: 1, total: 1, missedItemIds: [] })),
      );
    });

    it("signed in: skipping every question posts no completion or study session and awards no mastery", async () => {
      auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
      const allBroken = [
        { ...testItem("a"), questionImage: brokenPicture },
        { ...testItem("b"), questionImage: brokenPicture },
      ];
      vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-18", items: allBroken, completion: null, streak: 0 });
      vi.mocked(dailyQuizApi.complete).mockResolvedValue({
        created: true,
        streak: 1,
        completion: { correct: 0, total: 2, skipped: 2, completedAt: "2026-10-18T10:00:00Z" },
      });

      renderWithProviders(<DailyQuizPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Skip question (not scored)" }));
      fireEvent.click(await screen.findByRole("button", { name: "Skip question (not scored)" }));
      fireEvent.click(await screen.findByRole("button", { name: "View results" }));

      expect(await screen.findByText("No questions were scored")).toBeInTheDocument();
      expect(dailyQuizApi.complete).not.toHaveBeenCalled();
      expect(screen.queryByText(/Counted for today/)).not.toBeInTheDocument();
      expect(saveStudySession).not.toHaveBeenCalled();
    });

    it("anonymous: keeps skipped in the local completion record", async () => {
      vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-18", items: pictureItems, completion: null, streak: null });

      renderWithProviders(<DailyQuizPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Skip question (not scored)" }));
      fireEvent.click(await screen.findByRole("button", { name: /Right b/ }));
      fireEvent.click(screen.getByRole("button", { name: "View results" }));

      await screen.findByText(/Counted for today/);
      expect(readDailyCompletions()).toEqual([{ date: "2026-10-18", correct: 1, total: 2, skipped: 1 }]);
    });

    it("reads No questions were scored on the done card when every question was skipped", async () => {
      auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
      vi.mocked(dailyQuizApi.get).mockResolvedValue({
        date: "2026-10-18",
        items,
        completion: { correct: 0, total: 2, skipped: 2, completedAt: "2026-10-18T09:00:00Z" },
        streak: 4,
      });
      renderWithProviders(<DailyQuizPage />);
      expect(await screen.findByText("Done for today. No questions were scored")).toBeInTheDocument();
      expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
    });

    it("shows the done card as correct out of scored questions with the skipped note", async () => {
      auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
      vi.mocked(dailyQuizApi.get).mockResolvedValue({
        date: "2026-10-18",
        items,
        completion: { correct: 1, total: 2, skipped: 1, completedAt: "2026-10-18T09:00:00Z" },
        streak: 4,
      });

      renderWithProviders(<DailyQuizPage />);

      expect(await screen.findByText("Done for today: 1 / 1")).toBeInTheDocument();
      expect(screen.getByText("1 question skipped because the picture was unavailable. Not scored.")).toBeInTheDocument();
    });
  });

  it("shows empty and error states", async () => {
    vi.mocked(dailyQuizApi.get).mockResolvedValueOnce({ date: "2026-10-18", items: [], completion: null, streak: null });
    const { unmount } = renderWithProviders(<DailyQuizPage />);
    expect(await screen.findByText(/There is no daily quiz today/)).toBeInTheDocument();
    unmount();

    vi.mocked(dailyQuizApi.get).mockRejectedValue(new Error("down"));
    renderWithProviders(<DailyQuizPage />);
    expect(await screen.findByRole("alert", undefined, { timeout: 4000 })).toHaveTextContent("Today's quiz could not be loaded.");
  });

  it("shares the emoji grid in roster order and reports a daily share", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    vi.mocked(dailyQuizApi.get).mockResolvedValue({ date: "2026-10-18", items, completion: null, streak: null });

    renderWithProviders(<DailyQuizPage />);
    await answerAll(["a"]);
    fireEvent.click(await screen.findByRole("button", { name: "Share result" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    const expected = `Quizymode Daily 2026-10-18 1/2\n\u{1F7E9}\u{1F7E5}\n${window.location.origin}/daily?utm_source=share&utm_medium=share&utm_campaign=quiz_result&utm_content=daily`;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeInTheDocument();
    await waitFor(() =>
      expect(trackEventOnce).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ name: "quiz_result_shared", contextType: "daily", contextId: "2026-10-18", score: 1, total: 2 }),
      ),
    );
  });
});
