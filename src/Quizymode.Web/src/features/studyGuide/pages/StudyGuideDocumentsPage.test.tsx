import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import StudyGuideDocumentsPage from "./StudyGuideDocumentsPage";
import { studyGuideDocumentsApi, type StudyGuideDocumentsConfig } from "@/api/studyGuideDocuments";

vi.mock("@/api/studyGuideDocuments", () => ({
  studyGuideDocumentsApi: { list: vi.fn(), getConfig: vi.fn() },
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <StudyGuideDocumentsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function config(tier: "Free" | "Premium", monthlyUsed: number, monthlyLimit: number): StudyGuideDocumentsConfig {
  return {
    enabled: true,
    maxFileBytes: 1,
    maxPages: 1,
    maxTextBytes: 1,
    acceptedExtensions: [".pdf"],
    freeTierDelayMinutes: 10,
    quota: { tier, dailyLimit: 10, dailyUsed: 0, monthlyLimit, monthlyUsed, remainingToday: 10 },
  };
}

function summaryDocument(id: string, acceptedCount: number) {
  return {
    id,
    title: `Guide ${id}`,
    fileType: "pdf",
    sectionCount: 2,
    generatedSectionCount: 1,
    acceptedCount,
    collectionId: null,
    createdUtc: "2026-10-01T00:00:00Z",
    lastActivityUtc: "2026-10-10T00:00:00Z",
    expiresUtc: "2026-11-09T00:00:00Z",
  };
}

describe("StudyGuideDocumentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config("Free", 0, 60));
  });

  it("shows the monthly summary for a free user across all guides", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config("Free", 12, 60));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({
      documents: [summaryDocument("a", 15), summaryDocument("b", 4)],
    });

    renderPage();

    const summary = await screen.findByTestId("study-guide-summary");
    expect(summary).toHaveAttribute("aria-live", "polite");
    expect(summary).toHaveTextContent("This month: 12 of 60 sections used (free plan).");
    expect(summary).toHaveTextContent("Across all your guides: 19 questions saved in 2 study guides.");
  });

  it("badges a primary source guide in the list (AC 6.6.35)", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config("Free", 1, 60));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({
      documents: [{ ...summaryDocument("a", 1), isPrimarySource: true }, summaryDocument("b", 1)],
    });

    renderPage();

    expect(await screen.findAllByText("Primary source")).toHaveLength(1);
  });

  it("uses singular forms and the premium plan name", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config("Premium", 1, 1000));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [summaryDocument("a", 1)] });

    renderPage();

    const summary = await screen.findByTestId("study-guide-summary");
    expect(summary).toHaveTextContent("This month: 1 of 1,000 sections used (premium plan).");
    expect(summary).toHaveTextContent("Across all your guides: 1 question saved in 1 study guide.");
  });

  it("omits the limit when it is zero", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config("Free", 3, 0));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [] });

    renderPage();

    expect(await screen.findByTestId("study-guide-summary")).toHaveTextContent("This month: 3 sections used (free plan).");
  });

  it("uses the singular when the limit is zero and one section was used", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config("Free", 1, 0));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [] });

    renderPage();

    expect(await screen.findByTestId("study-guide-summary")).toHaveTextContent("This month: 1 section used (free plan).");
  });

  it("shows zeros above the empty state when there are no guides", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [] });

    renderPage();

    const summary = await screen.findByTestId("study-guide-summary");
    expect(summary).toHaveTextContent("This month: 0 of 60 sections used (free plan).");
    expect(summary).toHaveTextContent("Across all your guides: 0 questions saved in 0 study guides.");
    expect(screen.getByText(/not uploaded any study guides yet/i)).toBeInTheDocument();
  });

  it("hides the summary until both queries have loaded", async () => {
    let resolveConfig: (value: StudyGuideDocumentsConfig) => void = () => {};
    vi.mocked(studyGuideDocumentsApi.getConfig).mockReturnValue(
      new Promise<StudyGuideDocumentsConfig>((resolve) => {
        resolveConfig = resolve;
      })
    );
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [summaryDocument("a", 2)] });

    renderPage();

    expect(await screen.findByText("Guide a")).toBeInTheDocument();
    expect(screen.queryByTestId("study-guide-summary")).not.toBeInTheDocument();

    resolveConfig(config("Free", 5, 60));
    expect(await screen.findByTestId("study-guide-summary")).toBeInTheDocument();
  });

  it("omits the summary when the config request fails but still lists the guides", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockRejectedValue(new Error("boom"));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [summaryDocument("a", 2)] });

    renderPage();

    expect(await screen.findByText("Guide a")).toBeInTheDocument();
    await waitFor(() => expect(studyGuideDocumentsApi.getConfig).toHaveBeenCalled());
    expect(screen.queryByTestId("study-guide-summary")).not.toBeInTheDocument();
  });

  it("shows no summary when the list request fails", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockRejectedValue(new Error("boom"));

    renderPage();

    expect(await screen.findByText("Failed to load your study guides.")).toBeInTheDocument();
    expect(screen.queryByTestId("study-guide-summary")).not.toBeInTheDocument();
  });

  it("never shows tokens or cost", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [summaryDocument("a", 2)] });

    renderPage();

    const summary = await screen.findByTestId("study-guide-summary");
    expect(summary.textContent).not.toMatch(/token|cost|\$/i);
  });

  it("lists documents with progress and a Continue link", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({
      documents: [
        {
          id: "d1",
          title: "Biology Unit 3",
          fileType: "pdf",
          sectionCount: 6,
          generatedSectionCount: 2,
          acceptedCount: 15,
          collectionId: "c1",
          createdUtc: "2026-10-01T00:00:00Z",
          lastActivityUtc: "2026-10-10T00:00:00Z",
          expiresUtc: "2026-11-09T00:00:00Z",
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("Biology Unit 3")).toBeInTheDocument();
    expect(screen.getByText(/2 of 6 sections generated · 15 questions saved/)).toBeInTheDocument();
    expect(screen.getByText(/text kept until/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue Biology Unit 3" })).toHaveAttribute(
      "href",
      "/study-guides/documents/d1"
    );
    expect(screen.getByRole("link", { name: "Collection" })).toHaveAttribute("href", "/explore/collections/c1");
  });

  it("shows an empty state that links to the upload page", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [] });

    renderPage();

    expect(await screen.findByText(/not uploaded any study guides yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload one" })).toHaveAttribute("href", "/create/notes");
  });
});
