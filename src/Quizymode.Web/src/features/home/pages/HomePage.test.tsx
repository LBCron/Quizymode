import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import HomePage from "./HomePage";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { featuredApi } from "@/api/featured";

vi.mock("@/api/categories", () => ({
  categoriesApi: {
    getAll: vi.fn(),
  },
}));

vi.mock("@/api/collections", () => ({
  collectionsApi: {
    discover: vi.fn(),
  },
}));

vi.mock("@/api/featured", () => ({
  featuredApi: {
    get: vi.fn(),
  },
}));

vi.mock("@/api/learningLoop", () => ({
  interestsApi: { popularCategories: vi.fn().mockResolvedValue([]), get: vi.fn(), replace: vi.fn() },
  dailyQuizApi: { get: vi.fn() },
  reviewQueueApi: { getSummary: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(categoriesApi.getAll).mockResolvedValue({ categories: [] });
    vi.mocked(collectionsApi.discover).mockResolvedValue({ items: [], totalCount: 0 });
    vi.mocked(featuredApi.get).mockResolvedValue({ sets: [], collections: [] });
  });

  it("offers the existing five-question public quiz without requiring an account", async () => {
    renderPage();

    expect(
      screen.getByRole("heading", {
        name: /learn something new in five questions/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /play a 5-question quiz/i })).toHaveAttribute(
      "href",
      "/start"
    );

    await waitFor(() => {
      expect(document.title).toMatch(/^Quizymode(?: \| Quizymode)?$/);
      expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
        "content",
        expect.stringMatching(/five-question quiz with no account needed/i)
      );
    });
  });

  it("clips the decorative hero shapes so they cannot cause horizontal page scroll", () => {
    renderPage();

    // jsdom has no layout; the real-browser width check lives in playwright/e2e/home.spec.ts (#151).
    const decor = screen.getByTestId("home-hero-decor");
    expect(decor).toHaveClass("absolute", "inset-0", "overflow-hidden", "pointer-events-none");
    expect(decor).toHaveAttribute("aria-hidden", "true");
    expect(decor.parentElement).toHaveClass("relative");
  });

  it("keeps the hero and category browsing usable when categories fail", async () => {
    vi.mocked(categoriesApi.getAll).mockRejectedValueOnce(new Error("db down"));

    renderPage();

    expect(
      screen.getByRole("heading", {
        name: /learn something new in five questions/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/categories/i, { selector: "div" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /exams/i })).toHaveAttribute("href", "/categories/exams");
    expect(screen.getByRole("link", { name: /play a 5-question quiz/i })).toBeInTheDocument();

    await waitFor(() => expect(categoriesApi.getAll).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("42 items")).not.toBeInTheDocument();
  });

  it.each([
    ["featured sets", () => vi.mocked(featuredApi.get).mockRejectedValueOnce(new Error("featured down"))],
    ["public collections", () => vi.mocked(collectionsApi.discover).mockRejectedValueOnce(new Error("collections down"))],
    [
      "all home queries",
      () => {
        vi.mocked(categoriesApi.getAll).mockRejectedValueOnce(new Error("categories down"));
        vi.mocked(featuredApi.get).mockRejectedValueOnce(new Error("featured down"));
        vi.mocked(collectionsApi.discover).mockRejectedValueOnce(new Error("collections down"));
      },
    ],
  ])("keeps the quick quiz and categories usable when %s fail", async (_name, arrangeFailure) => {
    arrangeFailure();

    renderPage();

    expect(screen.getByRole("link", { name: /play a 5-question quiz/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /show all/i })).toHaveAttribute(
      "href",
      "/categories"
    );
    expect(screen.getByRole("link", { name: /exams/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(categoriesApi.getAll).toHaveBeenCalledTimes(1);
      expect(featuredApi.get).toHaveBeenCalledTimes(1);
      expect(collectionsApi.discover).toHaveBeenCalledTimes(1);
    });
  });

  it("adds live category counters when the API responds", async () => {
    vi.mocked(categoriesApi.getAll).mockResolvedValueOnce({
      categories: [
        {
          id: "cat-1",
          category: "exams",
          description: "Exams",
          shortDescription: "Exams",
          count: 42,
          isPrivate: false,
          averageStars: null,
        },
        {
          id: "cat-2",
          category: "science",
          description: "Science",
          shortDescription: "Science",
          count: 7,
          isPrivate: false,
          averageStars: null,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("42 items")).toBeInTheDocument();
    expect(screen.getByText("7 items")).toBeInTheDocument();
  });
});
