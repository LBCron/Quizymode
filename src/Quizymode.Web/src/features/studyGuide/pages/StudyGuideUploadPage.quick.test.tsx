import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import StudyGuideUploadPage from "./StudyGuideUploadPage";
import { taxonomyApi } from "@/api/taxonomy";
import {
  studyGuideDocumentsApi,
  type StudyGuideDocumentsConfig,
  type StudyGuideQuickResponse,
} from "@/api/studyGuideDocuments";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock("@/features/legal/components/ContentComplianceNotice", () => ({
  default: () => null,
}));

vi.mock("@/api/taxonomy", () => ({
  taxonomyApi: { getAll: vi.fn(), suggest: vi.fn() },
}));

vi.mock("@/api/studyGuideDocuments", () => ({
  studyGuideDocumentsApi: {
    getConfig: vi.fn(),
    create: vi.fn(),
    quick: vi.fn(),
  },
}));

function RouteProbe() {
  const location = useLocation();
  return (
    <div data-testid="route">
      {location.pathname}|{JSON.stringify(location.state)}
    </div>
  );
}

let lastQueryClient: QueryClient;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/create/notes"]}>
        <Routes>
          <Route path="/create/notes" element={<StudyGuideUploadPage />} />
          <Route path="/study-guides/documents/:id" element={<RouteProbe />} />
          <Route path="/learn/collections/:collectionId/:slug?" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const config: StudyGuideDocumentsConfig = {
  enabled: true,
  maxFileBytes: 20 * 1024 * 1024,
  maxPages: 300,
  maxTextBytes: 1000,
  acceptedExtensions: [".pdf", ".docx", ".pptx", ".txt", ".md"],
  freeTierDelayMinutes: 10,
  quota: { tier: "Free", dailyLimit: 10, dailyUsed: 0, monthlyLimit: 60, monthlyUsed: 0, remainingToday: 10 },
  quickPathMaxSections: 3,
};

function quickResponse(
  overrides: Partial<Omit<StudyGuideQuickResponse, "document">> & { document?: Partial<StudyGuideQuickResponse["document"]> } = {}
): StudyGuideQuickResponse {
  const { document: documentOverrides, ...rest } = overrides;
  return {
    document: { id: "doc-9", title: "Biology Unit", isDuplicate: false, collectionId: null, ...documentOverrides },
    outcome: "Generating",
    message: "Making your quiz.",
    queuedCount: 1,
    cachedCount: 0,
    chargedSections: 1,
    collectionName: null,
    ...rest,
  } as StudyGuideQuickResponse;
}

async function fillTopic() {
  await screen.findByRole("option", { name: "science" });
  fireEvent.change(screen.getByLabelText(/^category \*$/i), { target: { value: "science" } });
  await screen.findByRole("option", { name: "biology" });
  fireEvent.change(screen.getByLabelText(/primary topic/i), { target: { value: "biology" } });
  await screen.findByRole("option", { name: "plants" });
  fireEvent.change(screen.getByLabelText(/subtopic/i), { target: { value: "plants" } });
}

async function renderReady() {
  renderPage();
  fireEvent.click(await screen.findByRole("tab", { name: /paste text/i }));
  fireEvent.change(screen.getByLabelText(/study guide text/i), { target: { value: "Photosynthesis notes" } });
  await fillTopic();
}

function rejection(status: number, data: unknown) {
  return new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "error",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  });
}

describe("StudyGuideUploadPage: Make a quiz (#363)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue(config);
    vi.mocked(taxonomyApi.getAll).mockResolvedValue({
      categories: [
        {
          slug: "science",
          name: "Science",
          description: null,
          itemCount: 0,
          allKeywordSlugs: ["biology", "plants"],
          groups: [
            {
              slug: "biology",
              description: null,
              itemCount: 0,
              keywords: [{ slug: "plants", description: "Plant biology", itemCount: 0 }],
            },
          ],
        },
      ],
    });
    vi.mocked(taxonomyApi.suggest).mockResolvedValue({ suggestions: [] });
  });

  it("offers Make a quiz first and Choose sections and review first second, with the allowance line", async () => {
    renderPage();

    const buttons = await screen.findAllByRole("button", { name: /make a quiz|choose sections and review first/i });
    expect(buttons.map((button) => button.textContent)).toEqual(["Make a quiz", "Choose sections and review first"]);
    expect(screen.getByText("A quick quiz covers up to 3 sections. You have 10 sections left today.")).toHaveAttribute(
      "id",
      "quick-allowance"
    );
    expect(buttons[0]).toHaveAttribute("aria-describedby", "quick-allowance");
    expect(screen.getByText(/pick the sections and check every question before anything is saved/i)).toBeInTheDocument();
  });

  it("explains when no sections are left today", async () => {
    vi.mocked(studyGuideDocumentsApi.getConfig).mockResolvedValue({
      ...config,
      quota: { ...config.quota, remainingToday: 0 },
    });

    renderPage();

    expect(
      await screen.findByText("A quick quiz covers up to 3 sections. You've used all your sections for today. Try again tomorrow.")
    ).toBeInTheDocument();
  });

  it("keeps Title and Keywords under a collapsed More options that preserves what was typed", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", { name: /more options/i });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("study-guide-more-options")).toHaveAttribute("hidden");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("study-guide-more-options")).not.toHaveAttribute("hidden");
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "My title" } });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText(/title/i)).toHaveValue("My title");
  });

  it("requires the topic before making a quiz and sends nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /paste text/i }));
    fireEvent.change(screen.getByLabelText(/study guide text/i), { target: { value: "Notes" } });

    fireEvent.click(screen.getByRole("button", { name: "Make a quiz" }));

    expect(studyGuideDocumentsApi.quick).not.toHaveBeenCalled();
    expect(studyGuideDocumentsApi.create).not.toHaveBeenCalled();
  });

  it("opens Learn (replacing the page) when the quiz is already ready", async () => {
    vi.mocked(studyGuideDocumentsApi.quick).mockResolvedValue(
      quickResponse({ outcome: "Ready", collectionName: "Biology Unit", document: { collectionId: "col-1" } })
    );

    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Make a quiz" }));

    await waitFor(() =>
      expect(studyGuideDocumentsApi.quick).toHaveBeenCalledWith(expect.objectContaining({ text: "Photosynthesis notes" }))
    );
    expect(await screen.findByTestId("route")).toHaveTextContent("/learn/collections/col-1/biology+unit");
  });

  it("opens the document page in quick mode while questions are being made", async () => {
    const response = quickResponse({ document: { isDuplicate: true } });
    vi.mocked(studyGuideDocumentsApi.quick).mockResolvedValue(response);

    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Make a quiz" }));

    await screen.findByTestId("route");
    expect(lastQueryClient.getQueryData(["studyGuideDocuments", "doc-9"])).toBe(response.document);

    expect(await screen.findByTestId("route")).toHaveTextContent(
      '/study-guides/documents/doc-9|{"quick":true,"isDuplicate":true}'
    );
  });

  it.each(["NeedsChoice", "OverAllowance", "Unavailable"] as const)(
    "hands %s to the document page with the server line",
    async (outcome) => {
      vi.mocked(studyGuideDocumentsApi.quick).mockResolvedValue(quickResponse({ outcome, message: "Pick up to 3 sections." }));

      await renderReady();
      fireEvent.click(screen.getByRole("button", { name: "Make a quiz" }));

      expect(await screen.findByTestId("route")).toHaveTextContent(
        '/study-guides/documents/doc-9|{"quickMessage":"Pick up to 3 sections.","isDuplicate":false}'
      );
    }
  );

  it("sends one request for a double click and blocks both buttons while it runs", async () => {
    vi.mocked(studyGuideDocumentsApi.quick).mockReturnValue(new Promise(() => {}));

    await renderReady();
    const primary = screen.getByRole("button", { name: "Make a quiz" });
    fireEvent.click(primary);
    fireEvent.click(primary);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Making your quiz…" })).toHaveAttribute("aria-disabled", "true")
    );
    fireEvent.click(screen.getByRole("button", { name: "Making your quiz…" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose sections and review first" }));
    expect(studyGuideDocumentsApi.quick).toHaveBeenCalledTimes(1);
    expect(studyGuideDocumentsApi.create).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choose sections and review first" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Making your quiz. Reading your notes.")).toBeInTheDocument();
    expect(screen.getByLabelText(/study guide text/i)).toBeDisabled();
  });

  it("announces the review-first upload separately and disables the inputs", async () => {
    vi.mocked(studyGuideDocumentsApi.create).mockReturnValue(new Promise(() => {}));

    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Choose sections and review first" }));

    expect(await screen.findByText("Uploading your study guide.")).toBeInTheDocument();
    expect(screen.queryByText("Making your quiz. Reading your notes.")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeDisabled();
  });

  it("shows the server message in a focused alert when the notes cannot be read and keeps the values", async () => {
    vi.mocked(studyGuideDocumentsApi.quick).mockRejectedValue(
      rejection(400, {
        title: "StudyGuideDocument.Scanned",
        detail: "This looks like a scan; only PDFs with selectable text are supported for now.",
      })
    );

    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Make a quiz" }));

    const alert = await screen.findByText(/looks like a scan/i);
    const region = alert.closest('[role="alert"]') as HTMLElement;
    expect(region).toBeInTheDocument();
    await waitFor(() => expect(region).toHaveFocus());
    expect(screen.getByLabelText(/study guide text/i)).toHaveValue("Photosynthesis notes");
  });

  it("shows the unavailable card when generation is disabled (503)", async () => {
    vi.mocked(studyGuideDocumentsApi.quick).mockRejectedValue(rejection(503, { title: "StudyGuideDocument.Disabled" }));

    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Make a quiz" }));

    expect(await screen.findByText(/feature unavailable/i)).toBeInTheDocument();
  });
});
