import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, useSearchParams, Link, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collectionsApi } from "@/api/collections";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import ItemListSection from "@/components/ItemListSection";
import ItemCollectionsModal from "@/components/ItemCollectionsModal";
import { ItemCollectionControls } from "@/components/ItemCollectionControls";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { EyeIcon, EyeSlashIcon, MinusIcon, StarIcon, BookmarkIcon, XMarkIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import { buildCategoryPath, categoryNameToSlug } from "@/utils/categorySlug";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import { usePageSize, PAGE_SIZE_OPTIONS } from "@/hooks/usePageSize";
import { useShowAnswers } from "@/hooks/useShowAnswers";
import { useListenAll } from "@/hooks/useListenAll";
import { SpeakerWaveIcon, PauseIcon } from "@heroicons/react/24/outline";
import { CollectionVisibilityToggles } from "../components/CollectionVisibilityToggles";
import { ShareCollectionButton } from "../components/ShareCollectionButton";
import { CollectionExportControls } from "../components/CollectionExportControls";
import { CollectionPrintView } from "../components/CollectionPrintView";
import { PlanForTestButton } from "@/features/studyPlans/PlanForTestButton";

const CollectionDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") || "list";
  const itemId = searchParams.get("item") || null;
  const { isAuthenticated } = useAuth();
  const currentUserId = useCurrentUserId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [manageCollectionsItemId, setManageCollectionsItemId] = useState<string | null>(null);
  const [itemsPage, setItemsPage] = useState(1);
  const { pageSize, updatePageSize } = usePageSize();
  const showAnswersParam = searchParams.get("showAnswers");
  const showAnswersOverride = showAnswersParam === "true" ? true : showAnswersParam === "false" ? false : undefined;
  const { showAnswers, toggleShowAnswers } = useShowAnswers(showAnswersOverride);
  const [showDetails, setShowDetails] = useState(false);
  const [hideAnswersOnPrint, setHideAnswersOnPrint] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { const done = () => setPrinting(false); window.addEventListener("afterprint", done); return () => window.removeEventListener("afterprint", done); }, []);

  const {
    data: collectionData,
    isLoading: isLoadingCollection,
    error: collectionError,
  } = useQuery({
    queryKey: ["collection", id],
    queryFn: () => collectionsApi.getById(id!),
    enabled: !!id,
  });

  const {
    data: itemsData,
    isLoading: isLoadingItems,
    error: itemsError,
  } = useQuery({
    queryKey: ["collectionItems", id],
    queryFn: () => collectionsApi.getItems(id!),
    enabled: !!id,
  });

  // Unified URL: redirect to explore/quiz routes when view param is set (keeps existing explore/quiz pages)
  useEffect(() => {
    if (!id) return;
    if ((view === "explore" || view === "quiz") && !collectionData?.name) return;
    if (view === "explore") {
      const path = buildCollectionStudyPath("explore", id, collectionData?.name, itemId);
      navigate(path, { replace: true });
    } else if (view === "quiz") {
      const path = buildCollectionStudyPath("quiz", id, collectionData?.name, itemId);
      navigate(path, { replace: true });
    }
  }, [id, view, itemId, navigate, collectionData?.name]);

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => collectionsApi.removeItem(id!, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collectionItems", id] });
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const updateCollectionMutation = useMutation({
    mutationFn: (payload: { name?: string; description?: string | null; isPublic?: boolean; isDiscoverable?: boolean }) =>
      collectionsApi.update(id!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collection", id] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const { data: ratingData } = useQuery({
    queryKey: ["collectionRating", id],
    queryFn: () => collectionsApi.getRating(id!),
    enabled: !!id,
  });

  const setRatingMutation = useMutation({
    mutationFn: (stars: number) => collectionsApi.setRating(id!, stars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collectionRating", id] });
    },
  });

  const isOwner = isAuthenticated && !!currentUserId && collectionData?.createdBy === currentUserId;

  const { data: bookmarkedByData } = useQuery({
    queryKey: ["collectionBookmarkedBy", id],
    queryFn: () => collectionsApi.getBookmarkedBy(id!),
    enabled: !!id && isOwner,
  });
  const allItems = itemsData?.items || [];
  const { listenState: listenAllState, handleButton: handleListenAll, isSupported: ttsSupported } = useListenAll(allItems);

  const totalCount = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (itemsPage - 1) * pageSize;
    return allItems.slice(start, start + pageSize);
  }, [allItems, itemsPage, pageSize]);

  useEffect(() => {
    if (itemsPage > totalPages && totalPages >= 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItemsPage(totalPages);
    }
  }, [itemsPage, totalPages]);

  const handlePageChange = (newPage: number) => {
    setItemsPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleRemoveItem = (itemId: string) => {
    if (
      window.confirm(
        "Are you sure you want to remove this item from the collection?"
      )
    ) {
      removeItemMutation.mutate(itemId);
    }
  };

  const fromFeatured = searchParams.get("from") === "featured";

  const isLoading = isLoadingCollection || isLoadingItems;
  const error = collectionError || itemsError;

  if (isLoading) return <LoadingSpinner />;
  if (error)
    return (
      <ErrorMessage
        message="Failed to load collection"
        onRetry={() => window.location.reload()}
      />
    );

  // Redirecting to explore/quiz routes (unified URL entry)
  if (view === "explore" || view === "quiz") return <LoadingSpinner />;

  const collectionPath = id ? buildCollectionPath(id, collectionData?.name) : undefined;
  const collectionReturnUrl = collectionPath;
  const itemDetailSearch = (() => {
    const params = new URLSearchParams();
    params.set("return", `${location.pathname}${location.search}`);
    return `?${params.toString()}`;
  })();

  return (
    <>
    <div className="space-y-4 print:hidden">
      {fromFeatured && (
        <Link
          to="/featured"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-ink hover:text-indigo-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Back to Featured
        </Link>
      )}
      {allItems.length > 0 && (
        <ScopeSecondaryBar
          scopeType="collection"
          activeMode="list"
          availableModes={["list", "explore", "quiz", "learn", "games"]}
          onModeChange={(mode) => {
            if (!id) return;
            if (mode === "explore") navigate(`${buildCollectionPath(id, collectionData?.name)}?view=explore`);
            else if (mode === "quiz") navigate(`${buildCollectionPath(id, collectionData?.name)}?view=quiz`);
            else if (mode === "learn") navigate(buildCollectionStudyPath("learn", id, collectionData?.name));
            else if (mode === "games") navigate(buildCollectionStudyPath("games", id, collectionData?.name));
          }}
        />
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-slate-200/80 bg-surface/90 p-5 shadow-sm shadow-slate-300/20">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Collection
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <div className="max-w-xs truncate text-lg font-semibold text-slate-900 sm:max-w-sm md:max-w-md">
              {collectionData?.name ?? "Untitled collection"}
            </div>
            {collectionData?.description && collectionData.description.trim() !== "" && (
              <div className="max-w-xs truncate text-sm text-slate-600 sm:max-w-sm md:max-w-lg">
                {collectionData.description}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-slate-600">
            {collectionData?.itemCount ?? totalCount} items
          </div>
          {allItems.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-600">Per page:</label>
              <select
                value={pageSize}
                onChange={(e) => {
                  updatePageSize(parseInt(e.target.value, 10));
                  setItemsPage(1);
                }}
                className="rounded border-slate-300 bg-surface text-sm text-slate-900"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          {collectionData && id && (isOwner || collectionData.isPublic) && (
            <ShareCollectionButton
              url={`${window.location.origin}${buildCollectionPath(id, collectionData.name)}`}
              title={collectionData.name}
              isPublic={collectionData.isPublic ?? false}
            />
          )}
          {collectionData && id && allItems.length > 0 && (
            <PlanForTestButton collectionId={id} collectionName={collectionData.name} />
          )}
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="inline-flex items-center rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Details
          </button>
        </div>
      </div>
      {allItems.length > 0 && (
        <CollectionExportControls
            onPreparePrint={() => setPrinting(true)}
          items={allItems}
          collectionName={collectionData?.name}
          hideAnswers={hideAnswersOnPrint}
          onHideAnswersChange={setHideAnswersOnPrint}
        />
      )}
      {isOwner && collectionData && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
          <CollectionVisibilityToggles
            isPublic={collectionData.isPublic ?? false}
            isDiscoverable={collectionData.isDiscoverable ?? false}
            disabled={updateCollectionMutation.isPending}
            onChange={(patch) => {
              if (!updateCollectionMutation.isPending) {
                updateCollectionMutation.mutate({ name: collectionData.name, ...patch });
              }
            }}
          />
        </div>
      )}
      {isOwner && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Description (optional, helps others find it)</label>
          <textarea
            key={collectionData?.description ?? "empty"}
            defaultValue={collectionData?.description ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (collectionData && v !== (collectionData.description ?? "") && !updateCollectionMutation.isPending)
                updateCollectionMutation.mutate({ description: v || null });
            }}
            placeholder="e.g. Biology chapter 5 practice set"
            rows={2}
            className="w-full rounded-md border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900"
          />
        </div>
      )}
      {isOwner && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <BookmarkIcon className="h-5 w-5 flex-shrink-0 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Bookmarked by</span>
              {bookmarkedByData && (
                <span className="text-xs text-slate-500">
                  {bookmarkedByData.bookmarkedBy.length} user
                  {bookmarkedByData.bookmarkedBy.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-1">
            <span className="text-sm font-medium text-slate-700">Rating</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingMutation.mutate(star)}
                  disabled={setRatingMutation.isPending}
                  className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-50"
                  title={`Rate ${star} star${star > 1 ? "s" : ""}`}
                >
                  {ratingData?.myStars != null && star <= ratingData.myStars ? (
                    <StarIconSolid className="h-5 w-5 text-amber-500" />
                  ) : (
                    <StarIcon className="h-5 w-5 text-slate-400" />
                  )}
                </button>
              ))}
            </div>
            <span className="text-sm text-slate-600">
              {ratingData?.averageStars != null
                ? `${ratingData.averageStars} (${ratingData.count} rating${ratingData.count === 1 ? "" : "s"})`
                : "No ratings yet"}
            </span>
          </div>
          {bookmarkedByData && bookmarkedByData.bookmarkedBy.length > 0 ? (
            <ul className="space-y-1 text-sm text-slate-600">
              {bookmarkedByData.bookmarkedBy.map((b) => (
                <li key={b.userId}>
                  {b.name ?? b.userId} · {new Date(b.bookmarkedAt).toLocaleDateString()}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">
              No one has bookmarked this collection yet.
            </p>
          )}
        </div>
      )}
      {showDetails && collectionData && (
        <div
          className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-40"
          onClick={() => setShowDetails(false)}
        >
          <div
            className="relative top-24 mx-auto p-5 border w-full max-w-md shadow-lg rounded-md bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Collection details</h3>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-400 hover:text-gray-500"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <dl className="space-y-2 text-sm text-gray-700">
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Name</dt>
                <dd className="text-right break-words">{collectionData.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Author</dt>
                <dd className="text-right break-all">{collectionData.createdBy}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Created</dt>
                <dd className="text-right">
                  {new Date(collectionData.createdAt).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Items</dt>
                <dd className="text-right">{collectionData.itemCount}</dd>
              </div>
              {"isPublic" in collectionData && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-gray-600">Visibility</dt>
                  <dd className="text-right">
                    {collectionData.isPublic
                      ? collectionData.isDiscoverable
                        ? "Anyone with the link · listed in Discover"
                        : "Anyone with the link"
                      : "Private"}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}

      {allItems.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50/90 py-12 text-center">
          <p className="text-slate-700">No items in this collection.</p>
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 py-1">
            <button
              type="button"
              onClick={toggleShowAnswers}
              title={showAnswers ? "Hide answers" : "Show answers"}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
                showAnswers
                  ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                  : "border-gray-200 bg-surface text-gray-500 hover:bg-gray-50"
              }`}
            >
              {showAnswers ? (
                <EyeSlashIcon className="h-4 w-4 shrink-0" />
              ) : (
                <EyeIcon className="h-4 w-4 shrink-0" />
              )}
              <span className="hidden sm:inline">
                {showAnswers ? "Hide answers" : "Show answers"}
              </span>
            </button>
            {ttsSupported && (
              <button
                type="button"
                onClick={handleListenAll}
                title={
                  listenAllState === "idle"
                    ? "Listen to all items (TTS)"
                    : listenAllState === "playing"
                    ? "Pause"
                    : "Resume"
                }
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition ${
                  listenAllState !== "idle"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-ink hover:bg-indigo-100"
                    : "border-gray-200 bg-surface text-gray-500 hover:bg-gray-50"
                }`}
              >
                {listenAllState === "playing" ? (
                  <PauseIcon className="h-4 w-4 shrink-0" />
                ) : (
                  <SpeakerWaveIcon className="h-4 w-4 shrink-0" />
                )}
                <span className="hidden sm:inline">
                  {listenAllState === "idle"
                    ? "Listen All"
                    : listenAllState === "playing"
                    ? "Pause"
                    : "Resume"}
                </span>
              </button>
            )}
          </div>
          <ItemListSection
            collectionId={id}
            items={paginatedItems}
            totalCount={totalCount}
            page={itemsPage}
            totalPages={totalPages}
            onPrevPage={() => handlePageChange(Math.max(1, itemsPage - 1))}
            onNextPage={() => handlePageChange(Math.min(totalPages, itemsPage + 1))}
            showRatingsAndComments
            returnUrl={collectionReturnUrl}
            showAnswers={showAnswers}
            onKeywordClick={(keywordName, item) => {
              if (!item?.category) return;
              const path = buildCategoryPath(
                categoryNameToSlug(item.category),
                []
              );
              navigate(`${path}?view=items&page=1&keywords=${encodeURIComponent(keywordName)}`);
            }}
            renderActions={(item) => (
              <>
                <Link
                  to={`/items/${item.id}${itemDetailSearch}`}
                  className="inline-flex rounded-md p-1.5 text-indigo-ink hover:bg-indigo-50 sm:p-2"
                  title="View item details"
                >
                  <EyeIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                </Link>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    className="rounded-md p-1.5 text-amber-600 hover:bg-amber-50 sm:p-2"
                    title="Remove from collection"
                  >
                    <MinusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </button>
                )}
                {isAuthenticated && (
                  <ItemCollectionControls
                    itemId={item.id}
                    itemCollectionIds={new Set((item.collections ?? []).map((c) => c.id))}
                    onOpenManageCollections={() => setManageCollectionsItemId(item.id)}
                    displayMode="compact-mobile"
                  />
                )}
              </>
            )}
          />
        </>
      )}

      {manageCollectionsItemId && (
        <ItemCollectionsModal
          isOpen={!!manageCollectionsItemId}
          onClose={() => setManageCollectionsItemId(null)}
          itemId={manageCollectionsItemId}
        />
      )}
    </div>
    {!printing && <p className="hidden print:block">Use the collection Print button to prepare required pictures before printing.</p>}
    {printing && allItems.length > 0 && (
      <CollectionPrintView
        collectionId={id}
        title={collectionData?.name ?? "Untitled collection"}
        items={allItems}
        hideAnswers={hideAnswersOnPrint}
      />
    )}
    </>
  );
};

export default CollectionDetailPage;
