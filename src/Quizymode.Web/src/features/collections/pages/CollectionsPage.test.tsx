import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CollectionsPage from "./CollectionsPage";

const mockGetAll = vi.fn();
const mockDiscover = vi.fn();
const mockGetBookmarks = vi.fn();
const mockGetSettings = vi.fn();
const mockGetAllItems = vi.fn();
const mockUpdate = vi.fn();
const mockGetById = vi.fn();

vi.mock("@/api/collections", () => ({
  collectionsApi: {
    getAll: () => mockGetAll(),
    discover: (opts: unknown) => mockDiscover(opts),
    getBookmarks: () => mockGetBookmarks(),
    getBookmarkedBy: vi.fn().mockResolvedValue({ users: [] }),
    getById: (id: string) => mockGetById(id),
    getRating: vi.fn().mockResolvedValue({ averageStars: null, count: 0 }),
    create: vi.fn(),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: vi.fn(),
    bookmark: vi.fn(),
    unbookmark: vi.fn(),
    setRating: vi.fn(),
    bulkAddItems: vi.fn(),
  },
}));

vi.mock("@/api/categories", () => ({
  categoriesApi: {
    getAll: vi.fn().mockResolvedValue({ categories: [] }),
  },
}));

vi.mock("@/api/keywords", () => ({
  keywordsApi: {
    getAll: vi.fn().mockResolvedValue({ keywords: [] }),
  },
}));

vi.mock("@/api/items", () => ({
  itemsApi: {
    getAll: (...args: unknown[]) => mockGetAllItems(...args),
  },
}));

vi.mock("@/api/users", () => ({
  usersApi: {
    getSettings: () => mockGetSettings(),
    updateSetting: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/useActiveCollection", () => ({
  useActiveCollection: () => ({
    activeCollectionId: null,
    activeCollection: null,
    setActiveCollectionId: vi.fn(),
    isUpdating: false,
    collections: [],
  }),
}));

vi.mock("@/components/LoadingSpinner", () => ({ default: () => <div>Loading...</div> }));
vi.mock("@/components/ErrorMessage", () => ({
  default: ({ message }: { message: string }) => <div>{message}</div>,
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));

const mockUseAuth = vi.fn();

function renderPage(initialRoute = "/collections") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <CollectionsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("CollectionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBookmarks.mockResolvedValue({ collections: [] });
    mockDiscover.mockResolvedValue({ collections: [], total: 0, page: 1, pageSize: 10 });
    mockGetSettings.mockResolvedValue({ settings: {} });
  });

  it("renders the page with My Collections tab active by default for authenticated users", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, userId: "u1", isAdmin: false });
    mockGetAll.mockResolvedValue({ collections: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^mine$/i })).toBeInTheDocument();
    });
  });

  it("shows empty state message when user has no collections", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, userId: "u1", isAdmin: false });
    mockGetAll.mockResolvedValue({ collections: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });
  });

  it("shows collections when user has some", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, userId: "u1", isAdmin: false });
    mockGetAll.mockResolvedValue({
      collections: [
        {
          id: "c1", name: "My AWS Collection", description: "AWS study",
          isPublic: false, itemCount: 5, createdBy: "u1", createdAt: "2024-01-01T00:00:00Z"
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("My AWS Collection")).toBeInTheDocument();
    });
  });

  it("edits link access and Discover listing together in the edit modal", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, userId: "u1", isAdmin: false });
    mockUpdate.mockResolvedValue({});
    mockGetAll.mockResolvedValue({
      collections: [
        {
          id: "c1", name: "Shared Set", description: null, isPublic: true, isDiscoverable: true,
          itemCount: 2, createdBy: "u1", createdAt: "2024-01-01T00:00:00Z",
        },
      ],
    });

    renderPage();

    fireEvent.click(await screen.findByTitle("Edit collection"));
    const linkAccess = screen.getByLabelText(/anyone with the link can view/i);
    const discover = screen.getByLabelText(/list in discover/i);
    expect(linkAccess).toBeChecked();
    expect(discover).toBeChecked();

    fireEvent.click(linkAccess);
    expect(discover).not.toBeChecked();
    expect(discover).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^save/i }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("c1", {
        name: "Shared Set",
        description: null,
        isPublic: false,
        isDiscoverable: false,
      })
    );
  });

  it("renders Discover tab", async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, userId: null, isAdmin: false });
    mockGetAll.mockResolvedValue({ collections: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /discover/i })).toBeInTheDocument();
    });
  });

  it("lets a guest bookmark a public collection in this browser and see it under Bookmarked (AC 1.15.2, 1.15.3)", async () => {
    window.localStorage.clear();
    mockUseAuth.mockReturnValue({ isAuthenticated: false, userId: null, isAdmin: false });
    mockGetAll.mockResolvedValue({ collections: [] });
    const publicId = "00000000-0000-4000-8000-00000000000d";
    mockDiscover.mockResolvedValue({
      items: [{ id: publicId, name: "Public Set", itemCount: 4, createdBy: "someone", createdAt: "2024-01-01T00:00:00Z", isBookmarked: false, averageStars: null, ratingCount: 0 }],
      total: 1, page: 1, pageSize: 10,
    });
    mockGetById.mockResolvedValue({ id: publicId, name: "Public Set", itemCount: 4, createdBy: "someone", createdAt: "2024-01-01T00:00:00Z" });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^discover$/i }));
    fireEvent.click(await screen.findByTitle("Bookmark collection"));
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("quizymode.bookmarks.v1") ?? "{}").collections).toEqual([publicId]);
    });

    const bookmarkedTab = screen.getByRole("button", { name: /^bookmarked$/i });
    expect(bookmarkedTab).toBeEnabled();
    fireEvent.click(bookmarkedTab);
    expect(await screen.findByText("Public Set")).toBeInTheDocument();
    expect(mockGetById).toHaveBeenCalledWith(publicId);
    expect(mockGetBookmarks).not.toHaveBeenCalled();
  });
});
