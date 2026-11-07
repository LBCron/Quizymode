import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import EditItemPage from "./EditItemPage";
import { itemsApi } from "@/api/items";
import { mediaApi } from "@/api/media";
import { taxonomyApi } from "@/api/taxonomy";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserIdState } from "@/hooks/useCurrentUserId";
import { useExtraKeywordAutocompleteSource } from "@/hooks/useExtraKeywordAutocompleteSource";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/api/items", () => ({ itemsApi: { getById: vi.fn(), update: vi.fn(), setVisibility: vi.fn() } }));
vi.mock("@/api/media", () => ({
  mediaApi: { upload: vi.fn(), preview: vi.fn() },
  mediaUploadErrorMessage: () => "Connection failed. Retry.",
}));
vi.mock("@/api/taxonomy", () => ({ taxonomyApi: { getAll: vi.fn(), suggest: vi.fn() } }));
vi.mock("@/hooks/useExtraKeywordAutocompleteSource", () => ({
  useExtraKeywordAutocompleteSource: vi.fn(() => ({ extraKeywordAutocompleteSource: [], itemTagKeywordsLoading: false })),
}));
vi.mock("@/hooks/useCurrentUserId", () => ({ useCurrentUserIdState: vi.fn() }));
vi.mock("@/components/LoadingSpinner", () => ({ default: () => <div>Loading...</div> }));
vi.mock("@/components/ErrorMessage", () => ({ default: ({ message }: { message: string }) => <div>{message}</div> }));

const taxonomyMock = {
  categories: [
    {
      slug: "science", name: "Science", description: "", itemCount: 0, allKeywordSlugs: ["anatomy", "muscular"],
      groups: [{ slug: "anatomy", description: null, itemCount: 0, keywords: [{ slug: "muscular", description: null, itemCount: 0 }] }],
    },
  ],
};

const pictureItem = {
  id: "item-1", category: "science", isPrivate: true, question: "Old question?", correctAnswer: "Old answer",
  incorrectAnswers: ["W1", "W2", "W3"], explanation: "Old explanation", createdAt: "2026-01-01T00:00:00Z", createdBy: "user-1",
  keywords: [], collections: [], navigationBreadcrumb: ["anatomy", "muscular"], source: null, factualRisk: null,
  reviewComments: null, readyForReview: false,
  imageReview: { state: "Approved", revision: 3 },
  questionImage: { key: "media:asset-q", altText: "Three vertical bands", attribution: null, longDescription: null },
  explanationImage: { key: "media:asset-e", altText: "Labelled triangle", attribution: null, longDescription: null },
};

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/items/item-1/edit"]}>
        <Routes>
          <Route path="/items/:id/edit" element={<><EditItemPage /><LocationDisplay /></>} />
          <Route path="/categories" element={<LocationDisplay />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("EditItemPage picture authoring (#402)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, userId: "user-1", isAdmin: false } as ReturnType<typeof useAuth>);
    vi.mocked(useCurrentUserIdState).mockReturnValue({ userId: "user-1", isLoading: false, isError: false });
    vi.mocked(taxonomyApi.getAll).mockResolvedValue(taxonomyMock as Awaited<ReturnType<typeof taxonomyApi.getAll>>);
    vi.mocked(itemsApi.getById).mockResolvedValue(pictureItem as unknown as Awaited<ReturnType<typeof itemsApi.getById>>);
    vi.mocked(itemsApi.update).mockResolvedValue(pictureItem as unknown as Awaited<ReturnType<typeof itemsApi.update>>);
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    vi.mocked(useExtraKeywordAutocompleteSource).mockReturnValue({ extraKeywordAutocompleteSource: [], itemTagKeywordsLoading: false });
  });

  it("shows both stored slots with Replace, expanding More options for the explanation picture", async () => {
    renderPage();
    const question = await screen.findByRole("group", { name: /Question picture/ });
    const explanation = screen.getByRole("group", { name: /Explanation picture/ });
    expect(within(question).getByLabelText(/^Replace/)).toBeInTheDocument();
    expect(within(explanation).getByLabelText(/^Replace/)).toBeInTheDocument();
    expect(within(question).getByLabelText(/Short description/)).toHaveValue("Three vertical bands");
    expect(within(explanation).getByLabelText(/Short description/)).toHaveValue("Labelled triangle");
    expect(screen.getByRole("button", { name: /more options/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("warns in an accessible dialog before saving a relevant edit, cancels on Escape and traps focus", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = userEvent.setup({ delay: null });
    renderPage();
    const question = await screen.findByDisplayValue("Old question?");
    await user.clear(question);
    await user.type(question, "New question?");
    const save = screen.getByRole("button", { name: /^save$/i });
    await user.click(save);
    const dialog = await screen.findByRole("dialog", { name: /fresh picture review/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("unavailable to other people, including through existing shares");
    expect(confirm).not.toHaveBeenCalled();
    expect(itemsApi.update).not.toHaveBeenCalled();
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const ok = within(dialog).getByRole("button", { name: "Save changes" });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(ok).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(ok).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(itemsApi.update).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("New question?")).toBeInTheDocument();
    expect(save).toHaveFocus();
  });

  it("resubmits the edited item with the stored revision after the dialog is confirmed", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    const question = await screen.findByDisplayValue("Old question?");
    await user.clear(question);
    await user.type(question, "New question?");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(itemsApi.update).toHaveBeenCalledTimes(1));
    expect(itemsApi.update).toHaveBeenCalledWith("item-1", expect.objectContaining({
      question: "New question?",
      expectedImageRevision: 3,
      questionImage: expect.objectContaining({ assetId: "asset-q" }),
      explanationImage: expect.objectContaining({ assetId: "asset-e" }),
    }));
  });

  it("does not warn when nothing relevant changed", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(itemsApi.update).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes only the question picture and keeps the explanation picture", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup({ delay: null });
    renderPage();
    const question = await screen.findByRole("group", { name: /Question picture/ });
    await user.click(within(question).getByRole("button", { name: "Remove picture" }));
    expect(within(question).getByLabelText(/^Add picture/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(itemsApi.update).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(itemsApi.update).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.questionImage).toEqual({ remove: true });
    expect(payload.explanationImage).toEqual(expect.objectContaining({ assetId: "asset-e" }));
  });

  it("replaces the question picture with the newly uploaded asset", async () => {
    vi.mocked(mediaApi.upload).mockResolvedValue({ id: "asset-new", state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" });
    const user = userEvent.setup({ delay: null });
    renderPage();
    const question = await screen.findByRole("group", { name: /Question picture/ });
    await user.click(within(question).getByRole("checkbox"));
    await user.upload(within(question).getByLabelText(/^Replace/), new File(["s"], "n.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(itemsApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(itemsApi.update).mock.calls[0][1]).toEqual(expect.objectContaining({
      questionImage: expect.objectContaining({ assetId: "asset-new", altText: "Three vertical bands" }),
      explanationImage: expect.objectContaining({ assetId: "asset-e" }),
    }));
  });

  it("keeps text and both pictures after a failed save and allows a retry", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(itemsApi.update).mockRejectedValueOnce({
      response: { status: 400, data: { title: "Picture.Invalid", detail: "Picture could not be used." } },
    });
    renderPage();
    const question = await screen.findByDisplayValue("Old question?");
    await user.clear(question);
    await user.type(question, "Typed text");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Picture could not be used.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Typed text")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Three vertical bands")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Labelled triangle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
    expect(screen.getByTestId("location")).toHaveTextContent("/items/item-1/edit");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(itemsApi.update).toHaveBeenCalledTimes(2));
  });
});
