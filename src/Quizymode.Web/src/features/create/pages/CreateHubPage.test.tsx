import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import CreateHubPage from "./CreateHubPage";
import { studyGuideDocumentsApi } from "@/api/studyGuideDocuments";

const authState = vi.hoisted(() => ({ isAuthenticated: true }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: authState.isAuthenticated }),
}));

vi.mock("@/api/studyGuideDocuments", () => ({
  studyGuideDocumentsApi: { list: vi.fn() },
}));

function renderPage(initialEntry = "/create") {
  return render(
    <HelmetProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <CreateHubPage />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

function summaryDocument(id: string, lastActivityUtc: string, acceptedCount = 2) {
  return {
    id,
    title: `Guide ${id}`,
    fileType: "pdf",
    sectionCount: 2,
    generatedSectionCount: 1,
    acceptedCount,
    collectionId: null,
    createdUtc: "2026-10-01T00:00:00Z",
    lastActivityUtc,
    expiresUtc: "2026-12-01T00:00:00Z",
  };
}

describe("CreateHubPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [] });
  });

  it("renders the primary and secondary create paths with one h1 and h2 section headings", async () => {
    renderPage();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Create" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Turn notes into a quiz" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Write a question" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make a quiz" })).toHaveAttribute("href", "/create/notes");
    expect(screen.getByRole("link", { name: "Write a question" })).toHaveAttribute("href", "/create/question");
    expect(screen.getByRole("link", { name: "Import questions from text or a file" })).toHaveAttribute(
      "href",
      "/create/import"
    );
    expect(screen.queryByRole("link", { name: "My Study Guide" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/study-guide?"], a[href="/study-guide"]')).toBeNull();
    await screen.findByText(/no study guides yet/i);
  });

  it("keeps the query string on the question and import links", async () => {
    renderPage("/create?category=science&keywords=anatomy");

    expect(screen.getByRole("link", { name: "Write a question" })).toHaveAttribute(
      "href",
      "/create/question?category=science&keywords=anatomy"
    );
    expect(screen.queryByRole("link", { name: "Bulk Create" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import questions from text or a file" })).toHaveAttribute(
      "href",
      "/create/import?category=science&keywords=anatomy"
    );
    await screen.findByText(/no study guides yet/i);
  });

  it("shows the three most recent study guides, newest first", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({
      documents: [
        summaryDocument("old", "2026-09-01T00:00:00Z"),
        summaryDocument("newest", "2026-10-20T00:00:00Z", 1),
        summaryDocument("mid", "2026-10-10T00:00:00Z"),
        summaryDocument("older", "2026-09-15T00:00:00Z"),
      ],
    });

    renderPage();

    const continues = await screen.findAllByRole("link", { name: /^Continue / });
    expect(continues.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Continue Guide newest",
      "Continue Guide mid",
      "Continue Guide older",
    ]);
    expect(continues[0]).toHaveAttribute("href", "/study-guides/documents/newest");
    expect(screen.getByText(/1 question saved/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My study guides" })).toHaveAttribute("href", "/study-guides/documents");
  });

  it("shows the recent section without an empty message while loading", () => {
    vi.mocked(studyGuideDocumentsApi.list).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Recent study guides" })).toBeInTheDocument();
    expect(screen.queryByText(/no study guides yet/i)).not.toBeInTheDocument();
  });

  it("shows a retryable error while keeping the cards usable", async () => {
    vi.mocked(studyGuideDocumentsApi.list).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(studyGuideDocumentsApi.list).mockResolvedValue({ documents: [] });
    const user = userEvent.setup({ delay: null });
    renderPage();

    expect(await screen.findByText("Couldn't load your recent study guides.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Make a quiz" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My study guides" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry|try again/i }));
    await waitFor(() => expect(screen.getByText(/no study guides yet/i)).toBeInTheDocument());
  });

  it("shows a sign-in banner and skips the study guide query for anonymous visitors", () => {
    authState.isAuthenticated = false;
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Sign in to create quizzes and questions.");
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign Up" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("link", { name: "Make a quiz" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent study guides" })).not.toBeInTheDocument();
    expect(studyGuideDocumentsApi.list).not.toHaveBeenCalled();
  });
});
