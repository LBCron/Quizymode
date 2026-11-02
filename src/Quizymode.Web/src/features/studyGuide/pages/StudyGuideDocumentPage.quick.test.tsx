import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import StudyGuideDocumentPage from "./StudyGuideDocumentPage";
import {
  studyGuideDocumentsApi,
  type StudyGuideCandidate,
  type StudyGuideDocument,
  type StudyGuideSection,
} from "@/api/studyGuideDocuments";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isAdmin: false }),
}));

vi.mock("@/api/studyGuideDocuments", () => ({
  studyGuideDocumentsApi: {
    get: vi.fn(),
    generate: vi.fn(),
    accept: vi.fn(),
    getConfig: vi.fn(),
  },
}));

function LearnProbe() {
  const location = useLocation();
  return (
    <div data-testid="learn-route">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  );
}

function renderPage(state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: "/study-guides/documents/doc-1", state }]}>
        <Routes>
          <Route path="/study-guides/documents/:id" element={<StudyGuideDocumentPage />} />
          <Route path="/learn/collections/:collectionId/:slug?" element={<LearnProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
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
    autoSave: null,
    ...overrides,
  };
}

function makeDocument(sections: StudyGuideSection[], overrides: Partial<StudyGuideDocument> = {}): StudyGuideDocument {
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
    quota: { tier: "Free", dailyLimit: 10, dailyUsed: 3, monthlyLimit: 60, monthlyUsed: 20, remainingToday: 7 },
    sections,
    ...overrides,
  };
}

const saved = (index: number, candidates: StudyGuideCandidate[]) =>
  section(index, { status: "Generated", autoSave: "Saved", candidates });

describe("StudyGuideDocumentPage: Make a quiz (#363)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only a progress panel while questions are being made", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([
        section(0, { status: "Generated", autoSave: "Pending", candidates: [candidate("c1")] }),
        section(1, { status: "Processing", autoSave: "Pending" }),
        section(2, { status: "Queued", autoSave: "Pending" }),
      ])
    );

    renderPage({ quick: true });

    const panel = await screen.findByRole("region", { name: "Making your quiz" });
    await waitFor(() => expect(panel).toHaveFocus());
    expect(screen.getByText("Making your quiz: 1 of 3 sections ready.")).toBeInTheDocument();
    expect(screen.getByText("Saving")).toBeInTheDocument();
    expect(screen.getByText("Making questions")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose sections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save \d+ selected/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Question c1?", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/free plan: generation starts/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
  });

  it("says the quiz is in line while every section is still queued", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([section(0, { status: "Queued", autoSave: "Pending" })])
    );

    renderPage({ quick: true });

    expect(await screen.findByText("Your quiz is in line.")).toBeInTheDocument();
  });

  it("keeps showing progress after a refresh of the page without quick state, and never redirects", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([section(0, { status: "Generated", autoSave: "Pending", candidates: [candidate("c1")] })])
    );

    renderPage();

    expect(await screen.findByText("Saving your questions…")).toBeInTheDocument();
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
  });

  it("opens Learn once everything is saved", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument(
        [saved(0, [candidate("c1", { accepted: true, itemId: "it1" }), candidate("c2", { accepted: true, itemId: "it2", index: 1 })])],
        { collectionId: "col-1" }
      )
    );

    renderPage({ quick: true });

    const route = await screen.findByTestId("learn-route");
    expect(route).toHaveTextContent("/learn/collections/col-1/biology+unit+3");
    expect(route).toHaveTextContent("|null");
    expect(studyGuideDocumentsApi.get).toHaveBeenCalledTimes(1);
  });

  it("opens Learn with a one-line notice when some sections could not be made", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument(
        [
          saved(0, [candidate("c1", { accepted: true, itemId: "it1" })]),
          saved(1, [candidate("c2", { accepted: true, itemId: "it2" })]),
          section(2, { status: "Failed", autoSave: "Pending", error: "Generation failed." }),
        ],
        { collectionId: "col-1" }
      )
    );

    renderPage({ quick: true });

    const route = await screen.findByTestId("learn-route");
    expect(route).toHaveTextContent(
      "2 of 3 sections were made. 1 section couldn't be made and wasn't counted against your limit. Retry from your study guide."
    );
    expect(route).toHaveTextContent('"documentId":"doc-1"');
  });

  it("stays on the page with one failure line and the failed sections preselected when nothing could be made", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([
        section(0, { status: "Failed", autoSave: "Pending", error: "Generation failed." }),
        section(1, { status: "Failed", autoSave: "Pending", error: "Generation failed." }),
      ])
    );

    renderPage({ quick: true });

    const alert = await screen.findByText(
      "We couldn't make questions from this guide. You weren't charged. Please try again in a bit."
    );
    await waitFor(() => expect(alert.closest('[role="alert"]')).toHaveFocus());
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "pp. 1–3" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pp. 4–6" })).toBeChecked();
  });

  it("stays when the sections finished but produced no questions", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([saved(0, [])], { collectionId: null })
    );

    renderPage({ quick: true });

    expect(
      await screen.findByText("We couldn't make any questions from these notes. Try a longer or more detailed section.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
  });

  it("does not redirect on a later visit; saved questions show Saved and an Edit link, with Learn in the header", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument(
        [saved(0, [candidate("c1", { accepted: true, itemId: "it1" }), candidate("c2", { accepted: true, itemId: undefined, index: 1 })])],
        { collectionId: "col-1" }
      )
    );

    renderPage();

    expect(await screen.findByRole("heading", { name: "Your questions" })).toBeInTheDocument();
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn" })).toHaveAttribute("href", "/learn/collections/col-1/biology+unit+3");
    expect(screen.getAllByText("Saved").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "Edit saved question 1" })).toHaveAttribute("href", "/items/it1/edit");
    expect(screen.queryByRole("link", { name: "Edit saved question 2" })).not.toBeInTheDocument();
    expect(screen.getByText("Saved to your private collection. Use Edit to change one.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Collection name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save \d+ selected/ })).not.toBeInTheDocument();
  });

  it("treats unsaved candidates of an auto-saved section as already handled, not as something to save", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument(
        [saved(0, [candidate("c1", { accepted: true, itemId: "it1" }), candidate("c2", { accepted: false, index: 1 })])],
        { collectionId: "col-1" }
      )
    );

    renderPage();

    expect(await screen.findByText("Already in your items")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Include question 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save \d+ selected/ })).not.toBeInTheDocument();
  });

  it("tells the user to press Save, not that they were not charged, when the automatic save gave up", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([section(0, { status: "Generated", autoSave: "Failed", candidates: [candidate("c1")] })])
    );

    renderPage({ quick: true });

    const alert = await screen.findByText("We couldn't save your questions automatically. Review them below and press Save.");
    await waitFor(() => expect(alert.closest('[role="alert"]')).toHaveFocus());
    expect(screen.queryByText(/weren't charged/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 1 selected" })).toBeEnabled();
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
  });

  it("opens Learn with a save-failed notice that does not claim the section was free", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument(
        [
          saved(0, [candidate("c1", { accepted: true, itemId: "it1" })]),
          section(1, { status: "Generated", autoSave: "Failed", candidates: [candidate("c2")] }),
        ],
        { collectionId: "col-1" }
      )
    );

    renderPage({ quick: true });

    const route = await screen.findByTestId("learn-route");
    expect(route).toHaveTextContent(
      "1 of 2 sections were made. 1 section couldn't be saved automatically. Open your study guide to save it."
    );
    expect(route).not.toHaveTextContent(/counted against/);
  });

  it("keeps the manual review and Save bar for a section whose auto-save failed", async () => {
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([section(0, { status: "Generated", autoSave: "Failed", candidates: [candidate("c1")] })])
    );

    renderPage();

    expect(await screen.findByRole("heading", { name: "Review questions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save 1 selected" })).toBeEnabled();
  });

  it("shows exactly one server line above the normal picker and preselects up to the quick-path cap", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue({
      enabled: true,
      maxFileBytes: 1,
      maxPages: 1,
      maxTextBytes: 1,
      acceptedExtensions: [],
      freeTierDelayMinutes: 10,
      quota: makeDocument([]).quota,
      quickPathMaxSections: 2,
    });
    vi.mocked(studyGuideDocumentsApi.get).mockResolvedValue(
      makeDocument([0, 1, 2, 3, 4].map((index) => section(index)))
    );

    renderPage({ quickMessage: "This has 5 sections. A quick quiz covers up to 2, so pick the ones you want below." });

    expect(await screen.findByText(/This has 5 sections/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose sections" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Making your quiz" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("learn-route")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate 2 sections" })).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "pp. 1–3" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pp. 4–6" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pp. 7–9" })).not.toBeChecked();
  });

  it("keeps the last data and tells the user when a poll fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(studyGuideDocumentsApi.get)
        .mockResolvedValueOnce(makeDocument([section(0, { status: "Processing", autoSave: "Pending" })]))
        .mockRejectedValue(new Error("network"));

      renderPage({ quick: true });
      expect(await screen.findByText(/Making your quiz: 0 of 1 sections ready\./)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });

      expect(await screen.findByText("Can't check progress right now. Trying again…")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Making your quiz" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
