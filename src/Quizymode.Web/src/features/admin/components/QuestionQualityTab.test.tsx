import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import QuestionQualityTab from "./QuestionQualityTab";

const { mockGetQuestionQualityReport } = vi.hoisted(() => ({ mockGetQuestionQualityReport: vi.fn() }));

vi.mock("@/media/curatedImages", () => ({
  resolveCuratedImage: (key: string) => (key === "curated:flags/fr" ? "/assets/m/fr.webp" : null),
}));
vi.mock("@/api/admin", () => ({
  adminApi: { getQuestionQualityReport: mockGetQuestionQualityReport },
}));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QuestionQualityTab days={30} includeBots={false} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const base = {
  windowStartUtc: "2026-09-01T00:00:00Z",
  windowEndUtc: "2026-10-01T00:00:00Z",
  minAnswers: 10,
  botSessions: 0,
  botsExcluded: true,
  internalSessions: 0,
  internalExcluded: true,
};

describe("QuestionQualityTab", () => {
  beforeEach(() => {
    mockGetQuestionQualityReport.mockReset();
  });

  it("lists questions, flags the answer key, and links to edit", async () => {
    mockGetQuestionQualityReport.mockResolvedValue({
      ...base,
      items: [
        {
          itemId: "item-1",
          question: "Capital of Australia?",
          correctAnswer: "Canberra",
          category: "geography",
          collections: ["World"],
          answers: 12,
          correctRatePercent: 10,
          randomGuessPercent: 25,
          checkAnswerKey: true,
          lastEditedUtc: null,
        },
      ],
    });

    renderTab();

    expect(await screen.findByText("Capital of Australia?")).toBeInTheDocument();
    expect(screen.getByText("Check answer key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/items/item-1/edit");
    expect(screen.getByText(/since last edit/i, { selector: "th" })).toBeInTheDocument();
  });

  it("shows a question thumbnail only for questions with a picture", async () => {
    const row = {
      correctAnswer: "France",
      category: "geography",
      collections: [],
      answers: 12,
      correctRatePercent: 50,
      randomGuessPercent: 25,
      checkAnswerKey: false,
      lastEditedUtc: null,
    };
    mockGetQuestionQualityReport.mockResolvedValue({
      ...base,
      items: [
        { ...row, itemId: "a", question: "Which flag?", questionImage: { key: "curated:flags/fr", altText: "Blue, white, red bands" } },
        { ...row, itemId: "b", question: "Plain question?", questionImage: null },
      ],
    });

    renderTab();

    expect(await screen.findByText("Which flag?")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByAltText("Blue, white, red bands")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mockGetQuestionQualityReport.mockResolvedValue({ ...base, items: [] });

    renderTab();

    expect(await screen.findByText(/No questions have 10 or more/)).toBeInTheDocument();
  });
});
