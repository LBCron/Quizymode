import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collectionsApi } from "@/api/collections";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useActiveCollection } from "@/hooks/useActiveCollection";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import {
  TrashIcon,
  ListBulletIcon,
  EyeIcon,
  AcademicCapIcon,
  BookmarkIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  LinkIcon,
  CircleStackIcon,
  StarIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import { BookmarkIcon as BookmarkIconSolid, CheckCircleIcon as CheckCircleIconSolid } from "@heroicons/react/24/solid";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { SEO } from "@/components/SEO";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import type {
  CollectionDiscoverItem,
  CollectionRatingResponse,
  CollectionResponse,
  CreateCollectionRequest,
} from "@/types/api";
import { SignupPrompt } from "@/features/auth/components/SignupPrompt";
import {
  GUEST_BOOKMARKS_CHANGED_EVENT,
  addLocalBookmark,
  readLocalBookmarks,
  removeLocalBookmark,
} from "@/features/collections/localBookmarks";

type TabId = "mine" | "bookmarked" | "discover";

interface CollectionCardProps {
  id: string;
  name: string;
  description?: string | null;
  isPublic?: boolean;
  isDiscoverable?: boolean;
  itemCount: number;
  createdAt: string;
  createdBy?: string;
  isOwner?: boolean;
  isBookmarked?: boolean;
  selectedCollectionId?: string | null;
  activeCollectionId?: string | null;
  cardRef?: React.RefObject<HTMLDivElement | null>;
  onBookmark?: (id: string) => void;
  onUnbookmark?: (id: string) => void;
  onDelete?: (id: string, name: string) => void;
  onEdit?: (id: string, payload: { name: string; description: string | null; isPublic: boolean; isDiscoverable: boolean }) => void;
  onSetActive?: (id: string) => void;
  onCopyLink?: (id: string, name: string, isPublic: boolean) => void;
  onSelect?: (id: string) => void;
  isBookmarkPending?: boolean;
  isDeletePending?: boolean;
  isEditPending?: boolean;
  showRating?: boolean;
  /** When true, show average rating only (no submit). Use for anonymous users. */
  readOnlyRating?: boolean;
  onRate?: (id: string, stars: number) => void;
}

function CollectionCard({
  id,
  name,
  description,
  isPublic,
  isDiscoverable,
  itemCount,
  createdAt,
  createdBy,
  isOwner,
  isBookmarked,
  selectedCollectionId,
  activeCollectionId,
  cardRef,
  onBookmark,
  onUnbookmark,
  onDelete,
  onEdit,
  onSetActive,
  onCopyLink,
  onSelect,
  isBookmarkPending,
  isDeletePending,
  isEditPending,
  showRating,
  readOnlyRating,
  onRate,
}: CollectionCardProps) {
  const isActive = activeCollectionId === id;
  const queryClient = useQueryClient();
  const collectionPath = buildCollectionPath(id, name);
  const explorePath = buildCollectionStudyPath("explore", id, name);
  const quizPath = buildCollectionStudyPath("quiz", id, name);

  const { data: ratingData } = useQuery({
    queryKey: ["collectionRating", id],
    queryFn: () => collectionsApi.getRating(id),
    enabled: !!showRating,
  });

  const setRatingMutation = useMutation({
    mutationFn: (stars: number) => collectionsApi.setRating(id, stars),
    onMutate: async (stars) => {
      await queryClient.cancelQueries({ queryKey: ["collectionRating", id] });
      const previous = queryClient.getQueryData<CollectionRatingResponse>(["collectionRating", id]);
      queryClient.setQueryData<CollectionRatingResponse>(["collectionRating", id], (old) => {
        if (!old) return { count: 1, averageStars: stars, myStars: stars };
        const newCount = old.myStars == null ? old.count + 1 : old.count;
        const newAvg =
          old.averageStars != null && old.count > 0
            ? old.myStars != null
              ? (old.averageStars * old.count - old.myStars + stars) / old.count
              : (old.averageStars * old.count + stars) / newCount
            : stars;
        return {
          count: newCount,
          averageStars: Math.round(newAvg * 100) / 100,
          myStars: stars,
        };
      });
      return { previous };
    },
    onError: (_err, _stars, context) => {
      if (context?.previous != null) {
        queryClient.setQueryData(["collectionRating", id], context.previous);
      } else {
        queryClient.invalidateQueries({ queryKey: ["collectionRating", id] });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["collectionRating", id] });
    },
  });

  const titleArea = (
    <>
      <h3 className="text-lg font-semibold text-on-panel">{name}</h3>
      <p className="mt-2 text-sm text-on-panel-muted">
        {itemCount} {itemCount === 1 ? "item" : "items"}
      </p>
      {description && description.trim() !== "" && (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
          {description}
        </p>
      )}
      {createdBy && (
        <p className="mt-1 text-xs font-medium text-slate-400">By {createdBy}</p>
      )}
      <p className="mt-1 text-sm text-slate-400">
        Created {new Date(createdAt).toLocaleDateString()}
      </p>
    </>
  );

  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-2xl border border-on-panel/10 bg-panel-raised/60 p-6 shadow-sm shadow-slate-950/30 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-on-panel/20 ${
        selectedCollectionId === id ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900" : ""
      }`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1 min-w-0">
          {onSelect ? (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(id); }}
              className="text-left w-full hover:opacity-90 focus:outline-none focus:ring-0"
            >
              {titleArea}
            </button>
          ) : (
            <Link to={collectionPath} className="block">
              {titleArea}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-wrap justify-end">
          {isOwner && onEdit && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(id, {
                  name,
                  description: description ?? null,
                  isPublic: isPublic ?? false,
                  isDiscoverable: isDiscoverable ?? false,
                });
              }}
              disabled={isEditPending}
              className="rounded-md p-2 text-slate-400 hover:bg-on-panel/10 hover:text-on-panel-muted disabled:opacity-50"
              title="Edit collection"
            >
              <PencilSquareIcon className="h-5 w-5" />
            </button>
          )}
          {isOwner && onSetActive && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSetActive(id);
              }}
              disabled={isEditPending}
              className={`p-2 rounded-md disabled:opacity-50 ${
                isActive
                  ? "text-indigo-400 bg-indigo-500/20"
                  : "text-slate-400 hover:bg-on-panel/10 hover:text-on-panel-muted"
              }`}
              title={isActive ? "Active collection" : "Set as active collection"}
            >
              {isActive ? (
                <CheckCircleIconSolid className="h-5 w-5" />
              ) : (
                <CircleStackIcon className="h-5 w-5" />
              )}
            </button>
          )}
          {isOwner && onCopyLink && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCopyLink(id, name, isPublic ?? false);
              }}
              className="rounded-md p-2 text-slate-400 hover:bg-on-panel/10 hover:text-blue-ink"
              title="Copy shared link"
            >
              <LinkIcon className="h-5 w-5" />
            </button>
          )}
          {isOwner && onDelete && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(id, name);
              }}
              disabled={isDeletePending}
              className="p-2 text-red-400 hover:text-red-ink hover:bg-red-500/15 rounded-md disabled:opacity-50"
              title="Delete collection"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          )}
          {!isOwner && isBookmarked && onUnbookmark && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onUnbookmark(id);
              }}
              disabled={isBookmarkPending}
              className="p-2 text-amber-400 hover:bg-amber-500/15 rounded-md disabled:opacity-50"
              title="Remove bookmark"
            >
              <BookmarkIconSolid className="h-5 w-5" />
            </button>
          )}
          {!isOwner && !isBookmarked && onBookmark && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBookmark(id);
              }}
              disabled={isBookmarkPending}
              className="rounded-md p-2 text-slate-400 hover:bg-amber-500/15 hover:text-amber-ink disabled:opacity-50"
              title="Bookmark collection"
            >
              <BookmarkIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
      {showRating && readOnlyRating && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-on-panel/10 pt-3">
          <span className="text-sm font-medium text-on-panel-muted">Rating</span>
          <div className="flex items-center gap-0.5" aria-hidden>
            {[1, 2, 3, 4, 5].map((star) => {
              const avg = ratingData?.averageStars;
              const filled = avg != null && star <= Math.round(avg);
              return filled ? (
                <span key={star} className="p-0.5" title="Sign in to rate this collection.">
                  <StarIconSolid className="h-5 w-5 text-amber-500" />
                </span>
              ) : (
                <span key={star} className="p-0.5" title="Sign in to rate this collection.">
                  <StarIcon className="h-5 w-5 text-on-panel-muted" />
                </span>
              );
            })}
          </div>
          <span className="text-xs text-slate-400">
            {ratingData?.averageStars != null
              ? `${ratingData.averageStars} (${ratingData.count})`
              : "No ratings yet"}
          </span>
        </div>
      )}
      {showRating && !readOnlyRating && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-on-panel/10 pt-3">
          <span className="text-sm font-medium text-on-panel-muted">Rating</span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRatingMutation.mutate(star);
                  onRate?.(id, star);
                }}
                disabled={setRatingMutation.isPending}
                className="rounded p-0.5 hover:bg-on-panel/10 disabled:opacity-50"
                title={`Rate ${star} star${star > 1 ? "s" : ""}`}
              >
                {ratingData?.myStars != null && star <= ratingData.myStars ? (
                  <StarIconSolid className="h-5 w-5 text-amber-500" />
                ) : (
                  <StarIcon className="h-5 w-5 text-on-panel-muted" />
                )}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">
            {ratingData?.averageStars != null
              ? `${ratingData.averageStars} (${ratingData.count})`
              : "No ratings yet"}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-4">
        <Link
          to={collectionPath}
          className="flex items-center rounded-md bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-ink hover:bg-blue-500/25"
          onClick={(e) => e.stopPropagation()}
        >
          <ListBulletIcon className="h-4 w-4 mr-1" />
          List
        </Link>
        <Link
          to={explorePath}
          className="flex items-center rounded-md bg-indigo-500/15 px-3 py-2 text-sm font-medium text-on-panel-muted hover:bg-indigo-500/25"
          onClick={(e) => e.stopPropagation()}
        >
          <EyeIcon className="h-4 w-4 mr-1" />
          Flashcards
        </Link>
        <Link
          to={quizPath}
          className="flex items-center rounded-md bg-green-500/15 px-3 py-2 text-sm font-medium text-green-ink hover:bg-green-500/25"
          onClick={(e) => e.stopPropagation()}
        >
          <AcademicCapIcon className="h-4 w-4 mr-1" />
          Quiz
        </Link>
      </div>
    </div>
  );
}

const CollectionsPage = () => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const currentUserId = useCurrentUserId();
  const queryClient = useQueryClient();
  const { activeCollectionId, setActiveCollectionId } = useActiveCollection();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [createCollectionDescription, setCreateCollectionDescription] = useState("");
  const [createCollectionIsPublic, setCreateCollectionIsPublic] = useState(false);
  const [createCollectionIsDiscoverable, setCreateCollectionIsDiscoverable] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingIsPublic, setEditingIsPublic] = useState(false);
  const [editingIsDiscoverable, setEditingIsDiscoverable] = useState(false);
  const [copyLinkWarning, setCopyLinkWarning] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam && ["mine", "bookmarked", "discover"].includes(tabParam) ? tabParam : "mine");
  // Anonymous visitors keep bookmarks in this browser (#503, AC 1.15.1); signed-in mode never reads them.
  const [guestBookmarkIds, setGuestBookmarkIds] = useState<string[]>(() => readLocalBookmarks());
  const [guestBookmarkNotice, setGuestBookmarkNotice] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setGuestBookmarkIds(readLocalBookmarks());
    window.addEventListener(GUEST_BOOKMARKS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(GUEST_BOOKMARKS_CHANGED_EVENT, refresh);
  }, []);
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverPage, setDiscoverPage] = useState(1);
  const [discoverCategory, setDiscoverCategory] = useState("");
  const [discoverNav1, setDiscoverNav1] = useState("");
  const [discoverNav2, setDiscoverNav2] = useState("");
  const [discoverTags, setDiscoverTags] = useState("");
  const [collectionIdInput, setCollectionIdInput] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (tabParam && ["mine", "bookmarked", "discover"].includes(tabParam)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(tabParam as TabId);
    }
  }, [tabParam]);

  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    if (activeTab === "mine") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab("discover");
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "discover");
        return next;
      });
    }
  }, [authLoading, isAuthenticated, activeTab, setSearchParams]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!discoverNav1.trim()) setDiscoverNav2("");
  }, [discoverNav1]);

  const setTab = (tab: TabId) => {
    if (!isAuthenticated && tab === "mine") return;
    setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });
  };

  const discoverKeywordsParam = useMemo(() => {
    if (!discoverCategory.trim()) return undefined;
    const k1 = discoverNav1.trim();
    const k2 = discoverNav2.trim();
    if (k2) return `${k1},${k2}`;
    if (k1) return k1;
    return undefined;
  }, [discoverCategory, discoverNav1, discoverNav2]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: () => collectionsApi.getAll(),
    enabled: isAuthenticated && !authLoading,
    retry: false,
  });

  const { data: bookmarksData } = useQuery({
    queryKey: ["collections", "bookmarks"],
    queryFn: () => collectionsApi.getBookmarks(),
    enabled: isAuthenticated && !authLoading && activeTab === "bookmarked",
  });

  // Guest bookmarks (AC 1.15.3): each stored id is re-read through the public GET; unavailable ones (private, deleted) drop out.
  const { data: guestBookmarksData } = useQuery({
    queryKey: ["collections", "guest-bookmarks", guestBookmarkIds],
    queryFn: async (): Promise<CollectionResponse[]> => {
      const results = await Promise.all(guestBookmarkIds.map((id) => collectionsApi.getById(id).catch(() => null)));
      return results.filter((c): c is CollectionResponse => c !== null);
    },
    enabled: !isAuthenticated && !authLoading && activeTab === "bookmarked" && guestBookmarkIds.length > 0,
  });

  const bookmarkAsGuest = (id: string) => {
    const result = addLocalBookmark(id);
    setGuestBookmarkNotice(
      result === "limit"
        ? "This browser holds up to 50 bookmarks. Sign in to bookmark more."
        : result === "storage"
          ? "Could not save this bookmark in this browser."
          : null,
    );
  };

  const unbookmarkAsGuest = (id: string) => {
    if (!removeLocalBookmark(id)) setGuestBookmarkNotice("Could not update bookmarks in this browser.");
  };

  const { data: discoverCategoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: activeTab === "discover",
  });

  const { data: discoverRank1Data, isLoading: discoverRank1Loading } = useQuery({
    queryKey: ["keywords", "rank1", "discover", discoverCategory],
    queryFn: () => keywordsApi.getNavigationKeywords(discoverCategory, []),
    enabled: activeTab === "discover" && !!discoverCategory.trim(),
  });

  const { data: discoverRank2Data, isLoading: discoverRank2Loading } = useQuery({
    queryKey: ["keywords", "rank2", "discover", discoverCategory, discoverNav1],
    queryFn: () => keywordsApi.getNavigationKeywords(discoverCategory, [discoverNav1]),
    enabled:
      activeTab === "discover" && !!discoverCategory.trim() && !!discoverNav1.trim(),
  });

  const { data: discoverData, isLoading: discoverLoading } = useQuery({
    queryKey: [
      "collections",
      "discover",
      discoverQuery,
      discoverPage,
      discoverCategory,
      discoverKeywordsParam,
      discoverTags,
    ],
    queryFn: () =>
      collectionsApi.discover({
        q: discoverQuery || undefined,
        page: discoverPage,
        pageSize: 12,
        category: discoverCategory.trim() || undefined,
        keywords: discoverKeywordsParam,
        tags: discoverTags.trim() || undefined,
      }),
    enabled: activeTab === "discover",
  });

  const discoverRank1Options = useMemo(
    () =>
      (discoverRank1Data?.keywords ?? []).filter((k) => k.name.toLowerCase() !== "other"),
    [discoverRank1Data]
  );

  const discoverRank2Options = useMemo(
    () =>
      (discoverRank2Data?.keywords ?? []).filter((k) => k.name.toLowerCase() !== "other"),
    [discoverRank2Data]
  );

  const sortedDiscoverCategories = useMemo(
    () =>
      [...(discoverCategoriesData?.categories ?? [])].sort((a, b) =>
        a.category.localeCompare(b.category)
      ),
    [discoverCategoriesData]
  );

  const clearDiscoverFilters = () => {
    setDiscoverCategory("");
    setDiscoverNav1("");
    setDiscoverNav2("");
    setDiscoverTags("");
    setDiscoverPage(1);
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateCollectionRequest) => collectionsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      setShowCreateModal(false);
      setCollectionName("");
      setCreateCollectionDescription("");
      setCreateCollectionIsPublic(false);
      setCreateCollectionIsDiscoverable(false);
    },
    onError: (err: unknown) => console.error("Failed to create collection:", err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { name?: string; description?: string | null; isPublic?: boolean; isDiscoverable?: boolean } }) =>
      collectionsApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      setEditingCollectionId(null);
    },
    onError: (err: unknown) => console.error("Failed to update collection:", err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => collectionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err: unknown) => console.error("Failed to delete collection:", err),
  });

  const bookmarkMutation = useMutation({
    mutationFn: (id: string) => collectionsApi.bookmark(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["collections", "bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["collections", "discover"] });
    },
    onError: (err: unknown) => console.error("Failed to bookmark:", err),
  });

  const unbookmarkMutation = useMutation({
    mutationFn: (id: string) => collectionsApi.unbookmark(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["collections", "bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["collections", "discover"] });
    },
    onError: (err: unknown) => console.error("Failed to remove bookmark:", err),
  });

  const handleDeleteCollection = (collectionId: string, collectionName: string) => {
    if (window.confirm(`Are you sure you want to delete "${collectionName}"? This action cannot be undone.`)) {
      deleteMutation.mutate(collectionId);
    }
  };

  const handleOpenCollectionById = () => {
    const id = collectionIdInput.trim();
    if (!id) return;
    const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (guidRegex.test(id)) {
      navigate(buildCollectionPath(id));
    } else {
      window.alert("Please enter a valid collection ID (GUID format).");
    }
  };

  const handleOpenEdit = (
    id: string,
    payload: { name: string; description: string | null; isPublic: boolean; isDiscoverable: boolean }
  ) => {
    setEditingCollectionId(id);
    setEditingName(payload.name);
    setEditingDescription(payload.description ?? "");
    setEditingIsPublic(payload.isPublic);
    setEditingIsDiscoverable(payload.isPublic && payload.isDiscoverable);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCollectionId || !editingName.trim()) return;
    updateMutation.mutate({
      id: editingCollectionId,
      payload: {
        name: editingName.trim(),
        description: editingDescription.trim() || null,
        isPublic: editingIsPublic,
        isDiscoverable: editingIsPublic && editingIsDiscoverable,
      },
    });
  };

  const handleCopyLink = (collectionId: string, collectionName: string, isPublic: boolean) => {
    const url = `${window.location.origin}${buildCollectionPath(collectionId, collectionName)}`;
    void navigator.clipboard.writeText(url).then(() => {
      if (!isPublic) {
        setCopyLinkWarning("Collection is private. Others cannot open this link until you turn on “Anyone with the link can view” (Edit).");
        setTimeout(() => setCopyLinkWarning(null), 6000);
      }
    });
  };

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (collectionName.trim()) {
      createMutation.mutate({
        name: collectionName.trim(),
        description: createCollectionDescription.trim() || undefined,
        isPublic: createCollectionIsPublic,
        isDiscoverable: createCollectionIsPublic && createCollectionIsDiscoverable,
      });
    }
  };

  const myCollections = data?.collections ?? [];
  const bookmarkedCollections = isAuthenticated ? (bookmarksData?.collections ?? []) : (guestBookmarksData ?? []);
  const discoverItems = discoverData?.items ?? [];
  const discoverTotal = discoverData?.totalCount ?? 0;
  const discoverHasActiveFilters =
    !!discoverQuery.trim() ||
    !!discoverCategory.trim() ||
    !!discoverNav1.trim() ||
    !!discoverNav2.trim() ||
    !!discoverTags.trim();

  if (authLoading) return <LoadingSpinner />;

  if (activeTab === "mine" && isLoading) return <LoadingSpinner />;
  if (activeTab === "mine" && error) {
    return (
      <ErrorMessage
        message="Failed to load collections"
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <>
      <SEO
        title={activeTab === "discover" ? "Collections" : activeTab === "bookmarked" ? "Bookmarked Collections" : "My Collections"}
        description="Browse public study collections on Quizymode, open shared sets by topic, and switch into list, flashcard, or quiz modes."
        canonical="https://www.quizymode.com/collections"
        noindex={activeTab !== "discover"}
      />
      <div className="bg-panel-deep text-on-panel">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 space-y-4">
        <div className="rounded-[24px] border border-on-panel/10 bg-panel-deep/70 px-5 py-4 shadow-sm shadow-slate-950/25">
          <h1 className="mb-1 text-2xl font-semibold text-on-panel">Collections</h1>
          <p className="max-w-3xl text-sm leading-6 text-on-panel-muted">
            {isAuthenticated
              ? "Your collections, bookmarks, and discover public collections. You can also open a collection by ID."
              : "Browse public collections by topic or search. Sign in to manage your own collections and bookmarks. You can open a collection by ID."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex overflow-hidden rounded-xl border border-on-panel/15 bg-panel-raised/50 shadow-sm">
            {(["mine", "bookmarked", "discover"] as const).map((tab) => {
              const locked = !isAuthenticated && tab === "mine";
              return (
                <button
                  key={tab}
                  type="button"
                  disabled={locked}
                  title={locked ? "Sign in to use this tab" : undefined}
                  onClick={() => setTab(tab)}
                  className={`px-4 py-2 text-sm font-medium capitalize ${
                    activeTab === tab
                      ? "bg-indigo-700 text-white"
                      : locked
                        ? "cursor-not-allowed bg-on-panel/5 text-slate-500"
                        : "bg-transparent text-on-panel-muted hover:bg-on-panel/10"
                  }`}
                >
                  {tab === "mine" ? "Mine" : tab === "bookmarked" ? "Bookmarked" : "Discover"}
                </button>
              );
            })}
          </div>
          {activeTab === "mine" && isAuthenticated && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
            >
              Create Collection
            </button>
          )}
        </div>

      {copyLinkWarning && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span>{copyLinkWarning}</span>
          <button type="button" onClick={() => setCopyLinkWarning(null)} className="text-amber-600 hover:text-amber-800 font-medium">Dismiss</button>
        </div>
      )}

      {activeTab === "discover" && (
        <div className="space-y-4 rounded-[28px] border border-on-panel/10 bg-panel/70 p-5 shadow-sm shadow-slate-950/25">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  placeholder="Search public collections..."
                  value={discoverQuery}
                  onChange={(e) => {
                    setDiscoverQuery(e.target.value);
                    setDiscoverPage(1);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setDiscoverPage(1)}
                  className="w-full rounded-md border border-on-panel/15 bg-panel-raised/50 px-3 py-2 pl-10 text-sm text-on-panel placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={() => setDiscoverPage(1)}
                className="rounded-md bg-on-panel/10 px-3 py-2 text-sm text-on-panel hover:bg-on-panel/15"
              >
                Search
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Collection ID (e.g. from link)"
                value={collectionIdInput}
                onChange={(e) => setCollectionIdInput(e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && handleOpenCollectionById()}
                className="min-w-[240px] rounded-md border border-on-panel/15 bg-panel-raised/50 px-3 py-2 font-mono text-sm text-on-panel placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleOpenCollectionById}
                className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
              >
                Open by ID
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-on-panel/10 bg-panel-raised/40 p-4">
            <div>
              <label htmlFor="discover-category" className="mb-1 block text-xs font-medium text-on-panel-muted">
                Category
              </label>
              <select
                id="discover-category"
                value={discoverCategory}
                onChange={(e) => {
                  setDiscoverCategory(e.target.value);
                  setDiscoverNav1("");
                  setDiscoverNav2("");
                  setDiscoverPage(1);
                }}
                className="min-w-[160px] rounded-md border border-on-panel/15 bg-panel-raised/50 px-2 py-2 text-sm text-on-panel focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All categories</option>
                {sortedDiscoverCategories.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="discover-nav1" className="mb-1 block text-xs font-medium text-on-panel-muted">
                Topic (L1)
              </label>
              <select
                id="discover-nav1"
                value={discoverNav1}
                disabled={!discoverCategory.trim() || discoverRank1Loading}
                onChange={(e) => {
                  setDiscoverNav1(e.target.value);
                  setDiscoverNav2("");
                  setDiscoverPage(1);
                }}
                className="min-w-[140px] rounded-md border border-on-panel/15 bg-panel-raised/50 px-2 py-2 text-sm text-on-panel focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">Any</option>
                {discoverRank1Options.map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="discover-nav2" className="mb-1 block text-xs font-medium text-on-panel-muted">
                Subtopic (L2)
              </label>
              <select
                id="discover-nav2"
                value={discoverNav2}
                disabled={!discoverNav1.trim() || discoverRank2Loading}
                onChange={(e) => {
                  setDiscoverNav2(e.target.value);
                  setDiscoverPage(1);
                }}
                className="min-w-[140px] rounded-md border border-on-panel/15 bg-panel-raised/50 px-2 py-2 text-sm text-on-panel focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">Any</option>
                {discoverRank2Options.map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[180px] max-w-xs">
              <label htmlFor="discover-tags" className="mb-1 block text-xs font-medium text-on-panel-muted">
                Item tags
              </label>
              <input
                id="discover-tags"
                type="text"
                placeholder="e.g. s3, ec2"
                value={discoverTags}
                onChange={(e) => {
                  setDiscoverTags(e.target.value);
                  setDiscoverPage(1);
                }}
                className="w-full rounded-md border border-on-panel/15 bg-panel-raised/50 px-2 py-2 text-sm text-on-panel placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="button"
              onClick={clearDiscoverFilters}
              className="rounded-md border border-on-panel/15 px-3 py-2 text-sm text-on-panel-muted hover:bg-on-panel/10"
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50"
          onClick={() => {
            if (!createMutation.isPending) {
              setShowCreateModal(false);
              setCollectionName("");
              setCreateCollectionDescription("");
              setCreateCollectionIsPublic(false);
            }
          }}
        >
          <div
            className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Create New Collection</h3>
              <form onSubmit={handleCreateCollection}>
                <div className="mb-4">
                  <label htmlFor="collection-name" className="block text-sm font-medium text-gray-700 mb-2">
                    Collection Name
                  </label>
                  <input
                    id="collection-name"
                    type="text"
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    placeholder="Enter collection name"
                    required
                    maxLength={200}
                    className="w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                </div>
                <div className="mb-4">
                  <label htmlFor="collection-description" className="block text-sm font-medium text-gray-700 mb-2">
                    Description (optional, helps find it in search)
                  </label>
                  <textarea
                    id="collection-description"
                    value={createCollectionDescription}
                    onChange={(e) => setCreateCollectionDescription(e.target.value)}
                    placeholder="e.g. Biology chapter 5 practice set"
                    rows={2}
                    maxLength={2000}
                    className="w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="mb-4 flex items-center">
                  <input
                    id="collection-is-public"
                    type="checkbox"
                    checked={createCollectionIsPublic}
                    onChange={(e) => {
                      setCreateCollectionIsPublic(e.target.checked);
                      if (!e.target.checked) setCreateCollectionIsDiscoverable(false);
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-ink focus:ring-indigo-500"
                  />
                  <label htmlFor="collection-is-public" className="ml-2 block text-sm text-gray-700">
                    Anyone with the link can view (and quiz, without signing in)
                  </label>
                </div>
                <div className="mb-4 flex items-center">
                  <input
                    id="collection-is-discoverable"
                    type="checkbox"
                    checked={createCollectionIsPublic && createCollectionIsDiscoverable}
                    disabled={!createCollectionIsPublic}
                    onChange={(e) => setCreateCollectionIsDiscoverable(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-ink focus:ring-indigo-500 disabled:opacity-50"
                  />
                  <label
                    htmlFor="collection-is-discoverable"
                    className={`ml-2 block text-sm ${createCollectionIsPublic ? "text-gray-700" : "text-gray-400"}`}
                  >
                    List in Discover (anyone can find it in search)
                  </label>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => { setShowCreateModal(false); setCollectionName(""); setCreateCollectionDescription(""); setCreateCollectionIsPublic(false); setCreateCollectionIsDiscoverable(false); }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
                    disabled={createMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending || !collectionName.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createMutation.isPending ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
              {createMutation.isError && (
                <div className="mt-3 text-sm text-red-600">Failed to create collection. Please try again.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {editingCollectionId && (
        <div
          className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50"
          onClick={() => {
            if (!updateMutation.isPending) {
              setEditingCollectionId(null);
            }
          }}
        >
          <div
            className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Edit Collection</h3>
              <form onSubmit={handleSaveEdit}>
                <div className="mb-4">
                  <label htmlFor="edit-collection-name" className="block text-sm font-medium text-gray-700 mb-2">
                    Name
                  </label>
                  <input
                    id="edit-collection-name"
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    placeholder="Collection name"
                    required
                    maxLength={200}
                    className="w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    autoFocus
                  />
                </div>
                <div className="mb-4">
                  <label htmlFor="edit-collection-description" className="block text-sm font-medium text-gray-700 mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    id="edit-collection-description"
                    value={editingDescription}
                    onChange={(e) => setEditingDescription(e.target.value)}
                    placeholder="e.g. Biology chapter 5 practice set"
                    rows={2}
                    maxLength={2000}
                    className="w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="mb-4 flex items-center">
                  <input
                    id="edit-collection-is-public"
                    type="checkbox"
                    checked={editingIsPublic}
                    onChange={(e) => {
                      setEditingIsPublic(e.target.checked);
                      if (!e.target.checked) setEditingIsDiscoverable(false);
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-ink focus:ring-indigo-500"
                  />
                  <label htmlFor="edit-collection-is-public" className="ml-2 block text-sm text-gray-700">
                    Anyone with the link can view (and quiz, without signing in)
                  </label>
                </div>
                <div className="mb-4 flex items-center">
                  <input
                    id="edit-collection-is-discoverable"
                    type="checkbox"
                    checked={editingIsPublic && editingIsDiscoverable}
                    disabled={!editingIsPublic}
                    onChange={(e) => setEditingIsDiscoverable(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-ink focus:ring-indigo-500 disabled:opacity-50"
                  />
                  <label
                    htmlFor="edit-collection-is-discoverable"
                    className={`ml-2 block text-sm ${editingIsPublic ? "text-gray-700" : "text-gray-400"}`}
                  >
                    List in Discover (anyone can find it in search)
                  </label>
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setEditingCollectionId(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
                    disabled={updateMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateMutation.isPending || !editingName.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
              {updateMutation.isError && (
                <div className="mt-3 text-sm text-red-600">Failed to update collection. Please try again.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "mine" && (
        myCollections.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myCollections.map((c) => (
              <CollectionCard
                key={c.id}
                id={c.id}
                name={c.name}
                description={c.description}
                isPublic={c.isPublic}
                isDiscoverable={c.isDiscoverable}
                itemCount={c.itemCount}
                createdAt={c.createdAt}
                isOwner={true}
                activeCollectionId={activeCollectionId}
                onEdit={handleOpenEdit}
                onSetActive={setActiveCollectionId}
                onCopyLink={handleCopyLink}
                onDelete={handleDeleteCollection}
                isEditPending={updateMutation.isPending}
                isDeletePending={deleteMutation.isPending}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-on-panel/20 bg-panel-raised/30 py-12 text-center">
            <p className="text-on-panel-muted">No collections yet. Create your first collection!</p>
          </div>
        )
      )}

      {!isAuthenticated && (guestBookmarkNotice || (guestBookmarkIds.length > 0 && activeTab !== "mine")) && (
        <div className="mb-4 space-y-3">
          {guestBookmarkNotice && (
            <p role="status" className="text-sm text-on-panel-muted">{guestBookmarkNotice}</p>
          )}
          {guestBookmarkIds.length > 0 && <SignupPrompt reason="keep-collection" />}
        </div>
      )}

      {activeTab === "bookmarked" && (
        bookmarkedCollections.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bookmarkedCollections.map((c) => (
              <CollectionCard
                key={c.id}
                id={c.id}
                name={c.name}
                itemCount={c.itemCount}
                createdAt={c.createdAt}
                createdBy={c.createdBy}
                isOwner={currentUserId ? c.createdBy === currentUserId : false}
                isBookmarked={true}
                onUnbookmark={isAuthenticated ? (id) => unbookmarkMutation.mutate(id) : unbookmarkAsGuest}
                isBookmarkPending={unbookmarkMutation.isPending}
                showRating={true}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-on-panel/20 bg-panel-raised/30 py-12 text-center">
            <p className="text-on-panel-muted">No bookmarked collections. Use Discover to find and bookmark public collections.</p>
          </div>
        )
      )}

      {activeTab === "discover" && (
        <>
          {discoverLoading ? (
            <LoadingSpinner />
          ) : discoverItems.length > 0 ? (
            <>
              <p className="mb-4 text-sm text-on-panel-muted">
                {discoverTotal} public collection{discoverTotal !== 1 ? "s" : ""} found. Make your collection public in its settings to appear here.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {discoverItems.map((c: CollectionDiscoverItem) => (
                  <CollectionCard
                    key={c.id}
                    id={c.id}
                    name={c.name}
                    itemCount={c.itemCount}
                    createdAt={c.createdAt}
                    createdBy={c.createdBy}
                    isOwner={false}
                    isBookmarked={isAuthenticated ? c.isBookmarked : guestBookmarkIds.includes(c.id.toLowerCase())}
                    onBookmark={
                      !isAuthenticated
                        ? bookmarkAsGuest
                        : !c.isBookmarked
                          ? (id) => bookmarkMutation.mutate(id)
                          : undefined
                    }
                    onUnbookmark={
                      !isAuthenticated
                        ? unbookmarkAsGuest
                        : c.isBookmarked
                          ? (id) => unbookmarkMutation.mutate(id)
                          : undefined
                    }
                    isBookmarkPending={bookmarkMutation.isPending || unbookmarkMutation.isPending}
                    showRating={true}
                    readOnlyRating={!isAuthenticated}
                  />
                ))}
              </div>
              {discoverTotal > discoverItems.length && (
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    type="button"
                    disabled={discoverPage <= 1}
                    onClick={() => setDiscoverPage((p) => Math.max(1, p - 1))}
                    className="rounded-md border border-on-panel/20 px-3 py-2 text-sm text-on-panel-muted hover:bg-on-panel/10 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="py-2 text-sm text-on-panel-muted">
                    Page {discoverPage} of {Math.ceil(discoverTotal / 12)}
                  </span>
                  <button
                    type="button"
                    disabled={discoverPage >= Math.ceil(discoverTotal / 12)}
                    onClick={() => setDiscoverPage((p) => p + 1)}
                    className="rounded-md border border-on-panel/20 px-3 py-2 text-sm text-on-panel-muted hover:bg-on-panel/10 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-[28px] border border-dashed border-on-panel/20 bg-panel-raised/30 py-12 text-center">
              <p className="text-on-panel-muted">
                {discoverHasActiveFilters
                  ? "No public collections match your search or filters."
                  : "No public collections yet. Create a collection and make it public to share it."}
              </p>
            </div>
          )}
        </>
      )}
      </div>
      </div>
    </>
  );
};

export default CollectionsPage;
