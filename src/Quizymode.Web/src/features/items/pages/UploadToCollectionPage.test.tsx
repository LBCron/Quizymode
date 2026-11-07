import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import UploadToCollectionPage from "./UploadToCollectionPage";
import { itemsApi } from "@/api/items";
import { taxonomyApi } from "@/api/taxonomy";

const authState = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isAdmin: authState.isAdmin }),
}));

vi.mock("@/api/items", () => ({
  itemsApi: {
    uploadToCollection: vi.fn(),
  },
}));

vi.mock("@/api/taxonomy", () => ({
  taxonomyApi: {
    getAll: vi.fn(),
    suggest: vi.fn(),
  },
}));

vi.mock("@/features/legal/components/ContentComplianceNotice", () => ({
  default: () => null,
}));

const taxonomyMock = {
  categories: [
    {
      slug: "science",
      name: "Science",
      description: "",
      itemCount: 0,
      allKeywordSlugs: ["anatomy", "muscular"],
      groups: [
        {
          slug: "anatomy",
          description: null,
          itemCount: 0,
          keywords: [{ slug: "muscular", description: null, itemCount: 0 }],
        },
      ],
    },
  ],
};

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/items/upload-to-collection"
            element={
              <>
                <UploadToCollectionPage />
                <LocationDisplay />
              </>
            }
          />
          <Route
            path="/explore/collections/:collectionId"
            element={<LocationDisplay />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("UploadToCollectionPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAdmin = true; // JSON import is admin-only (AC 2.6.6); non-admin cases set this to false

    vi.mocked(taxonomyApi.getAll).mockResolvedValue(
      taxonomyMock as Awaited<ReturnType<typeof taxonomyApi.getAll>>
    );

    vi.mocked(taxonomyApi.suggest).mockResolvedValue({ suggestions: [] });

    vi.mocked(itemsApi.uploadToCollection).mockResolvedValue(
      { collectionId: "col-123", name: "abc", itemCount: 2 } as Awaited<
        ReturnType<typeof itemsApi.uploadToCollection>
      >
    );
  });

  it("shows the upload form with category and keyword selectors", async () => {
    // AC 2.6.5
    renderPage("/items/upload-to-collection");

    const categorySelect = await screen.findByLabelText(/^category \*$/i);
    expect(categorySelect).toBeInTheDocument();

    expect(screen.getByLabelText(/primary topic/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/subtopic/i)).toBeInTheDocument();
  });

  it("blocks the JSON upload without a full topic and focuses the topic search (#323)", async () => {
    // AC 2.6.5, AC 12.14
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science");
    await screen.findByLabelText(/^category \*$/i);

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(JSON.stringify([{ question: "Q", correctAnswer: "A", incorrectAnswers: ["W1"] }]));
    await user.click(screen.getByRole("button", { name: /upload and open collection/i }));

    expect(await screen.findByText(/choose a topic: pick a suggestion, search, or browse all topics/i)).toBeInTheDocument();
    expect(itemsApi.uploadToCollection).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: /search topics/i })).toHaveFocus();
  });

  it("suggests topics from the question and answer of the first 20 parsed rows (#323)", async () => {
    // AC 12.12
    const user = userEvent.setup({ delay: null });
    vi.mocked(taxonomyApi.suggest).mockResolvedValue({
      suggestions: [
        {
          categorySlug: "science",
          l1: "anatomy",
          l2: "muscular",
          path: "science › anatomy › muscular",
          description: "Muscles",
          score: 0.5,
          matchedTerms: ["muscle"],
          reason: "text",
        },
      ],
    });
    renderPage("/items/upload-to-collection");
    await screen.findByLabelText(/^category \*$/i);

    const rows = Array.from({ length: 25 }, (_, i) => ({
      question: `Which muscle moves joint number ${i}?`,
      correctAnswer: `Biceps ${i}`,
      incorrectAnswers: ["W"],
    }));
    fireEvent.change(screen.getByLabelText(/json array of items/i), { target: { value: JSON.stringify(rows) } });

    await waitFor(() => {
      const sent = vi.mocked(taxonomyApi.suggest).mock.calls.map((call) => call[0]).find((text) => text.length > 0);
      expect(sent).toBeDefined();
      expect(sent).toContain("Which muscle moves joint number 19? Biceps 19");
      expect(sent).not.toContain("number 20?");
      expect(sent!.length).toBeLessThanOrEqual(5000);
    }, { timeout: 3000 });

    const chip = await screen.findByRole("button", { name: /science.*anatomy.*muscular/i });
    await user.click(chip);
    expect(screen.getByTestId("topic-pill")).toHaveTextContent("science");
    expect(screen.getByLabelText(/subtopic/i)).toHaveValue("muscular");
  });

  it("pre-fills category and keywords from URL params", async () => {
    // AC 2.6.5
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");

    const categorySelect = await screen.findByLabelText(/^category \*$/i);
    const rank1Select = screen.getByLabelText(/primary topic/i);
    const rank2Select = screen.getByLabelText(/subtopic/i);

    await waitFor(() => {
      expect(categorySelect).toHaveValue("science");
      expect(rank1Select).toHaveValue("anatomy");
      expect(rank2Select).toHaveValue("muscular");
    });
  });

  it("hides the JSON tab from non-admins and shows only Paste text without a tablist", async () => {
    // AC 2.6.6, AC 2.6.9
    authState.isAdmin = false;
    renderPage("/items/upload-to-collection");
    await screen.findByLabelText(/^category \*$/i);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/json array of items/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/pasted text/i)).toBeInTheDocument();
  });

  it("shows both tabs to admins", async () => {
    // AC 2.6.6, AC 2.6.9
    renderPage("/items/upload-to-collection");
    await screen.findByLabelText(/^category \*$/i);

    expect(screen.getByRole("tab", { name: "JSON" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /paste text/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/json array of items/i)).toBeInTheDocument();
  });

  it("sends a trimmed collectionName only when it is filled in (AC 2.6.1)", async () => {
    const user = userEvent.setup({ delay: null });
    const upload = async (name: string | null) => {
      vi.mocked(itemsApi.uploadToCollection).mockClear();
      const { unmount } = renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
      await screen.findByLabelText(/^category \*$/i);
      await waitFor(() => expect(screen.getByLabelText(/subtopic/i)).toHaveValue("muscular"));
      if (name !== null) await user.type(screen.getByLabelText(/collection name/i), name);
      await user.click(screen.getByLabelText(/json array of items/i));
      await user.paste(JSON.stringify([{ question: "Q", correctAnswer: "A", incorrectAnswers: ["W1"] }]));
      await user.click(screen.getByRole("button", { name: /upload and open collection/i }));
      await waitFor(() => expect(itemsApi.uploadToCollection).toHaveBeenCalled());
      const payload = vi.mocked(itemsApi.uploadToCollection).mock.calls[0][0];
      unmount();
      return payload;
    };

    expect(await upload("  My capitals  ")).toMatchObject({ collectionName: "My capitals" });
    expect(await upload(null)).not.toHaveProperty("collectionName");
    expect(await upload("   ")).not.toHaveProperty("collectionName");
  });

  it("navigates to new collection on successful upload", async () => {
    // AC 2.6.6
    const user = userEvent.setup({ delay: null });

    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");

    const categorySelect = await screen.findByLabelText(/^category \*$/i);
    const rank1Select = screen.getByLabelText(/primary topic/i);
    const rank2Select = screen.getByLabelText(/subtopic/i);

    await waitFor(() => {
      expect(categorySelect).toHaveValue("science");
      expect(rank1Select).toHaveValue("anatomy");
      expect(rank2Select).toHaveValue("muscular");
    });

    const jsonInput = screen.getByLabelText(/json array of items/i);
    await user.click(jsonInput);
    await user.paste(
      JSON.stringify([
        { question: "Q", correctAnswer: "A", incorrectAnswers: ["W1", "W2", "W3"] },
      ])
    );

    const submitButton = screen.getByRole("button", { name: /upload and open collection/i });
    await user.click(submitButton);

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/explore/collections/col-123")
    );
  });

  it("shows error message on duplicate upload", async () => {
    // AC 2.6.7
    const user = userEvent.setup({ delay: null });

    const duplicateError = Object.assign(new Error("already uploaded"), {
      response: { status: 409, data: { detail: "already uploaded" } },
    });
    vi.mocked(itemsApi.uploadToCollection).mockRejectedValue(duplicateError);

    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");

    await screen.findByLabelText(/^category \*$/i);

    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    const jsonInput = screen.getByLabelText(/json array of items/i);
    await user.click(jsonInput);
    await user.paste(
      JSON.stringify([
        { question: "Q", correctAnswer: "A", incorrectAnswers: ["W1", "W2", "W3"] },
      ])
    );

    const submitButton = screen.getByRole("button", { name: /upload and open collection/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/already uploaded/i)).toBeInTheDocument();
    });
  });
  it("blocks submit with a row-numbered error when a row has no non-blank incorrect answer", async () => {
    // AC 2.6.8
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    await screen.findByLabelText(/^category \*$/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(
      JSON.stringify([
        { question: "Q1", correctAnswer: "A", incorrectAnswers: ["W1"] },
        { question: "Q2", correctAnswer: "A", incorrectAnswers: ["  ", ""] },
        { question: "Q3", correctAnswer: "A" },
      ])
    );
    await user.click(screen.getByRole("button", { name: /upload and open collection/i }));

    expect(await screen.findByText(/items 2, 3: provide at least one non-blank incorrect answer/i)).toBeInTheDocument();
    expect(itemsApi.uploadToCollection).not.toHaveBeenCalled();
  });

  it("rejects an unsupported curated picture reference before sending and retains the input for correction (#403)", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    await screen.findByLabelText(/^category \*$/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(
      JSON.stringify([
        { question: "Q1", correctAnswer: "A", incorrectAnswers: ["W1"], questionImage: null, explanationImage: null },
        { question: "Q2", correctAnswer: "A", incorrectAnswers: ["W1"], questionImage: { key: "curated:flags/fr", altText: "x" } },
      ])
    );
    const upload = screen.getByRole("button", { name: /upload and open collection/i });
    await user.click(upload);

    expect(
      await screen.findByText(
        `Item 2 has "questionImage". Only your own uploaded asset references can be imported. Curated keys, URLs, bytes and other authors' pictures cannot be imported.`
      )
    ).toBeInTheDocument();
    expect(itemsApi.uploadToCollection).not.toHaveBeenCalled();
    expect(upload).toBeDisabled();

    await user.type(screen.getByLabelText(/json array of items/i), " ");
    expect(screen.getByRole("button", { name: /upload and open collection/i })).toBeEnabled();
  });

  it("sends a trimmed group label, drops blank or missing ones and stringifies non-strings (#359)", async () => {
    // AC 2.6.14
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    await screen.findByLabelText(/^category \*$/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(
      JSON.stringify([
        { question: "Q1", correctAnswer: "A", incorrectAnswers: ["W1"], groupLabel: "  Mammals " },
        { question: "Q2", correctAnswer: "B", incorrectAnswers: ["W1"], groupLabel: "   " },
        { question: "Q3", correctAnswer: "C", incorrectAnswers: ["W1"] },
        { question: "Q4", correctAnswer: "D", incorrectAnswers: ["W1"], groupLabel: 42 },
      ])
    );
    await user.click(screen.getByRole("button", { name: /upload and open collection/i }));

    await waitFor(() => expect(itemsApi.uploadToCollection).toHaveBeenCalledTimes(1));
    const items = vi.mocked(itemsApi.uploadToCollection).mock.calls[0][0].items;
    expect(items.map((item) => item.groupLabel)).toEqual(["Mammals", undefined, undefined, "42"]);
  });

  it("blocks submit with a row-numbered error for a group label over 30 characters or with a line break (#359)", async () => {
    // AC 2.6.14
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    await screen.findByLabelText(/^category \*$/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(
      JSON.stringify([
        { question: "Q1", correctAnswer: "A", incorrectAnswers: ["W1"], groupLabel: "x".repeat(30) },
        { question: "Q2", correctAnswer: "B", incorrectAnswers: ["W1"], groupLabel: "x".repeat(31) },
        { question: "Q3", correctAnswer: "C", incorrectAnswers: ["W1"], groupLabel: "two\nlines" },
      ])
    );
    await user.click(screen.getByRole("button", { name: /upload and open collection/i }));

    expect(
      await screen.findByText(/items 2, 3: group label must be 30 characters or fewer, with no line breaks/i)
    ).toBeInTheDocument();
    expect(itemsApi.uploadToCollection).not.toHaveBeenCalled();
  });

  it("blocks submit with a row-numbered error when incorrect answers repeat or equal the correct answer (#276)", async () => {
    // AC 2.6.8
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    await screen.findByLabelText(/^category \*$/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(
      JSON.stringify([
        { question: "Q1", correctAnswer: "A", incorrectAnswers: ["W1", "W2"] },
        { question: "Q2", correctAnswer: "A", incorrectAnswers: ["W1", " w1 "] },
        { question: "Q3", correctAnswer: "A", incorrectAnswers: ["a"] },
      ])
    );
    await user.click(screen.getByRole("button", { name: /upload and open collection/i }));

    expect(
      await screen.findByText(
        /items 2, 3: incorrect answers must be different from each other and from the correct answer/i
      )
    ).toBeInTheDocument();
    expect(itemsApi.uploadToCollection).not.toHaveBeenCalled();
  });

  it("trims incorrect answers and keeps at most four before uploading", async () => {
    // AC 2.6.8
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    await screen.findByLabelText(/^category \*$/i);
    await waitFor(() => {
      expect(screen.getByLabelText(/primary topic/i)).toHaveValue("anatomy");
    });

    await user.click(screen.getByLabelText(/json array of items/i));
    await user.paste(
      JSON.stringify([
        { question: "Q", correctAnswer: "A", incorrectAnswers: [" W1 ", "", "W2", "W3", "W4", "W5"], incorrectAnswerRationale: { W1: "First reason", W3: "Second reason", W5: "Omitted answer reason" } },
      ])
    );
    await user.click(screen.getByRole("button", { name: /upload and open collection/i }));

    await waitFor(() => expect(itemsApi.uploadToCollection).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(itemsApi.uploadToCollection).mock.calls[0][0];
    expect(payload.items[0].incorrectAnswers).toEqual(["W1", "W2", "W3", "W4"]);
    expect(payload.items[0].incorrectAnswerRationale).toEqual({ 0: "First reason", 2: "Second reason" });
  });

  it("asks for 1-4 incorrect answers in the prompt", async () => {
    // AC 2.6.8
    renderPage("/items/upload-to-collection");
    await screen.findByLabelText(/^category \*$/i);
    expect(document.body.textContent).toContain('1–4 "incorrectAnswers"');
  });

  describe("Paste text tab (#257)", () => {
    const rows = ["cat\tgato", "dog\tperro", "bird\tpajaro", "fish\tpez"].join("\n");

    async function openPasteTab(user: ReturnType<typeof userEvent.setup>) {
      renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
      await screen.findByLabelText(/^category \*$/i);
      await waitFor(() => expect(screen.getByLabelText(/subtopic/i)).toHaveValue("muscular"));
      const pasteTab = screen.queryByRole("tab", { name: /paste text/i });
      if (pasteTab) await user.click(pasteTab); // non-admins have no tabs and start on Paste text
    }

    it("previews parsed rows and uploads built items", async () => {
      // AC 2.6.9
      const user = userEvent.setup({ delay: null });
      await openPasteTab(user);
      expect(screen.queryByLabelText(/json array of items/i)).not.toBeInTheDocument();

      await user.click(screen.getByLabelText(/pasted text/i));
      await user.paste(rows);
      expect(await screen.findByText(/4 items ready/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /upload and open collection/i }));
      await waitFor(() => expect(itemsApi.uploadToCollection).toHaveBeenCalledTimes(1));
      const payload = vi.mocked(itemsApi.uploadToCollection).mock.calls[0][0];
      expect(payload.category).toBe("science");
      expect(payload.items).toHaveLength(4);
      expect(payload.items[0]).toMatchObject({ question: "cat", correctAnswer: "gato", isPrivate: true });
      expect(payload.items[0].incorrectAnswers).toHaveLength(3);
      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent("/explore/collections/col-123")
      );
    });

    it("applies direction and template", async () => {
      // AC 2.6.9
      const user = userEvent.setup({ delay: null });
      await openPasteTab(user);
      await user.click(screen.getByLabelText(/pasted text/i));
      await user.paste(rows);
      await user.selectOptions(screen.getByLabelText(/direction/i), "definition-to-term");
      await user.clear(screen.getByLabelText(/question template/i));
      await user.click(screen.getByLabelText(/question template/i));
      await user.paste("Translate: {term}");
      await user.click(screen.getByRole("button", { name: /upload and open collection/i }));
      await waitFor(() => expect(itemsApi.uploadToCollection).toHaveBeenCalled());
      const first = vi.mocked(itemsApi.uploadToCollection).mock.calls[0][0].items[0];
      expect(first.question).toBe("Translate: gato");
      expect(first.correctAnswer).toBe("cat");
    });

    it("blocks upload and explains when fewer than 4 rows are usable", async () => {
      // AC 2.6.9
      const user = userEvent.setup({ delay: null });
      await openPasteTab(user);
      await user.click(screen.getByLabelText(/pasted text/i));
      fireEvent.change(screen.getByLabelText(/pasted text/i), { target: { value: "cat\tgato\ndog\tperro" } });
      expect(await screen.findByText(/at least 4 usable rows are needed to build/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /upload and open collection/i })).toBeDisabled();
    });

    it("warns that only the first 100 items are imported for non-admins", async () => {
      // AC 2.6.9
      authState.isAdmin = false;
      const user = userEvent.setup({ delay: null });
      await openPasteTab(user);
      const many = Array.from({ length: 120 }, (_, i) => `t${i}\td${i}`).join("\n");
      fireEvent.change(screen.getByLabelText(/pasted text/i), { target: { value: many } });
      expect(await screen.findByText(/only the first 100 will be imported/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /upload and open collection/i }));
      await waitFor(() => expect(itemsApi.uploadToCollection).toHaveBeenCalled());
      expect(vi.mocked(itemsApi.uploadToCollection).mock.calls[0][0].items).toHaveLength(100);
    });

    it("allows up to 1000 items for admins and warns above that", async () => {
      // AC 2.6.9
      authState.isAdmin = true;
      const user = userEvent.setup({ delay: null });
      await openPasteTab(user);
      const lines = (n: number) => Array.from({ length: n }, (_, i) => `t${i}\td${i}`).join("\n");
      fireEvent.change(screen.getByLabelText(/pasted text/i), { target: { value: lines(150) } });
      expect(await screen.findByText(/150 items ready/i)).toBeInTheDocument();
      expect(screen.queryByText(/only the first/i)).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/pasted text/i), { target: { value: lines(1100) } });
      expect(await screen.findByText(/only the first 1000 will be imported/i)).toBeInTheDocument();
    });

    it("moves between the two tabs with the arrow keys using roving tabindex", async () => {
      // AC 2.6.9
      const user = userEvent.setup({ delay: null });
      renderPage("/items/upload-to-collection");
      await screen.findByLabelText(/^category \*$/i);
      const jsonTab = screen.getByRole("tab", { name: "JSON" });
      const pasteTab = screen.getByRole("tab", { name: /paste text/i });
      expect(jsonTab).toHaveAttribute("tabindex", "0");
      expect(pasteTab).toHaveAttribute("tabindex", "-1");
      jsonTab.focus();
      await user.keyboard("{ArrowRight}");
      expect(pasteTab).toHaveFocus();
      expect(pasteTab).toHaveAttribute("aria-selected", "true");
      await user.keyboard("{ArrowLeft}");
      expect(jsonTab).toHaveFocus();
      expect(jsonTab).toHaveAttribute("aria-selected", "true");
    });

    it("requires a category before uploading", async () => {
      // AC 2.6.9
      const user = userEvent.setup({ delay: null });
      renderPage("/items/upload-to-collection");
      await screen.findByLabelText(/^category \*$/i);
      await user.click(screen.getByRole("tab", { name: /paste text/i }));
      fireEvent.change(screen.getByLabelText(/pasted text/i), { target: { value: rows } });
      await user.click(screen.getByRole("button", { name: /upload and open collection/i }));
      expect(await screen.findByText(/choose a topic: pick a suggestion, search, or browse all topics/i)).toBeInTheDocument();
      expect(itemsApi.uploadToCollection).not.toHaveBeenCalled();
    });
  });

  it("Remove topic clears a URL-prefilled topic and focuses the search (#323)", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage("/items/upload-to-collection?category=science&keywords=anatomy,muscular");
    const remove = await screen.findByRole("button", { name: /remove topic/i });
    await user.click(remove);
    await waitFor(() => expect(screen.queryByTestId("topic-pill")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/category/i)).toHaveValue("");
    expect(screen.getByLabelText(/primary topic/i)).toHaveValue("");
    expect(screen.getByLabelText(/subtopic/i)).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("combobox", { name: /search topics/i })).toHaveFocus());
  });
});
