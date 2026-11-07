import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import CreateItemPage from "./CreateItemPage";
import { itemsApi } from "@/api/items";
import { mediaApi } from "@/api/media";
import { taxonomyApi } from "@/api/taxonomy";
import { useExtraKeywordAutocompleteSource } from "@/hooks/useExtraKeywordAutocompleteSource";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: true, isAdmin: false }) }));
vi.mock("@/hooks/useActiveCollection", () => ({
  useActiveCollection: () => ({ activeCollectionId: null, activeCollection: null, setActiveCollectionId: vi.fn(), isUpdating: false, collections: [] }),
}));
vi.mock("@/api/collections", () => ({ collectionsApi: { addItem: vi.fn().mockResolvedValue({}), getAll: vi.fn() } }));
vi.mock("@/api/items", () => ({ itemsApi: { create: vi.fn() } }));
vi.mock("@/api/media", () => ({
  mediaApi: { upload: vi.fn(), preview: vi.fn() },
  mediaUploadErrorMessage: () => "Connection failed. Retry.",
}));
vi.mock("@/api/taxonomy", () => ({ taxonomyApi: { getAll: vi.fn(), suggest: vi.fn() } }));
vi.mock("@/hooks/useExtraKeywordAutocompleteSource", () => ({ useExtraKeywordAutocompleteSource: vi.fn() }));

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/create/question?category=science&keywords=anatomy,muscular"]}>
        <Routes>
          <Route path="/create/question" element={<><CreateItemPage /><LocationDisplay /></>} />
          <Route path="/items/:id" element={<><div>Item Detail</div><LocationDisplay /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function fillItemWithBothPictures(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByLabelText(/subtopic/i)).toHaveValue("muscular"));
  await user.type(screen.getByLabelText(/^Question \*/), "Which flag is this?");
  await user.type(screen.getByLabelText(/^Correct Answer \*/), "France");
  await user.type(screen.getByPlaceholderText("Incorrect answer 1"), "Italy");
  await user.click(screen.getByRole("button", { name: /more options/i }));
  const question = screen.getByRole("group", { name: /Question picture/ });
  const explanation = screen.getByRole("group", { name: /Explanation picture/ });
  for (const slot of [question, explanation]) {
    await user.click(within(slot).getByRole("checkbox"));
    await user.upload(within(slot).getByLabelText(/^Add picture/), new File(["s"], "p.png", { type: "image/png" }));
    await user.type(await within(slot).findByLabelText(/Short description/), "Three bands");
  }
}

describe("CreateItemPage picture authoring (#402)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    let uploads = 0;
    vi.mocked(mediaApi.upload).mockImplementation(async () => ({ id: `asset-${++uploads}`, state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" }));
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    vi.mocked(taxonomyApi.getAll).mockResolvedValue({
      categories: [{
        slug: "science", name: "Science", description: "", itemCount: 0, allKeywordSlugs: ["anatomy", "muscular"],
        groups: [{ slug: "anatomy", description: null, itemCount: 0, keywords: [{ slug: "muscular", description: null, itemCount: 0 }] }],
      }],
    });
    vi.mocked(taxonomyApi.suggest).mockResolvedValue({ suggestions: [] });
    vi.mocked(useExtraKeywordAutocompleteSource).mockReturnValue({ extraKeywordAutocompleteSource: [], itemTagKeywordsLoading: false });
    vi.mocked(itemsApi.create).mockResolvedValue({ id: "item-123" } as Awaited<ReturnType<typeof itemsApi.create>>);
  });

  it("Save and add another sends both pictures then clears both slots", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await fillItemWithBothPictures(user);
    await user.click(screen.getByRole("button", { name: /save and add another/i }));
    await waitFor(() => expect(itemsApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(itemsApi.create).mock.calls[0][0]).toEqual(expect.objectContaining({
      questionImage: expect.objectContaining({ assetId: "asset-1", altText: "Three bands" }),
      explanationImage: expect.objectContaining({ assetId: "asset-2", altText: "Three bands" }),
    }));
    await screen.findByText("Saved. Add the next question.");
    expect(screen.queryByLabelText(/Short description/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove picture" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /more options/i }));
    const question = screen.getByRole("group", { name: /Question picture/ });
    const explanation = screen.getByRole("group", { name: /Explanation picture/ });
    expect(within(question).getByLabelText(/^Add picture/)).toBeInTheDocument();
    expect(within(explanation).getByLabelText(/^Add picture/)).toBeInTheDocument();
  });

  it("Save and study saves the pictures on a private draft and opens it", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await fillItemWithBothPictures(user);
    await user.click(screen.getByRole("button", { name: /save and study/i }));
    await waitFor(() => expect(itemsApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(itemsApi.create).mock.calls[0][0]).toEqual(expect.objectContaining({
      isPrivate: true,
      readyForReview: false,
      questionImage: expect.objectContaining({ assetId: "asset-1" }),
      explanationImage: expect.objectContaining({ assetId: "asset-2" }),
    }));
    expect(await screen.findByText("Item Detail")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/items/item-123");
  });

  it("keeps text and both pictures when the create call fails", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(itemsApi.create).mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { detail: "Picture could not be used." } }, message: "x" });
    renderPage();
    await fillItemWithBothPictures(user);
    await user.click(screen.getByRole("button", { name: /save and study/i }));
    expect(await screen.findByText("Picture could not be used.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Question \*/)).toHaveValue("Which flag is this?");
    expect(screen.getAllByLabelText(/Short description/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /save and study/i })).toBeEnabled();
  });
});
