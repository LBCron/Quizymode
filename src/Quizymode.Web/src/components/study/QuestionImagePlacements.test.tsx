import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { QuizRenderer } from "./QuizRenderer";
import { useQuestionPictureStatuses } from "./pictureGate";
import { ExploreRenderer } from "./ExploreRenderer";
import { LearnQuestion } from "./LearnQuestion";
import { LearnRecap } from "./LearnRecap";
import ItemListCard from "@/components/ItemListCard";
import ReviewBoardPage from "@/features/admin/pages/ReviewBoardPage";
import { CollectionPrintView } from "@/features/collections/components/CollectionPrintView";
import { adminApi } from "@/api/admin";
import { itemsApi } from "@/api/items";
import ItemsPage from "@/features/items/pages/ItemsPage";
import type { ItemResponse } from "@/types/api";

vi.mock("@/media/curatedImages", () => ({
  resolveCuratedImage: (key: string) => (key === "curated:flags/fr" ? "/assets/m/fr.webp" : null),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isAdmin: true }),
}));
vi.mock("@/api/admin", () => ({
  adminApi: { getReviewBoardItems: vi.fn(), approveItem: vi.fn(), rejectItem: vi.fn() },
}));
vi.mock("@/api/items", () => ({ itemsApi: { getRandom: vi.fn() } }));
vi.mock("@/api/ratings", () => ({ ratingsApi: { getStats: vi.fn().mockResolvedValue(null) } }));

const questionImage = { key: "curated:flags/fr", altText: "Three vertical bands: blue, white, red" };

const pictureItem: ItemResponse = {
  id: "flag-1",
  category: "geography",
  isPrivate: false,
  question: "Which country uses this flag?",
  correctAnswer: "France",
  incorrectAnswers: ["Italy", "Ireland", "Romania"],
  explanation: "The tricolore.",
  createdAt: "2026-01-01T00:00:00Z",
  keywords: [],
  collections: [],
  questionImage,
};

const textItem: ItemResponse = { ...pictureItem, id: "text-1", question: "Capital of France?", questionImage: null };

const options = ["Italy", "France", "Ireland", "Romania"];

function quiz(item: ItemResponse, showAnswer: boolean, onAnswerSelect = vi.fn()) {
  return (
    <QuizRenderer
      item={item}
      options={options}
      selectedAnswer={showAnswer ? "France" : null}
      showAnswer={showAnswer}
      onAnswerSelect={onAnswerSelect}
      stats={{ total: 0, correct: 0 }}
    />
  );
}

describe("QuizRenderer picture", () => {
  it("shows the picture with its alt text, before and after the answer is revealed", () => {
    const { rerender } = render(quiz(pictureItem, false));
    expect(screen.getByAltText(questionImage.altText)).toBeInTheDocument();

    rerender(quiz(pictureItem, true));
    expect(screen.getByAltText(questionImage.altText)).toBeInTheDocument();
  });

  it("renders no picture for a text-only item", () => {
    render(quiz(textItem, false));
    expect(screen.queryByTestId("question-image")).not.toBeInTheDocument();
  });
});

describe("ExploreRenderer picture", () => {
  it("keeps the picture outside the flip buttons so its alt text stays reachable", () => {
    render(<ExploreRenderer item={pictureItem} />);
    const img = screen.getByAltText(questionImage.altText);
    expect(img.closest("button")).toBeNull();
    const flip = screen.getByRole("button", { name: "Show answer and explanation" });
    expect(within(flip).queryByRole("img")).toBeNull();
  });

  it("keeps the picture visible after flipping", async () => {
    const user = userEvent.setup();
    render(<ExploreRenderer item={pictureItem} />);
    await user.click(screen.getByRole("button", { name: "Show answer and explanation" }));
    expect(screen.getAllByAltText(questionImage.altText)).toHaveLength(1);
  });

  it("renders no picture slot for a text-only item", () => {
    render(<ExploreRenderer item={textItem} />);
    expect(screen.queryByTestId("question-image")).not.toBeInTheDocument();
  });
});

describe("LearnQuestion picture", () => {
  it("shows the picture under the question", () => {
    render(
      <LearnQuestion
        item={pictureItem}
        options={options}
        selectedAnswer={null}
        showAnswer={false}
        onAnswerSelect={vi.fn()}
      />,
    );
    expect(screen.getByAltText(questionImage.altText)).toBeInTheDocument();
  });
});

describe("LearnRecap thumbnail", () => {
  it("shows a small thumbnail for picture rows only", () => {
    render(
      <LearnRecap
        roundNumber={1}
        rows={[
          { itemId: "a", question: "Flag?", questionImage, status: "mastered" },
          { itemId: "b", question: "Capital?", status: "missed" },
        ]}
        mastered={1}
        total={2}
        onContinue={vi.fn()}
        onStartOver={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("question-image")).toHaveLength(1);
    expect(screen.getByAltText(questionImage.altText)).toHaveAttribute("loading", "lazy");
  });
});

describe("ItemListCard thumbnail", () => {
  it("shows a thumbnail when the item has a picture", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ItemListCard item={pictureItem} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByAltText(questionImage.altText)).toHaveAttribute("loading", "lazy");
  });
});

describe("ReviewBoardPage thumbnail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a thumbnail for picture items", async () => {
    vi.mocked(adminApi.getReviewBoardItems).mockResolvedValue({
      items: [
        {
          id: "i1",
          category: "geography",
          isPrivate: true,
          question: "Which country uses this flag?",
          correctAnswer: "France",
          incorrectAnswers: ["Italy"],
          explanation: "",
          createdBy: "user-1",
          createdAt: "2026-01-01T00:00:00Z",
          questionImage,
        },
      ],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ReviewBoardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByAltText(questionImage.altText)).toBeInTheDocument();
  });
});

describe("CollectionPrintView picture", () => {
  const baseItem = { question: "Which country uses this flag?", correctAnswer: "France", incorrectAnswers: ["Italy"] };

  it("prints the picture, including in worksheet mode", () => {
    render(<CollectionPrintView title="Flags" hideAnswers items={[{ ...baseItem, questionImage }]} />);
    const img = screen.getByAltText(questionImage.altText);
    expect(img).toHaveAttribute("src", "/assets/m/fr.webp");
    expect(img).toHaveAttribute("loading", "eager");
  });

  it("prints a text placeholder for an unknown key", () => {
    render(
      <CollectionPrintView
        title="Flags"
        hideAnswers={false}
        items={[{ ...baseItem, questionImage: { key: "curated:flags/zz", altText: "Green and white" } }]}
      />,
    );
    expect(screen.getByText("[Picture unavailable: Green and white]")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

const explanationImage = { key: "curated:flags/fr", altText: "Diagram of the tricolore with the answer France" };
const explainedItem: ItemResponse = { ...pictureItem, id: "explained-1", questionImage: null, explanationImage };

/** QuizRenderer wired to the page-level picture gate, the way every study surface uses it (#403). */
function GatedQuiz({
  item,
  onAnswerSelect,
  onSkip,
  showAnswer = false,
  revealFeedback = true,
}: {
  item: ItemResponse;
  onAnswerSelect: (answer: string) => void;
  onSkip?: () => void;
  showAnswer?: boolean;
  revealFeedback?: boolean;
}) {
  const pictures = useQuestionPictureStatuses();
  return (
    <QuizRenderer
      item={item}
      options={options}
      selectedAnswer={showAnswer ? "France" : null}
      showAnswer={showAnswer}
      revealFeedback={revealFeedback}
      onAnswerSelect={(answer) => {
        if (pictures.isBlocked(item)) return;
        onAnswerSelect(answer);
      }}
      stats={{ total: 0, correct: 0 }}
      questionPicture={pictures.controlsFor(item, onSkip)}
    />
  );
}

describe("QuizRenderer picture gate", () => {
  it("keeps every answer off until the picture has loaded, then enables them", async () => {
    const onAnswerSelect = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<GatedQuiz item={pictureItem} onAnswerSelect={onAnswerSelect} />);

    const france = screen.getByRole("button", { name: /France/ });
    expect(france).toBeDisabled();
    expect(screen.getByRole("group", { name: "Answer options" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Answers are unavailable until the picture loads.")).toBeInTheDocument();
    await user.click(france);
    expect(onAnswerSelect).not.toHaveBeenCalled();

    fireEvent.load(screen.getByAltText(questionImage.altText));

    expect(screen.getByRole("button", { name: /France/ })).toBeEnabled();
    expect(screen.queryByText("Answers are unavailable until the picture loads.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /France/ }));
    expect(onAnswerSelect).toHaveBeenCalledWith("France");
  });

  it("keeps answers off when the picture fails, offers Skip, and re-enables on a successful Retry", async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<GatedQuiz item={pictureItem} onAnswerSelect={vi.fn()} onSkip={onSkip} />);
    fireEvent.error(screen.getByAltText(questionImage.altText));

    expect(screen.getByText("Picture couldn't load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /France/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Retry loading picture" }));
    fireEvent.load(screen.getByAltText(questionImage.altText));
    expect(screen.getByRole("button", { name: /France/ })).toBeEnabled();
    expect(screen.getByText("Picture loaded. Answers are available.")).toBeInTheDocument();

    fireEvent.error(screen.getByAltText(questionImage.altText));
    await user.click(screen.getByRole("button", { name: "Skip question (not scored)" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("never blocks a text-only item", () => {
    render(<GatedQuiz item={textItem} onAnswerSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /France/ })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the Type answer checkbox while the picture is not showing", () => {
    render(
      <QuizRenderer
        item={pictureItem}
        options={options}
        selectedAnswer={null}
        showAnswer={false}
        onAnswerSelect={vi.fn()}
        stats={{ total: 0, correct: 0 }}
        typedAnswer={{
          isTypeable: true,
          enabled: false,
          onEnabledChange: vi.fn(),
          result: null,
          onSubmit: vi.fn(),
          onOverride: vi.fn(),
          onContinue: vi.fn(),
          continueLabel: "Next",
        }}
        questionPicture={{ blocked: true, onStatusChange: vi.fn() }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Type answer" })).toBeDisabled();
  });

  it("disables the typed answer input and Check answer while blocked", () => {
    render(
      <QuizRenderer
        item={pictureItem}
        options={options}
        selectedAnswer={null}
        showAnswer={false}
        onAnswerSelect={vi.fn()}
        stats={{ total: 0, correct: 0 }}
        typedAnswer={{
          isTypeable: true,
          enabled: true,
          onEnabledChange: vi.fn(),
          result: null,
          onSubmit: vi.fn(),
          onOverride: vi.fn(),
          onContinue: vi.fn(),
          continueLabel: "Next",
        }}
        questionPicture={{ blocked: true, onStatusChange: vi.fn() }}
      />,
    );
    expect(screen.getByLabelText("Type your answer")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check answer" })).toBeDisabled();
  });
});

describe("explanation picture reveal", () => {
  it("is absent from the DOM until the answer is revealed in a Quiz", () => {
    const { rerender } = render(quiz(explainedItem, false));
    expect(screen.queryByAltText(explanationImage.altText)).not.toBeInTheDocument();
    expect(screen.queryByTestId("explanation-image")).not.toBeInTheDocument();

    rerender(quiz(explainedItem, true));
    expect(screen.getByAltText(explanationImage.altText)).toBeInTheDocument();
    expect(screen.getByTestId("explanation-image")).toBeInTheDocument();
  });

  it("never shows an explanation picture in an unsubmitted Test", () => {
    render(<GatedQuiz item={explainedItem} onAnswerSelect={vi.fn()} showAnswer revealFeedback={false} />);
    expect(screen.queryByAltText(explanationImage.altText)).not.toBeInTheDocument();
  });

  it("does not block answering when the explanation picture fails, and offers Retry only", () => {
    render(quiz(explainedItem, true));
    fireEvent.error(screen.getByAltText(explanationImage.altText));
    expect(screen.getByRole("button", { name: "Retry loading picture" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skip question/ })).not.toBeInTheDocument();
  });

  it("mounts the explanation picture on the flashcard back only while flipped", async () => {
    const user = userEvent.setup();
    render(<ExploreRenderer item={explainedItem} />);
    expect(screen.queryByAltText(explanationImage.altText)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show answer and explanation" }));
    expect(screen.getByAltText(explanationImage.altText)).toBeInTheDocument();
    expect(screen.getByAltText(explanationImage.altText).closest("button")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show question" }));
    expect(screen.queryByAltText(explanationImage.altText)).not.toBeInTheDocument();
  });

  it("disables the flashcard grade buttons until the question picture has loaded", async () => {
    const user = userEvent.setup();
    const onGrade = vi.fn();
    render(
      <ExploreRenderer
        item={pictureItem}
        onGrade={onGrade}
        questionPicture={{ blocked: true, onStatusChange: vi.fn() }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show answer and explanation" }));
    expect(screen.getByRole("button", { name: "Got it" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onGrade).not.toHaveBeenCalled();
  });
});

describe("ItemListCard explanation thumbnail", () => {
  const renderCard = (props: Partial<ComponentProps<typeof ItemListCard>>) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ItemListCard item={explainedItem} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("shows a small thumbnail with the answer section, and none when answers are hidden", () => {
    const { unmount } = renderCard({});
    expect(screen.getByAltText(explanationImage.altText)).toHaveAttribute("loading", "lazy");
    expect(screen.queryByRole("button", { name: "Enlarge picture" })).not.toBeInTheDocument();
    unmount();

    renderCard({ showAnswer: false });
    expect(screen.queryByAltText(explanationImage.altText)).not.toBeInTheDocument();
  });
});

describe("CollectionPrintView explanation picture", () => {
  const baseItem = { question: "Q?", correctAnswer: "France", incorrectAnswers: ["Italy"], explanation: "Because." };

  it("prints the explanation picture after the answer, but not in worksheet mode", () => {
    const { unmount } = render(<CollectionPrintView title="T" hideAnswers={false} items={[{ ...baseItem, explanationImage }]} />);
    const img = screen.getByAltText(explanationImage.altText);
    expect(img).toHaveClass("max-w-[8cm]", "break-inside-avoid");
    unmount();

    render(<CollectionPrintView title="T" hideAnswers items={[{ ...baseItem, explanationImage }]} />);
    expect(screen.queryByAltText(explanationImage.altText)).not.toBeInTheDocument();
  });
});

describe("ItemsPage thumbnail", () => {
  const explanationOnly: ItemResponse = { ...pictureItem, id: "expl-1", question: "Explained?", questionImage: null, explanationImage: { key: "curated:flags/fr", altText: "Explanation picture" } };

  it("shows a lazy question thumbnail on item cards and none for explanation-only items", async () => {
    vi.mocked(itemsApi.getRandom).mockResolvedValue({ items: [pictureItem, textItem, explanationOnly] } as never);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ItemsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Flashcards Mode/ }));

    expect(await screen.findByText("Which country uses this flag?")).toBeInTheDocument();
    expect(screen.getByAltText(questionImage.altText)).toHaveAttribute("loading", "lazy");
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByAltText("Explanation picture")).not.toBeInTheDocument();
    expect(screen.queryByTestId("explanation-image")).not.toBeInTheDocument();
  });
});
