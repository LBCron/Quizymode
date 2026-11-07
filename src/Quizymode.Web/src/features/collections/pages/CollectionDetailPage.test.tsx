import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CollectionDetailPage from "./CollectionDetailPage";
import { collectionsApi } from "@/api/collections";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { upsertLocalStudyPlan } from "@/features/studyPlans/localStudyPlans";
import { addLocalDays } from "@/features/studyPlans/studyPlanSteps";
import * as exportFormats from "../utils/exportFormats";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));
vi.mock("@/api/studyPlans", () => ({ studyPlansApi: { list: vi.fn().mockResolvedValue([]), upsert: vi.fn(), remove: vi.fn() } }));
vi.mock("@/hooks/useCurrentUserId", () => ({ useCurrentUserId: () => null }));
vi.mock("@/hooks/useListenAll", () => ({
  useListenAll: () => ({ listenState: "idle", handleButton: vi.fn(), isSupported: false }),
}));
vi.mock("@/components/ItemListSection", () => ({ default: () => <div data-testid="item-list" /> }));
vi.mock("@/components/ItemCollectionsModal", () => ({ default: () => null }));
vi.mock("@/components/ItemCollectionControls", () => ({ ItemCollectionControls: () => null }));
vi.mock("@/components/ScopeSecondaryBar", () => ({ ScopeSecondaryBar: () => null }));
vi.mock("../components/ShareCollectionButton", () => ({ ShareCollectionButton: () => null }));
vi.mock("@/api/collections", () => ({
  collectionsApi: {
    getById: vi.fn(),
    getItems: vi.fn(),
    getRating: vi.fn(),
    getBookmarkedBy: vi.fn(),
    removeItem: vi.fn(),
    update: vi.fn(),
    setRating: vi.fn(),
  },
}));

const items = [
  {
    id: "1",
    question: "Q1",
    correctAnswer: "A1",
    incorrectAnswers: ["W1", "W2"],
    explanation: "Because one",
    collections: [],
    keywords: [],
  },
  {
    id: "2",
    question: "Q2",
    correctAnswer: "A2",
    incorrectAnswers: ["W3"],
    explanation: "",
    collections: [],
    keywords: [],
  },
];

const PLAN_COLLECTION_ID = "00000000-0000-4000-8000-000000000001";

function renderPage(id = "c1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/collections/${id}`]}>
        <Routes>
          <Route path="/collections/:id" element={<CollectionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CollectionDetailPage export and print (#258)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installMemoryLocalStorage();
    vi.mocked(collectionsApi.getById).mockResolvedValue({
      id: "c1",
      name: "Bio Set",
      description: null,
      createdBy: "someone-else",
      createdAt: "2026-01-01T00:00:00Z",
      itemCount: 2,
      isPublic: true,
      isDiscoverable: false,
    } as Awaited<ReturnType<typeof collectionsApi.getById>>);
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items } as unknown as Awaited<
      ReturnType<typeof collectionsApi.getItems>
    >);
    vi.mocked(collectionsApi.getRating).mockResolvedValue({ count: 0, averageStars: null, myStars: null } as never);
  });

  it("offers export controls to a non-owner viewer and downloads CSV, TSV and Quizlet text", async () => {
    // AC 1.14.2
    const download = vi.spyOn(exportFormats, "downloadTextFile").mockImplementation(() => {});
    const user = userEvent.setup({ delay: null });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    expect(download).toHaveBeenLastCalledWith(
      "bio-set.csv",
      expect.stringContaining("Q1,A1,W1 | W2,Because one"),
      "text/csv",
      true
    );

    await user.click(screen.getByRole("button", { name: "Download TSV" }));
    expect(download).toHaveBeenLastCalledWith(
      "bio-set.tsv",
      expect.stringContaining("Q2\tA2\tW3\t"),
      "text/tab-separated-values",
      true
    );

    await user.click(screen.getByRole("button", { name: "Quizlet text" }));
    expect(download).toHaveBeenLastCalledWith("bio-set.txt", "Q1\tA1\nQ2\tA2\n", "text/plain", false);
  });

  it("prints a view with answers and explanations, or a worksheet with answers hidden", async () => {
    // AC 1.14.3
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const user = userEvent.setup({ delay: null });
    renderPage();

    await screen.findByRole("button", { name: "Print" });
    expect(screen.queryByTestId("collection-print-view")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    const view = await screen.findByTestId("collection-print-view");
    expect(within(view).getByText("Q1")).toBeInTheDocument();
    expect(within(view).getByText("A1")).toBeInTheDocument();
    expect(within(view).getByText("Because one")).toBeInTheDocument();
    expect(view.className).toContain("print:block");

    await user.click(screen.getByLabelText(/hide answers when printing/i));
    await waitFor(() => expect(within(view).queryByText("A1")).not.toBeInTheDocument());
    expect(within(view).queryByText("Because one")).not.toBeInTheDocument();
    expect(within(view).getByText("Q1")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("does not render export controls for an empty collection", async () => {
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [] } as never);
    renderPage();
    await screen.findByText(/no items in this collection/i);
    expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
  });

  it("offers Plan for a test to a guest viewer and opens the dialog (#364)", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Plan for a test" }));

    const dialog = await screen.findByRole("dialog", { name: "Plan for a test" });
    expect(within(dialog).getByText("Bio Set")).toBeInTheDocument();
    expect(within(dialog).getByText(/Saved in this browser only/)).toBeInTheDocument();
  });

  it("labels the button with the test date once a plan exists (#364)", async () => {
    upsertLocalStudyPlan(PLAN_COLLECTION_ID, addLocalDays(new Date(), 3));
    renderPage(PLAN_COLLECTION_ID);

    const button = await screen.findByRole("button", { name: /^Test plan: .+\. Edit$/ });
    expect(button).toHaveTextContent(/^Test plan: /);
    expect(screen.queryByRole("button", { name: "Plan for a test" })).not.toBeInTheDocument();
  });

  it("hides Plan for a test for an empty collection (#364)", async () => {
    vi.mocked(collectionsApi.getItems).mockResolvedValue({ items: [] } as never);
    renderPage();
    await screen.findByText(/no items in this collection/i);
    expect(screen.queryByRole("button", { name: "Plan for a test" })).not.toBeInTheDocument();
  });
});
