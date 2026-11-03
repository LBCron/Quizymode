import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ReviewBoardPage from "./ReviewBoardPage";
import { adminApi } from "@/api/admin";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isAdmin: true }),
}));
vi.mock("@/api/admin", () => ({
  adminApi: {
    getReviewBoardItems: vi.fn(),
    approveItem: vi.fn(),
    rejectItem: vi.fn(),
    getImageReviewQueue: vi.fn(),
    setImageReview: vi.fn(),
    fetchItemImageBlob: vi.fn(),
  },
}));

const baseItem = {
  id: "i1",
  category: "science",
  isPrivate: true,
  question: "Which animal barks?",
  correctAnswer: "Dog",
  incorrectAnswers: ["Cat"],
  explanation: "",
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
};

function renderPage(route = "/admin/review-board") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ReviewBoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReviewBoardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getImageReviewQueue).mockResolvedValue({
      items: [],
      totalCount: 3,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      oldestSubmittedAt: null,
    });
  });

  it("shows the Items tab by default with the picture count in the Pictures tab label", async () => {
    vi.mocked(adminApi.getReviewBoardItems).mockResolvedValue({ items: [] });
    renderPage();

    expect(await screen.findByText("No items pending review.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: "Pictures (3)" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches to the Pictures tab, keeps it in the URL param on load, and back to Items with the keyboard", async () => {
    vi.mocked(adminApi.getReviewBoardItems).mockResolvedValue({ items: [] });
    renderPage();

    await userEvent.click(await screen.findByRole("tab", { name: /^Pictures/ }));
    expect(await screen.findByText("No pictures waiting for review")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Pictures/ })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Items" })).toHaveAttribute("aria-selected", "true"));
    expect(await screen.findByText("No items pending review.")).toBeInTheDocument();
  });

  it("opens straight to the Pictures tab for ?tab=pictures", async () => {
    vi.mocked(adminApi.getReviewBoardItems).mockResolvedValue({ items: [] });
    renderPage("/admin/review-board?tab=pictures");

    expect(await screen.findByText("No pictures waiting for review")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Pictures/ })).toHaveAttribute("aria-selected", "true");
  });

  it("shows the group label when an item has one (#359)", async () => {
    vi.mocked(adminApi.getReviewBoardItems).mockResolvedValue({
      items: [
        { ...baseItem, groupLabel: "Mammals" },
        { ...baseItem, id: "i2", question: "Plain?", groupLabel: null },
      ],
    });
    renderPage();

    expect(await screen.findByText("Group: Mammals")).toBeInTheDocument();
    expect(screen.getAllByText(/^Group:/)).toHaveLength(1);
  });
});
