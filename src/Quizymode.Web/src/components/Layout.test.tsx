import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { USER_GUIDE_URL } from "@/utils/userGuideLink";
import Layout from "./Layout";

const authState = vi.hoisted(() => ({ isAuthenticated: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
    logout: vi.fn(),
    username: null,
    email: null,
    isAdmin: false,
  }),
}));

vi.mock("@/api/users", () => ({
  usersApi: {
    getCurrent: vi.fn(),
    getPolicyAcceptanceStatus: vi.fn(),
  },
}));

vi.mock("./UserProfileModal", () => ({
  default: () => null,
}));

vi.mock("@/features/feedback/components/FeedbackDialog", () => ({
  default: () => null,
}));

function renderLayout(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Layout>
            <div>Page content</div>
          </Layout>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe("Layout", () => {
  const originalUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = false;
  });

  it("renders the search trigger in the header and titles /search as Search", () => {
    renderLayout(["/search"]);
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("shows a My Progress link to /progress only for signed-in users", () => {
    renderLayout();
    expect(screen.queryByRole("link", { name: "My Progress" })).not.toBeInTheDocument();
  });

  it("links signed-in users to /progress from the navigation", () => {
    authState.isAuthenticated = true;
    renderLayout();
    expect(screen.getAllByRole("link", { name: "My Progress" })[0]).toHaveAttribute("href", "/progress");
  });

  it("shows a single Create nav link instead of Add Items and Generate Quiz for signed-in users", () => {
    authState.isAuthenticated = true;
    renderLayout();
    expect(screen.getAllByRole("link", { name: "Create" })[0]).toHaveAttribute("href", "/create");
    expect(screen.queryByRole("link", { name: "Add Items" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Generate Quiz" })).not.toBeInTheDocument();
  });

  it("hides the Create nav link from anonymous users", () => {
    renderLayout();
    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument();
  });

  it.each([
    "/create",
    "/create/notes",
    "/items/add",
    "/add-new-item",
    "/items/create",
    "/items/bulk-create",
    "/items/upload",
    "/study-guides/documents/abc",
  ])("highlights Create on %s", (path) => {
    authState.isAuthenticated = true;
    renderLayout([path]);
    expect(screen.getAllByRole("link", { name: "Create" })[0]).toHaveClass("text-indigo-ink");
  });

  it.each(["/items", "/items/123", "/progress"])("does not highlight Create on %s", (path) => {
    authState.isAuthenticated = true;
    renderLayout([path]);
    expect(screen.getAllByRole("link", { name: "Create" })[0]).not.toHaveClass("text-indigo-ink");
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it("links to the published user guide for desktop browsers", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36",
    });

    renderLayout();

    expect(screen.getByRole("link", { name: "User Guide" })).toHaveAttribute(
      "href",
      USER_GUIDE_URL
    );
  });

  it("links to the published user guide for mobile browsers", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    });

    renderLayout();

    expect(screen.getByRole("link", { name: "User Guide" })).toHaveAttribute(
      "href",
      USER_GUIDE_URL
    );
  });

  it("keeps the nav links in the menu below lg so the bar never overflows (#229)", async () => {
    renderLayout();
    const menuButton = screen.getByRole("button", { name: "Open main menu" });
    expect(menuButton).toHaveClass("lg:hidden");
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    const desktopLinks = screen.getByRole("link", { name: "Categories" }).parentElement;
    expect(desktopLinks).toHaveClass("hidden", "lg:flex");
    expect(desktopLinks).not.toHaveClass("sm:flex");

    await userEvent.click(menuButton);

    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link", { name: "Sign In" })).toHaveLength(2);
  });

  it("shows the ideas footer link instead of the old map action", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Ideas" })).toHaveAttribute(
      "href",
      "/ideas"
    );
    expect(screen.queryByRole("button", { name: "Map" })).not.toBeInTheDocument();
  });

  it("applies a fallback title for routes without a page-specific SEO component", async () => {
    renderLayout(["/study-guides/documents"]);

    await waitFor(() => {
      expect(document.title).toBe("My Study Guides | Quizymode");
    });
  });
});
