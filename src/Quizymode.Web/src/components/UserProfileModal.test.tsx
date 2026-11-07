import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { studySessionsApi } from "@/api/studySessions";
import { interestsApi } from "@/api/learningLoop";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";
import UserProfileModal from "./UserProfileModal";

const auth = vi.hoisted(() => ({ isAuthenticated: true, userId: "user-1" as string | null }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/api/users", () => ({
  usersApi: {
    getCurrent: vi.fn().mockResolvedValue({
      id: "u",
      name: "Ann",
      email: "a@b.c",
      isAdmin: false,
      createdAt: "2026-01-01T00:00:00Z",
      lastLogin: "2026-10-01T00:00:00Z",
    }),
  },
}));
vi.mock("@/api/learningLoop", () => ({ interestsApi: { get: vi.fn(), replace: vi.fn() } }));
vi.mock("@/api/studySessions", () => ({ studySessionsApi: { getSummary: vi.fn() } }));
vi.mock("@/hooks/usePageSize", () => ({
  usePageSize: () => ({ pageSize: 20, updatePageSize: vi.fn(), isUpdating: false }),
  PAGE_SIZE_OPTIONS: [20, 50],
}));

function renderModal(onClose: () => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TopicEditorProvider>
          <UserProfileModal isOpen onClose={onClose} />
        </TopicEditorProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("UserProfileModal study totals (issue #259)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryLocalStorage();
    auth.isAuthenticated = true;
    vi.mocked(interestsApi.get).mockResolvedValue([]);
  });

  it("shows the summary totals and a link to /progress", async () => {
    vi.mocked(studySessionsApi.getSummary).mockResolvedValue({
      totalSessions: 12,
      totalQuestions: 80,
      totalCorrect: 60,
      accuracyPercent: 75,
      last30DaysSessions: 5,
      last30DaysAccuracyPercent: 80,
      importedSessions: 0,
    });
    renderModal();

    expect(await screen.findByRole("heading", { name: "Study progress" })).toBeInTheDocument();
    const totals = await screen.findByTestId("profile-study-summary");
    expect(totals).toHaveTextContent("12");
    expect(totals).toHaveTextContent("sessions");
    expect(totals).toHaveTextContent("80");
    expect(totals).toHaveTextContent("75%");
    expect(screen.getByRole("link", { name: "View my progress" })).toHaveAttribute("href", "/progress");
  });

  it("closes the dialog when the progress link is followed", async () => {
    vi.mocked(studySessionsApi.getSummary).mockResolvedValue({
      totalSessions: 1,
      totalQuestions: 1,
      totalCorrect: 1,
      accuracyPercent: 100,
      last30DaysSessions: 1,
      last30DaysAccuracyPercent: 100,
      importedSessions: 0,
    });
    const onClose = vi.fn();
    renderModal(onClose);

    await userEvent.click(await screen.findByRole("link", { name: "View my progress" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the profile and the progress link when totals fail to load", async () => {
    vi.mocked(studySessionsApi.getSummary).mockRejectedValue(new Error("boom"));
    renderModal();

    expect(await screen.findByText("Study totals are not available right now.")).toBeInTheDocument();
    expect(screen.getByText("a@b.c")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View my progress" })).toBeInTheDocument();
  });

  it("does not request totals for guests", () => {
    auth.isAuthenticated = false;
    renderModal();
    expect(studySessionsApi.getSummary).not.toHaveBeenCalled();
  });

  it("#382: shows the chosen topics in a My topics row", async () => {
    vi.mocked(studySessionsApi.getSummary).mockRejectedValue(new Error("boom"));
    vi.mocked(interestsApi.get).mockResolvedValue(["science", "history"]);
    renderModal();
    expect(await screen.findByText("Science, History")).toBeInTheDocument();
    expect(screen.getByText("My topics")).toBeInTheDocument();
  });

  it("#382: shows None when no topics are chosen", async () => {
    vi.mocked(studySessionsApi.getSummary).mockRejectedValue(new Error("boom"));
    renderModal();
    expect(await screen.findByText("None")).toBeInTheDocument();
  });

  it("#382: Change topics closes the profile first so only one dialog is open, then opens the editor", async () => {
    vi.mocked(studySessionsApi.getSummary).mockRejectedValue(new Error("boom"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Host() {
      const [open, setOpen] = useState(true);
      return <UserProfileModal isOpen={open} onClose={() => setOpen(false)} />;
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TopicEditorProvider>
            <Host />
          </TopicEditorProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Change topics" }));

    expect(await screen.findByRole("dialog", { name: "My topics" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "User Profile" })).not.toBeInTheDocument();
  });

  it("#382: does not request topics for guests", () => {
    auth.isAuthenticated = false;
    renderModal();
    expect(interestsApi.get).not.toHaveBeenCalled();
  });

  it("#504: signed-in users get the Appearance picker; guests do not", async () => {
    vi.mocked(studySessionsApi.getSummary).mockRejectedValue(new Error("boom"));
    const view = renderModal();
    expect(await screen.findByRole("group", { name: "Appearance" })).toBeInTheDocument();
    view.unmount();

    auth.isAuthenticated = false;
    renderModal();
    expect(screen.queryByRole("group", { name: "Appearance" })).not.toBeInTheDocument();
  });
});
