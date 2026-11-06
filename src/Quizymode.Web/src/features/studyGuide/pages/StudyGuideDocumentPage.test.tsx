import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import StudyGuideDocumentPage from "./StudyGuideDocumentPage";
import {
  studyGuideDocumentsApi,
  type StudyGuideCandidate,
  type StudyGuideDocument,
  type StudyGuideSection,
} from "@/api/studyGuideDocuments";

const authState = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isAdmin: authState.isAdmin }),
}));

vi.mock("@/api/studyGuideDocuments", () => ({
  studyGuideDocumentsApi: {
    get: vi.fn(),
    generate: vi.fn(),
    accept: vi.fn(),
  },
}));

function renderPage(state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: "/study-guides/documents/doc-1", state }]}>
        <Routes>
          <Route path="/study-guides/documents/:id" element={<StudyGuideDocumentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function section(index: number, overrides: Partial<StudyGuideSection> = {}): StudyGuideSection {
  return {
    id: `s${index}`,
    index,
    label: `pp. ${index * 3 + 1}–${index * 3 + 3}`,
    pageStart: index * 3 + 1,
    pageEnd: index * 3 + 3,
    preview: `Preview of section ${index}`,
    sizeBytes: 8000,
    textExpired: false,
    status: "New",
    cached: false,
    notBeforeUtc: null,
    error: null,
    droppedCount: 0,
    candidates: [],
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<StudyGuideCandidate> = {}): StudyGuideCandidate {
  return {
    id,
    index: 0,
    question: `Question ${id}?`,
    correctAnswer: `Right ${id}`,
    incorrectAnswers: [`Wrong ${id} A`, `Wrong ${id} B`],
    explanation: `Because ${id}.`,
    sourceQuote: `The guide says ${id} clearly here.`,
    page: 14,
    accepted: false,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<StudyGuideDocument> = {}): StudyGuideDocument {
  return {
    id: "doc-1",
    title: "Biology Unit 3",
    fileType: "pdf",
    pageCount: 18,
    category: "science",
    navigationKeyword1: "biology",
    navigationKeyword2: "cells",
    keywords: [],
    collectionId: null,
    createdUtc: "2026-10-17T00:00:00Z",
    expiresUtc: "2026-11-16T00:00:00Z",
    isDuplicate: false,
    quota: { tier: "Free", dailyLimit: 10, dailyUsed: 7, monthlyLimit: 60, monthlyUsed: 20, remainingToday: 3 },
    sections: [0, 1, 2, 3, 4, 5].map((index) => section(index)),
    ...overrides,
  };
}

function sectionCheckbox(label: string) {
  return screen.getByRole("checkbox", { name: label });
}

describe("StudyGuideDocumentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAdmin = false;
  });

  it("shows the header with progress, expiry and the duplicate notice", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({ collectionId: "col-1", sections: [section(0, { status: "Generated", candidates: [] }), section(1)] })
    );

    renderPage({ isDuplicate: true });

    expect(await screen.findByRole("heading", { name: "Biology Unit 3" })).toBeInTheDocument();
    expect(screen.getByText(/18 pages · 1 of 2 sections generated/)).toBeInTheDocument();
    expect(screen.getByText(/text kept until/i)).toBeInTheDocument();
    expect(screen.getByText(/already uploaded this study guide/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open collection/i })[0]).toHaveAttribute(
      "href",
      "/explore/collections/col-1"
    );
  });

  it("preselects the first unprocessed sections up to the quota left today and never counts cached ones", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({
        sections: [
          section(0, { status: "Generated", cached: true }),
          section(1),
          section(2, { textExpired: true, preview: "" }),
          section(3),
          section(4, { status: "Failed", error: "Generation failed." }),
          section(5),
          section(6),
        ],
      })
    );

    renderPage();

    await screen.findByRole("heading", { name: "Biology Unit 3" });
    expect(sectionCheckbox("pp. 1–3")).not.toBeChecked();
    expect(sectionCheckbox("pp. 1–3")).toBeDisabled();
    expect(sectionCheckbox("pp. 4–6")).toBeChecked();
    expect(sectionCheckbox("pp. 7–9")).toBeDisabled();
    expect(sectionCheckbox("pp. 10–12")).toBeChecked();
    expect(sectionCheckbox("pp. 13–15")).not.toBeChecked();
    expect(sectionCheckbox("pp. 16–18")).toBeChecked();
    expect(sectionCheckbox("pp. 19–21")).not.toBeChecked();

    const counter = screen.getByTestId("study-guide-quota-counter");
    expect(counter).toHaveTextContent("10 of 10 sections today");
    expect(counter).toHaveTextContent("23 of 60 this month");
    expect(screen.getByText("Ready, free")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate 3 sections" })).toBeEnabled();

    fireEvent.click(sectionCheckbox("pp. 4–6"));
    expect(counter).toHaveTextContent("9 of 10 sections today");
    expect(screen.getByRole("button", { name: "Generate 2 sections" })).toBeEnabled();
  });

  it("disables Generate when the selection exceeds the sections left today", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(makeDocument());

    renderPage();

    await screen.findByRole("heading", { name: "Biology Unit 3" });
    fireEvent.click(sectionCheckbox("pp. 10–12"));
    expect(screen.getByRole("button", { name: "Generate 4 sections" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/more sections than you have left today/i);
  });

  it("disables Generate with nothing selected when no quota is left", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({
        quota: { tier: "Free", dailyLimit: 10, dailyUsed: 10, monthlyLimit: 60, monthlyUsed: 30, remainingToday: 0 },
      })
    );

    renderPage();

    expect(await screen.findByRole("button", { name: "Generate 0 sections" })).toBeDisabled();
    expect(screen.getByText(/0 sections left today/)).toBeInTheDocument();
  });

  it("generates the selected sections and shows the quota message on 429", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(makeDocument());
    vi.mocked(studyGuideDocumentsApi.generate).mockRejectedValueOnce(
      new AxiosError("Too Many Requests", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 429,
        statusText: "Too Many Requests",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { title: "StudyGuideDocument.QuotaExceeded", detail: "Daily limit of 10 sections reached." },
      })
    );

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Generate 3 sections" }));

    await waitFor(() => expect(studyGuideDocumentsApi.generate).toHaveBeenCalledWith("doc-1", ["s0", "s1", "s2"], "Recall"));
    expect(await screen.findByText("Daily limit of 10 sections reached.")).toBeInTheDocument();
  });

  it("sends the clinical scenario question style when it is chosen", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(makeDocument());
    vi.mocked(studyGuideDocumentsApi.generate).mockResolvedValueOnce({
      queuedCount: 3,
      cachedCount: 0,
      chargedSections: 3,
      quota: makeDocument().quota,
    });

    renderPage();

    fireEvent.click(await screen.findByLabelText(/Clinical scenario/));
    fireEvent.click(await screen.findByRole("button", { name: "Generate 3 sections" }));

    await waitFor(() =>
      expect(studyGuideDocumentsApi.generate).toHaveBeenCalledWith("doc-1", ["s0", "s1", "s2"], "ClinicalScenario")
    );
  });

  it("polls while sections are queued and shows the free-tier delay", async () => {
    const queued = makeDocument({
      sections: [
        section(0, { status: "Queued", notBeforeUtc: new Date(Date.now() + 9.5 * 60_000).toISOString() }),
        section(1),
      ],
    });
    const generated = makeDocument({
      sections: [section(0, { status: "Generated", candidates: [candidate("c1")] }), section(1)],
    });
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValueOnce(queued).mockResolvedValue(generated);

    renderPage();

    expect(await screen.findByText(/free plan: generation starts within about 10 minutes/i)).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(await screen.findByText("1. Question c1?", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(studyGuideDocumentsApi.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/free plan: generation starts/i)).not.toBeInTheDocument();
  });

  it("marks Choose coverage as the current step before anything is generated", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(makeDocument());

    renderPage();

    await screen.findByRole("heading", { name: "Biology Unit 3" });
    const current = screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Choose coverage");
    expect(screen.queryByLabelText("Collection name")).not.toBeInTheDocument();
  });

  it("marks Review as current once a section is generated", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({ sections: [section(0, { status: "Generated", candidates: [candidate("c1")] }), section(1)] })
    );

    renderPage();

    await screen.findByRole("heading", { name: "Biology Unit 3" });
    const current = screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "step");
    expect(current[0]).toHaveTextContent("Review");
  });

  it("sends the collection name on the first save, then hides the input and offers the four success actions", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({ sections: [section(0, { status: "Generated", candidates: [candidate("c1")] }), section(1)] })
    );
    vi.mocked(studyGuideDocumentsApi.accept).mockResolvedValue({
      collectionId: "col-9",
      createdCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      itemIds: ["i1"],
    });

    renderPage();

    const input = await screen.findByLabelText("Collection name");
    expect(input).toHaveValue("Biology Unit 3");
    fireEvent.change(input, { target: { value: "  Cell biology  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 selected" }));

    await waitFor(() =>
      expect(studyGuideDocumentsApi.accept).toHaveBeenCalledWith("doc-1", [{ id: "c1" }], "Cell biology", undefined)
    );
    expect(await screen.findByText(/saved 1 question to your collection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Collection name")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start quiz" })).toHaveAttribute("href", "/quiz/collections/col-9");
    expect(screen.getByRole("link", { name: "Study flashcards" })).toHaveAttribute("href", "/explore/collections/col-9");
    expect(screen.getAllByRole("link", { name: "Open collection" }).at(-1)).toHaveAttribute("href", "/collections/col-9");

    fireEvent.click(screen.getByRole("button", { name: "Add more" }));
    expect(screen.getByRole("heading", { name: "Choose sections" }).closest("div[tabindex='-1']")).toHaveFocus();
  });

  it("hides the Save as control from non-admins and never sends publish", async () => {
    // AC 6.6.28
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({ sections: [section(0, { status: "Generated", candidates: [candidate("c1")] }), section(1)] })
    );
    vi.mocked(studyGuideDocumentsApi.accept).mockResolvedValue({
      collectionId: "col-9", createdCount: 1, duplicateCount: 0, failedCount: 0, itemIds: ["i1"],
    });

    renderPage();

    await screen.findByRole("button", { name: "Save 1 selected" });
    expect(screen.queryByText("Save as")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /publish to the library/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 selected" }));
    await waitFor(() => expect(studyGuideDocumentsApi.accept).toHaveBeenCalled());
    expect(vi.mocked(studyGuideDocumentsApi.accept).mock.calls[0][3]).toBeUndefined();
  });

  it("lets admins publish: Private is the default and the publish flag is sent on every batch", async () => {
    // AC 6.6.28
    authState.isAdmin = true;
    const many = Array.from({ length: 205 }, (_, i) => candidate(`m${i}`, { index: i }));
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({ sections: [section(0, { status: "Generated", candidates: many }), section(1)] })
    );
    vi.mocked(studyGuideDocumentsApi.accept).mockResolvedValue({
      collectionId: "col-9", createdCount: 1, duplicateCount: 0, failedCount: 0, itemIds: ["i1"],
    });

    renderPage();

    await screen.findByRole("button", { name: "Save 205 selected" });
    expect(screen.getByRole("radio", { name: "Private (only me)" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /publish to the library/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save 205 selected" }));

    await waitFor(() => expect(studyGuideDocumentsApi.accept).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(studyGuideDocumentsApi.accept).mock.calls) {
      expect(call[3]).toBe(true);
    }
    expect(await screen.findByText(/published 2 questions to your collection/i)).toBeInTheDocument();
  });

  it("an admin who leaves Private selected does not send publish", async () => {
    // AC 6.6.28
    authState.isAdmin = true;
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({ sections: [section(0, { status: "Generated", candidates: [candidate("c1")] }), section(1)] })
    );
    vi.mocked(studyGuideDocumentsApi.accept).mockResolvedValue({
      collectionId: "col-9", createdCount: 1, duplicateCount: 0, failedCount: 0, itemIds: ["i1"],
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Save 1 selected" }));
    await waitFor(() => expect(studyGuideDocumentsApi.accept).toHaveBeenCalled());
    expect(vi.mocked(studyGuideDocumentsApi.accept).mock.calls[0][3]).toBeUndefined();
  });

  it("hides the collection name input when the document already has a collection", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({
        collectionId: "col-1",
        sections: [section(0, { status: "Generated", candidates: [candidate("c1")] }), section(1)],
      })
    );

    renderPage();

    await screen.findByRole("button", { name: "Save 1 selected" });
    expect(screen.queryByLabelText("Collection name")).not.toBeInTheDocument();
  });

  it("shows quotes, dropped counts and saved state, and accepts edited questions", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument({
        sections: [
          section(0, {
            status: "Generated",
            droppedCount: 2,
            candidates: [
              candidate("c1", { index: 0 }),
              candidate("c2", { index: 1, page: null }),
              candidate("c3", { index: 2, accepted: true }),
            ],
          }),
          section(1, { status: "Generated", candidates: [candidate("c4")] }),
        ],
      })
    );
    vi.mocked(studyGuideDocumentsApi.accept).mockResolvedValue({
      collectionId: "col-9",
      createdCount: 2,
      duplicateCount: 0,
      failedCount: 0,
      itemIds: ["i1", "i2"],
    });

    renderPage();

    expect(await screen.findByText(/2 questions dropped: not found in your guide/i)).toBeInTheDocument();
    expect(screen.getByText(/From your guide, p\. 14: “The guide says c1 clearly here\.”/)).toBeInTheDocument();
    expect(screen.getByText(/From your guide, pp\. 1–3: “The guide says c2/)).toBeInTheDocument();
    const savedCard = screen.getByTestId("candidate-c3");
    expect(within(savedCard).getByText("Saved")).toBeInTheDocument();
    expect(within(savedCard).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 3 selected" })).toBeEnabled();

    // Uncheck question 2, edit question 1.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include question 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit question 1" }));
    fireEvent.change(screen.getByLabelText("Question 1"), { target: { value: "  Edited question?  " } });
    fireEvent.change(screen.getByLabelText("Correct answer"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/correct answer is required/i);

    fireEvent.change(screen.getByLabelText("Correct answer"), { target: { value: "New right" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove wrong answer 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText(/1\. Edited question\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save 2 selected" }));

    await waitFor(() =>
      expect(studyGuideDocumentsApi.accept).toHaveBeenCalledWith("doc-1", [
        {
          id: "c1",
          question: "Edited question?",
          correctAnswer: "New right",
          incorrectAnswers: ["Wrong c1 A"],
          explanation: "Because c1.",
        },
        { id: "c4" },
      ], "Biology Unit 3", undefined)
    );
    expect(await screen.findByText(/saved 2 questions to your collection/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open collection/i }).at(-1)).toHaveAttribute(
      "href",
      "/collections/col-9"
    );
  });

  it("shows a not-found message for a missing document", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockRejectedValue(
      new AxiosError("Not Found", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 404,
        statusText: "Not Found",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {},
      })
    );

    renderPage();

    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to my study guides/i })).toHaveAttribute(
      "href",
      "/study-guides/documents"
    );
  });
});
