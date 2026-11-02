import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { dailyQuizApi } from "@/api/learningLoop";
import AdminDailyQuizPage from "./AdminDailyQuizPage";
import { renderWithProviders } from "@/features/learningLoop/learningLoopTestUtils";

vi.mock("@/media/curatedImages", () => ({
  resolveCuratedImage: (key: string) => (key === "curated:flags/fr" ? "/assets/m/fr.webp" : null),
}));
vi.mock("@/api/learningLoop", () => ({ dailyQuizApi: { adminGet: vi.fn(), adminExclude: vi.fn() } }));

const today = new Date().toISOString().slice(0, 10);

describe("AdminDailyQuizPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the day's set and replaces a removed question", async () => {
    vi.mocked(dailyQuizApi.adminGet).mockResolvedValue({
      date: today,
      items: [{ itemId: "i1", position: 0, question: "Unsuitable?", category: "trivia", excluded: false, excludedAt: null }],
    });
    vi.mocked(dailyQuizApi.adminExclude).mockResolvedValue({
      date: today,
      items: [
        { itemId: "i2", position: 0, question: "Replacement?", category: "trivia", excluded: false, excludedAt: null },
        { itemId: "i1", position: 0, question: "Unsuitable?", category: "trivia", excluded: true, excludedAt: `${today}T10:00:00Z` },
      ],
    });

    renderWithProviders(<AdminDailyQuizPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove from daily set: Unsuitable?" }));

    expect(await screen.findByText("Replacement?")).toBeInTheDocument();
    expect(dailyQuizApi.adminExclude).toHaveBeenCalledWith(today, "i1");
    expect(screen.getByRole("heading", { name: "Removed for this day" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Day (UTC)" }).querySelectorAll("option")).toHaveLength(8);
  });

  it("shows question pictures on active and removed rows and names the picture in Remove", async () => {
    const questionImage = { key: "curated:flags/fr", altText: "Blue, white, red bands" };
    vi.mocked(dailyQuizApi.adminGet).mockResolvedValue({
      date: today,
      items: [
        { itemId: "i1", position: 0, question: "Which flag?", category: "geography", excluded: false, excludedAt: null, questionImage },
        { itemId: "i2", position: 1, question: "Plain?", category: "geography", excluded: false, excludedAt: null, questionImage: null },
        { itemId: "i3", position: 2, question: "Old flag?", category: "geography", excluded: true, excludedAt: `${today}T10:00:00Z`, questionImage },
      ],
    });

    renderWithProviders(<AdminDailyQuizPage />);

    expect(await screen.findByRole("button", { name: "Remove from daily set: Which flag? (picture: Blue, white, red bands)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from daily set: Plain?" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Blue, white, red bands")).toHaveLength(2);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("loads another day when a date is chosen", async () => {
    vi.mocked(dailyQuizApi.adminGet).mockResolvedValue({ date: today, items: [] });
    renderWithProviders(<AdminDailyQuizPage />);
    expect(await screen.findByText("No eligible questions for this day.")).toBeInTheDocument();

    const select = screen.getByRole("combobox", { name: "Day (UTC)" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: select.options[3].value } });

    await waitFor(() => expect(dailyQuizApi.adminGet).toHaveBeenLastCalledWith(select.options[3].value));
  });
});
