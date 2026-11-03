import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ItemListCard from "./ItemListCard";
import type { ItemResponse } from "@/types/api";

vi.mock("@/api/ratings", () => ({
  ratingsApi: {
    getStats: vi.fn(),
  },
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: undefined })),
  };
});

vi.mock("@/components/SpeakButton", () => ({
  SpeakButton: () => null,
}));

vi.mock("@/hooks/useSpeech", () => ({
  useSpeech: () => ({ isSupported: false }),
}));

vi.mock("@/components/items/PronunciationHint", () => ({
  PronunciationHint: () => null,
}));

vi.mock("./ItemRatingsComments", () => ({
  default: () => null,
}));

function buildItem(overrides: Partial<ItemResponse> = {}): ItemResponse {
  return {
    id: "item-1",
    category: "languages",
    isPrivate: false,
    question: "What does '{{la|Carpe diem||}}' mean?",
    correctAnswer: "Seize the day",
    incorrectAnswers: ["Live for tomorrow"],
    explanation: "Horace made it famous as a push to act in the present.",
    createdAt: "2026-04-17T00:00:00Z",
    keywords: [],
    collections: [],
    ...overrides,
  };
}

describe("ItemListCard", () => {
  it("shows the picture review status line when the item has imageReview", () => {
    render(<ItemListCard item={buildItem({ imageReview: { state: "PendingReview", revision: 1 } })} showAnswer />);

    expect(screen.getByText("Pictures: Pending review")).toBeInTheDocument();
  });

  it("shows no picture review status without imageReview", () => {
    render(<ItemListCard item={buildItem()} showAnswer />);

    expect(screen.queryByText(/^Pictures:/)).not.toBeInTheDocument();
  });

  it("shows explanation when answers are visible", () => {
    render(<ItemListCard item={buildItem()} showAnswer />);

    expect(screen.getByText(/Answer:/)).toBeInTheDocument();
    expect(screen.getByText(/Explanation:/)).toBeInTheDocument();
    expect(screen.getByText(/Horace made it famous/)).toBeInTheDocument();
  });

  it("hides explanation when answers are hidden", () => {
    render(<ItemListCard item={buildItem()} showAnswer={false} />);

    expect(screen.queryByText(/Answer:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Explanation:/)).not.toBeInTheDocument();
  });
});
