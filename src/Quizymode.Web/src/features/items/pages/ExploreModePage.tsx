import { useState, useEffect, useMemo, useRef } from "react";
import { sanitizeInAppPath } from "@/utils/safeInAppPath";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { itemsApi } from "@/api/items";
import { collectionsApi } from "@/api/collections";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import { useAuth } from "@/contexts/AuthContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { CommentsDrawer } from "@/components/CommentsDrawer";
import { StudyShell } from "@/components/study/StudyShell";
import { ExploreRenderer } from "@/components/study/ExploreRenderer";
import ItemCollectionsModal from "@/components/ItemCollectionsModal";
import { Link } from "react-router-dom";
import {
  categoryNameToSlug,
  findCategoryNameFromSlug,
  buildCategoryPath,
} from "@/utils/categorySlug";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import { ExploreQuizBreadcrumb } from "@/components/ExploreQuizBreadcrumb";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { ScopePathHeader } from "@/components/ScopePathHeader";
import type { ViewMode } from "@/components/ModeSwitcher";
import { reviewQueueApi } from "@/api/learningLoop";
import { FlashcardsDeckSummary } from "@/features/items/flashcards/FlashcardsDeckSummary";
import {
  anchorFirst,
  pileInDeckOrder,
  seedFlashcardDeck,
  shuffleWithAnchor,
  summaryCounts,
  type FlashcardGrade,
  type FlashcardGrades,
} from "@/features/items/flashcards/flashcardDeck";
import {
  getFlashcardsShufflePreference,
  setFlashcardsShufflePreference,
} from "@/features/items/flashcards/flashcardsShufflePreference";
import { useStudyHotkeys } from "@/components/study/useStudyHotkeys";
import { useQuestionPictureStatuses } from "@/components/study/pictureGate";
import { StudyHotkeysDialog } from "@/components/study/StudyHotkeysDialog";
import { FLASHCARD_SHORTCUTS } from "@/components/study/studyShortcuts";
import { StarIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import type { CollectionRatingResponse, ItemResponse } from "@/types/api";
import { useQuery as useRatingQuery } from "@tanstack/react-query";
import { getCategoryScopeModeConfig } from "@/features/categories/utils/categoryScopeMode";
import { getStudyScopeKeywords } from "@/features/items/utils/studyScopeParams";
import { createAnalyticsId, flushDeferredAnalyticsEvents } from "@/features/analytics/analyticsEvents";
import {
  flashcardsEventContext,
  trackFlashcardGraded,
  trackFlashcardRevealed,
  trackFlashcardsStarted,
} from "@/features/items/quiz/quizAnalytics";

/** State of one Flashcards run (a pass through the deck); grades and the pile are per round and never persisted. */
interface FlashcardRun {
  scopeKey: string;
  /** Bumps when Restart or Shuffle starts a new run (new analytics run id). */
  nonce: number;
  /** Bumps on every transition so the card remounts on its front face. */
  roundKey: number;
  /** The run's card order (ids); null means the natural order. Survivors keep their place when the list refetches. */
  order: string[] | null;
  grades: FlashcardGrades;
  /** Ids of the still-learning round being studied, or null in the full deck. */
  loopIds: string[] | null;
  isFinished: boolean;
}

const newFlashcardRun = (scopeKey: string, nonce: number): FlashcardRun => ({
  scopeKey,
  nonce,
  roundKey: 0,
  order: null,
  grades: {},
  loopIds: null,
  isFinished: false,
});

type EnqueueStatus = { itemId: string; kind: "added" | "failed" | "unavailable" };

const ADDED_STATUS_MS = 3000;

const ExploreModePage = () => {
  const { category: categorySlug, collectionId, itemId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const returnUrl = sanitizeInAppPath(searchParams.get("return"));
  const hasCategoryScope = !!categorySlug && !collectionId;
  const hasExplicitNavParam = searchParams.has("nav");
  const { keywords, navigationKeywords, filterKeywords } = useMemo(
    () => getStudyScopeKeywords(searchParams, hasCategoryScope),
    [searchParams, hasCategoryScope]
  );
/** Query string for Flashcards item URLs; preserves keywords, return, and scope filter params across prev/next and mode switch */
  const exploreItemSearch = useMemo(() => {
    const params = new URLSearchParams();
    if (returnUrl) params.set("return", returnUrl);
    if (hasCategoryScope && (hasExplicitNavParam || navigationKeywords.length > 0)) {
      params.set("nav", navigationKeywords.join(","));
    }
    if (keywords.length > 0) params.set("keywords", keywords.join(","));
    const filterType = searchParams.get("filterType");
    if (filterType) params.set("filterType", filterType);
    const search = searchParams.get("search");
    if (search) params.set("search", search);
    const ratingMin = searchParams.get("ratingMin");
    if (ratingMin) params.set("ratingMin", ratingMin);
    const ratingMax = searchParams.get("ratingMax");
    if (ratingMax) params.set("ratingMax", ratingMax);
    if (searchParams.get("ratingUnrated") === "1") params.set("ratingUnrated", "1");
    if (searchParams.get("ratingOnlyUnrated") === "1") params.set("ratingOnlyUnrated", "1");
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [
    hasCategoryScope,
    hasExplicitNavParam,
    navigationKeywords,
    returnUrl,
    keywords,
    searchParams,
  ]);
  /** Flashcards mode loads all available items (backend max 1000) into memory */
  const EXPLORE_MAX_ITEMS = 1000;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedItemForCollections, setSelectedItemForCollections] = useState<
    string | null
  >(null);
  const [commentsDrawerItemId, setCommentsDrawerItemId] = useState<string | null>(
    null
  );
  const [showDetails, setShowDetails] = useState(false);
  const hasSyncedInitialItemUrl = useRef(false);

  // Fetch categories to convert slug to actual category name
  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: !!categorySlug && !collectionId,
  });

  // Convert category slug to actual category name
  // Returns undefined while categories are loading to prevent API calls with invalid slug
  const category = useMemo(() => {
    if (!categorySlug) return undefined;
    if (!categoriesData?.categories) return undefined; // Wait for categories to load
    const categoryNames = categoriesData.categories.map((c) => c.category);
    const actualCategoryName = findCategoryNameFromSlug(
      categorySlug,
      categoryNames,
    );
    return actualCategoryName || categorySlug; // Fallback to slug if not found in list
  }, [categorySlug, categoriesData?.categories]);

  // Track whether we're still resolving the category name from slug
  const isCategoryResolving = !!categorySlug && !categoriesData?.categories;

  const runScopeKey = `${collectionId ?? ""}|${category ?? ""}|${keywords.join(",")}`;
  const [run, setRun] = useState<FlashcardRun>(() => newFlashcardRun(runScopeKey, 0));
  const [isFlipped, setIsFlipped] = useState(false);
  const [shuffleOn, setShuffleOn] = useState<boolean>(getFlashcardsShufflePreference);
  const [enqueueStatus, setEnqueueStatus] = useState<EnqueueStatus | null>(null);
  const enqueuedIds = useRef<Set<string>>(new Set());
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdRef = useRef<string | undefined>(undefined);
  // The card named by the link when the page was opened; the deck keeps it while Prev/Next move the URL (#288).
  // It is tied to the URL scope (not the resolved category name, which settles after load), so a new scope drops it.
  const entryScopeKey = `${collectionId ?? ""}|${categorySlug ?? ""}|${keywords.join(",")}`;
  const [entry] = useState(() => ({ itemId, scopeKey: entryScopeKey }));
  const entryItemId = entry.scopeKey === entryScopeKey ? entry.itemId : undefined;
  if (run.scopeKey !== runScopeKey) {
    // A different collection, category or keyword set is a different deck: drop grades, pile, loop and status.
    setRun(newFlashcardRun(runScopeKey, run.nonce));
    setEnqueueStatus(null);
    setIsFlipped(false);
  }
  // A pending "Added to Review" timer belongs to the previous deck.
  useEffect(() => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = null;
  }, [run.scopeKey]);
  const canShuffle = !!collectionId;
  const shuffleActive = canShuffle && shuffleOn;

  // Fetch navigation keyword descriptions for breadcrumb tooltips
  const { data: keywordDescriptionsData } = useQuery({
    queryKey: ["keyword-descriptions", category, navigationKeywords],
    queryFn: () =>
      keywordsApi.getKeywordDescriptions(category!, navigationKeywords),
    enabled: !!category && navigationKeywords.length > 0,
  });
  const keywordDescriptions =
    keywordDescriptionsData?.keywords?.map((k) => k.description) ?? undefined;

  // Check sessionStorage for stored items (when navigating with itemId from ItemsPage or comments)
  // Must be declared before useQuery that references it
  // Initialize synchronously from sessionStorage to avoid race conditions
  // Restore if we have an itemId (meaning we're navigating to a specific item)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getStoredItems = (): any[] | null => {
    if (!collectionId && itemId) {
      // Restore when navigating to a specific item (from ItemsPage or comments)
      const stored = sessionStorage.getItem("navigationContext_explore");
      if (stored) {
        try {
          const context = JSON.parse(stored);
          if (context.items && context.mode === "explore") {
            // Restore if we navigated here with this list (itemId in stored items) or category matches
            const itemInStoredList = context.items.some(
              (item: { id?: string }) => item.id === itemId
            );
            const categoryMatches =
              (!context.category && !category) ||
              context.category === category ||
              !category;
            if (itemInStoredList || categoryMatches) {
              return context.items;
            }
          }
        } catch {
          // Invalid stored data, ignore
        }
      }
    }
    return null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [storedItems, setStoredItems] = useState<any[] | null>(
    getStoredItems()
  );
  const [hasRestoredItems, setHasRestoredItems] = useState(false);

  const { data: singleItemData, isLoading: singleItemLoading } = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => itemsApi.getById(itemId!),
    enabled: !!itemId, // Always fetch when itemId is present to get latest data including collections
  });

  const { data: entryItemData, isLoading: entryItemLoading } = useQuery({
    queryKey: ["item", entryItemId],
    queryFn: () => itemsApi.getById(entryItemId!),
    enabled: !!entryItemId && !collectionId && !storedItems,
  });

  const { data: collectionData, isLoading: collectionLoading } = useQuery({
    queryKey: ["collectionItems", collectionId],
    queryFn: () => collectionsApi.getItems(collectionId!),
    enabled: !!collectionId, // Load even when itemId is present to get full list
  });

  const { data: collectionInfo } = useQuery({
    queryKey: ["collection", collectionId],
    queryFn: () => collectionsApi.getById(collectionId!),
    enabled: !!collectionId,
  });

  const { data: ratingData } = useRatingQuery<CollectionRatingResponse>({
    queryKey: ["collectionRating", collectionId],
    queryFn: () => collectionsApi.getRating(collectionId!),
    enabled: !!collectionId,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["randomItems", category, EXPLORE_MAX_ITEMS, navigationKeywords, filterKeywords],
    queryFn: () =>
      itemsApi.getRandom(
        category,
        EXPLORE_MAX_ITEMS,
        filterKeywords.length > 0 ? filterKeywords : undefined,
        {
          navigationKeywords: hasCategoryScope && navigationKeywords.length > 0 ? navigationKeywords : undefined,
        }
      ),
    enabled: !collectionId && !storedItems && !isCategoryResolving, // Don't load if we have stored items or category is still resolving
  });

  // Restore items and index from sessionStorage on mount
  // Restore when navigating to a specific item (itemId present)
  useEffect(() => {
    if (!hasRestoredItems && !collectionId && itemId && storedItems) {
      const stored = sessionStorage.getItem("navigationContext_explore");
      if (stored) {
        try {
          const context = JSON.parse(stored);
            if (
              context.items &&
              context.mode === "explore" &&
              context.items.length > 0
            ) {
              const itemInStoredList = context.items.some(
                (item: { id?: string }) => item.id === itemId
              );
              const categoryMatches =
                (!context.category && !category) ||
                context.category === category ||
                !category;
              if (itemInStoredList || categoryMatches) {
              // Set storedItems state with the full items list
              // eslint-disable-next-line react-hooks/set-state-in-effect
              setStoredItems(context.items);

              // Find the index of the current itemId in stored items
              const index = context.items.findIndex(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (item: any) => item.id === itemId
              );
              if (index !== -1) {
                setCurrentIndex(index);
              }

              // Clear sessionStorage after restoring state
              sessionStorage.removeItem("navigationContext_explore");
              setHasRestoredItems(true);
            }
          }
        } catch {
          // Invalid stored data, ignore
        }
      }
    }
  }, [itemId, hasRestoredItems, category, collectionId]);

  // Clear sessionStorage when starting fresh in Flashcards mode (no itemId, no collectionId)
  // This ensures we always fetch fresh items instead of restoring old ones
  useEffect(() => {
    if (!itemId && !collectionId && !hasRestoredItems) {
      // Clear old sessionStorage for this category when starting fresh
      const stored = sessionStorage.getItem("navigationContext_explore");
      if (stored) {
        try {
          const context = JSON.parse(stored);
          // Only clear if category matches (to avoid clearing other categories' data)
          const categoryMatches =
            (!context.category && !category) || context.category === category;
          if (categoryMatches && context.mode === "explore") {
            sessionStorage.removeItem("navigationContext_explore");
          }
        } catch {
          // Invalid stored data, ignore
        }
      }
    }
  }, [itemId, collectionId, category, hasRestoredItems]);

  // Use full list if available (when category/collection is present), otherwise use stored items or fetched items
  const baseItems: ItemResponse[] = useMemo(
    () =>
      collectionId
        ? collectionData?.items || (singleItemData ? [singleItemData] : [])
        : storedItems ||
          (data?.items
            ? seedFlashcardDeck(data.items, entryItemData, {
                categorySlug: hasCategoryScope ? categorySlug : undefined,
                navigationKeywords,
                filterKeywords,
                maxItems: EXPLORE_MAX_ITEMS,
              })
            : singleItemData
              ? [singleItemData]
              : []),
    [collectionId, collectionData, storedItems, data, singleItemData, entryItemData, hasCategoryScope, categorySlug, navigationKeywords, filterKeywords]
  );

  // The run's order is fixed when the run starts (first load, Restart, Shuffle); a deep-linked card stays first.
  const deckReady = collectionId ? !!collectionData : true;
  if (run.scopeKey === runScopeKey && run.order === null && shuffleActive && deckReady && baseItems.length > 0) {
    setRun({ ...run, order: shuffleWithAnchor(baseItems.map((item) => item.id), itemId, Math.random) });
  }

  // The full deck for this run: positions, stored context, comments and the Quiz switch always use it.
  const sourceDeck: ItemResponse[] = useMemo(() => {
    if (!run.order) return baseItems;
    const byId = new Map(baseItems.map((item) => [item.id, item]));
    const ordered = run.order.map((id) => byId.get(id)).filter((item): item is ItemResponse => !!item);
    const placed = new Set(run.order);
    return [...ordered, ...baseItems.filter((item) => !placed.has(item.id))];
  }, [baseItems, run.order]);

  // The still-learning round, derived by id so a refetch that drops cards cannot leave a stale deck.
  const loopDeck: ItemResponse[] | null = useMemo(() => {
    if (!run.loopIds) return null;
    const wanted = new Set(run.loopIds);
    return sourceDeck.filter((item) => wanted.has(item.id));
  }, [sourceDeck, run.loopIds]);

  // The displayed deck: only the card, counter, prev/next and URL use it.
  const items = loopDeck ?? sourceDeck;

  const isLoadingItems = collectionId
    ? collectionLoading
    : isCategoryResolving || isLoading || (itemId ? singleItemLoading : false) || (!storedItems && entryItemLoading);

  // Study telemetry (AC 5.5.4): one Flashcards run per page visit and scope; the first reveal of each card is reported.
  const flashcardsScopeKey = `${runScopeKey}|${shuffleActive ? "shuffle" : "ordered"}|${run.nonce}`;
  const flashcardsRun = useRef<{ scopeKey: string; runId: string } | null>(null);
  useEffect(() => {
    if (isLoadingItems || sourceDeck.length === 0) return;
    if (flashcardsRun.current?.scopeKey === flashcardsScopeKey) return;
    flashcardsRun.current = { scopeKey: flashcardsScopeKey, runId: createAnalyticsId() };
    trackFlashcardsStarted(flashcardsRun.current.runId, sourceDeck.length, flashcardsEventContext(collectionId, category));
  }, [category, collectionId, flashcardsScopeKey, isLoadingItems, sourceDeck.length]);
  useEffect(
    () => () => {
      flushDeferredAnalyticsEvents();
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    []
  );

  // #403: grading stays off until the card's question picture has loaded.
  const pictures = useQuestionPictureStatuses();

  const flipCurrentCard = () => {
    if (!currentItem) return;
    if (isFlipped) {
      setIsFlipped(false);
    } else {
      setIsFlipped(true);
      handleFlashcardRevealed(currentItem);
    }
  };

  const handleFlashcardRevealed = (revealed: ItemResponse) => {
    const flashcardsRunInfo = flashcardsRun.current;
    const position = sourceDeck.findIndex((candidate) => candidate.id === revealed.id) + 1;
    if (!flashcardsRunInfo || position < 1) return;
    trackFlashcardRevealed(flashcardsRunInfo.runId, revealed.id, position, flashcardsEventContext(collectionId, category));
  };

  const clearEnqueueStatus = () => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = null;
    setEnqueueStatus(null);
  };

  const showEnqueueStatus = (status: EnqueueStatus) => {
    // A late response never lands on a different card.
    if (currentIdRef.current !== status.itemId) return;
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = null;
    setEnqueueStatus(status);
    if (status.kind === "added") {
      statusTimer.current = setTimeout(() => setEnqueueStatus(null), ADDED_STATUS_MS);
    }
  };

  /** Queues a Still-learning card for long-term review once per page visit; retryable failures allow another try. */
  const startEnqueue = (id: string, force = false) => {
    if (!force && enqueuedIds.current.has(id)) return;
    enqueuedIds.current.add(id);
    reviewQueueApi.enqueue(id).then(
      () => showEnqueueStatus({ itemId: id, kind: "added" }),
      (error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          showEnqueueStatus({ itemId: id, kind: "unavailable" });
          return;
        }
        enqueuedIds.current.delete(id);
        showEnqueueStatus({ itemId: id, kind: "failed" });
      }
    );
  };

  const handleGrade = (graded: ItemResponse, grade: FlashcardGrade) => {
    if (pictures.isBlocked(graded) || run.grades[graded.id] === grade) return;
    setRun((previous) => ({ ...previous, grades: { ...previous.grades, [graded.id]: grade } }));
    const flashcardsRunInfo = flashcardsRun.current;
    const position = sourceDeck.findIndex((candidate) => candidate.id === graded.id) + 1;
    if (flashcardsRunInfo && position > 0) {
      trackFlashcardGraded(
        flashcardsRunInfo.runId,
        graded.id,
        position,
        grade === "got-it",
        flashcardsEventContext(collectionId, category)
      );
    }
    // Got it never touches the review queue; guests keep an in-session pile only.
    if (grade === "still-learning" && isAuthenticated) startEnqueue(graded.id);
  };

  // Calculate current index based on itemId if present
  useEffect(() => {
    if (itemId && items.length > 0) {
      const index = items.findIndex((item) => item.id === itemId);
      if (index !== -1) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCurrentIndex(index);
      }
    }
  }, [itemId, items]);

  // Sync URL to include first item id when landing on Flashcards without item in path (e.g. /explore/certs?keywords=...)
  useEffect(() => {
    if (
      !itemId &&
      items.length > 0 &&
      currentIndex === 0 &&
      !hasSyncedInitialItemUrl.current
    ) {
      hasSyncedInitialItemUrl.current = true;
      const firstId = items[0].id;
      if (collectionId) {
        navigate(
          `${buildCollectionStudyPath("explore", collectionId, collectionInfo?.name, firstId)}${exploreItemSearch}`,
          { replace: true }
        );
      } else if (category) {
        navigate(
          `/explore/${categoryNameToSlug(category)}/item/${firstId}${exploreItemSearch}`,
          { replace: true }
        );
      } else {
        navigate(`/explore/item/${firstId}${exploreItemSearch}`, {
          replace: true,
        });
      }
    }
  }, [
    itemId,
    items,
    currentIndex,
    collectionId,
    category,
    exploreItemSearch,
    navigate,
  ]);

  // In List Items view (no itemId in URL), subscribe to current item so +/− invalidation triggers re-render and UI updates
  const currentListItem = items[currentIndex];
  const currentItemIdForQuery = currentListItem?.id;
  const { data: currentItemData } = useQuery({
    queryKey: ["item", currentItemIdForQuery],
    queryFn: () => itemsApi.getById(currentItemIdForQuery!),
    enabled: !!currentItemIdForQuery && !itemId && items.length > 0,
  });
  const currentItem = (itemId && singleItemData && singleItemData.id === itemId)
    ? singleItemData
    : (currentItemData?.id === currentListItem?.id ? currentItemData : currentListItem);

  const currentItemIdForStatus = currentItem?.id;
  useEffect(() => {
    currentIdRef.current = currentItemIdForStatus;
    // The status belongs to the card it was shown for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearEnqueueStatus();
    setIsFlipped(false);
  }, [currentItemIdForStatus]);

  useEffect(() => {
    if (items.length > 0 && currentIndex >= items.length) {
      // Keep the card named in the URL when a refetch shortens the deck; otherwise start over.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentIndex(Math.max(0, items.findIndex((candidate) => candidate.id === itemId)));
    }
  }, [items, itemId, currentIndex]);

  const deckIndex = currentItem ? sourceDeck.findIndex((candidate) => candidate.id === currentItem.id) : currentIndex;

  // Store items in sessionStorage when we have them (for restoration after comments)
  useEffect(() => {
    if (sourceDeck.length > 0 && !collectionId) {
      // Store items for both random items and category-based items to restore after comments
      // Don't store for collections as they're stable and can be reloaded
      sessionStorage.setItem(
        "navigationContext_explore",
        JSON.stringify({
          mode: "explore",
          category: category,
          collectionId: collectionId,
          currentIndex: Math.max(0, deckIndex),
          itemIds: sourceDeck.map((item) => item.id),
          items: sourceDeck, // Store full items data
        })
      );
    }
  }, [sourceDeck, deckIndex, category, collectionId]);

  // Prepare navigation context for ItemRatingsComments
  // Include context even when itemId is present (e.g., when navigating back from comments)
  const navigationContext =
    sourceDeck.length > 0
        ? {
            mode: "explore" as const,
            category: category,
            collectionId: collectionId,
            currentIndex: Math.max(0, deckIndex),
            itemIds: sourceDeck.map((item) => item.id),
          }
        : undefined;

  const buildExploreItemPath = (id: string): string =>
    collectionId
      ? `${buildCollectionStudyPath("explore", collectionId, collectionInfo?.name, id)}${exploreItemSearch}`
      : category
        ? `/explore/${categoryNameToSlug(category)}/item/${id}${exploreItemSearch}`
        : `/explore/item/${id}${exploreItemSearch}`;

  const handlePrev = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      if (items[newIndex]) navigate(buildExploreItemPath(items[newIndex].id), { replace: true });
    }
  };

  const isLastCard = currentIndex >= items.length - 1;

  const handleNext = () => {
    if (!isLastCard) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      if (items[newIndex]) navigate(buildExploreItemPath(items[newIndex].id), { replace: true });
    } else {
      // Finish: the URL stays on the last card.
      setRun((previous) => ({ ...previous, isFinished: true }));
    }
  };

  /** One handler per transition: sets the deck, index and URL together so effects cannot race. */
  const startRound = (patch: Partial<FlashcardRun>, firstId: string | undefined, isNewRun: boolean) => {
    clearEnqueueStatus();
    setIsFlipped(false);
    setRun((previous) => ({
      ...previous,
      grades: {},
      loopIds: null,
      isFinished: false,
      ...patch,
      roundKey: previous.roundKey + 1,
      nonce: previous.nonce + (isNewRun ? 1 : 0),
    }));
    setCurrentIndex(0);
    if (firstId) navigate(buildExploreItemPath(firstId), { replace: true });
  };

  const handleStudyPile = () => {
    const pile = pileInDeckOrder(items, run.grades).map((item) => item.id);
    if (pile.length === 0) return;
    startRound({ loopIds: pile }, pile[0], false);
  };

  const handleRestart = () => {
    const ids = baseItems.map((item) => item.id);
    const order = shuffleActive ? shuffleWithAnchor(ids, null, Math.random) : null;
    startRound({ order }, order?.[0] ?? ids[0], true);
  };

  const handleShuffleToggle = () => {
    if (
      Object.keys(run.grades).length > 0 &&
      !window.confirm("Changing shuffle starts a new run and clears your grades for this deck. Continue?")
    ) {
      return;
    }
    const next = !shuffleOn;
    setFlashcardsShufflePreference(next);
    setShuffleOn(next);
    const ids = baseItems.map((item) => item.id);
    const order = next ? shuffleWithAnchor(ids, currentItem?.id, Math.random) : anchorFirst(ids, currentItem?.id);
    startRound({ order }, order[0], true);
  };

  const showSummary = run.isFinished || (run.loopIds !== null && items.length === 0);
  const counts = summaryCounts(items, run.grades);
  const { isHelpOpen, openHelp, closeHelp } = useStudyHotkeys({
    enabled: true,
    // On the summary screen only "?" stays active.
    flip: showSummary || !currentItem ? undefined : flipCurrentCard,
    prev: showSummary || currentIndex === 0 ? undefined : handlePrev,
    next: showSummary || !currentItem ? undefined : handleNext,
    digit: showSummary || !currentItem || !isFlipped ? undefined : (n) => {
      if (n === 1) handleGrade(currentItem, "got-it");
      else if (n === 2) handleGrade(currentItem, "still-learning");
    },
  });

  if (isLoadingItems) return <LoadingSpinner />;
  if (error && !collectionId)
    return (
      <ErrorMessage message="Failed to load items" onRetry={() => refetch()} />
    );
  if (sourceDeck.length === 0) {
    return (
      <div className="py-4 sm:py-6">
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No items found.</p>
          <Link
            to="/categories"
            className="text-indigo-ink hover:text-indigo-ink"
          >
            Go back to categories
          </Link>
        </div>
      </div>
    );
  }

  const hideSetsMode = !!category && navigationKeywords.length >= 2;
  const categoryAvailableModes: ViewMode[] = collectionId
    ? ["list", "explore", "quiz", "learn", "games"]
    : getCategoryScopeModeConfig("sets", hideSetsMode).availableModes;
  const categoryScopePath = category
    ? buildCategoryPath(categoryNameToSlug(category), navigationKeywords)
    : "/categories";
  const categoryListSearch = (() => {
    const params = new URLSearchParams();
    params.set("view", "items");
    if (filterKeywords.length > 0) {
      params.set("keywords", filterKeywords.join(","));
    }
    const filterType = searchParams.get("filterType");
    if (filterType) params.set("filterType", filterType);
    const search = searchParams.get("search");
    if (search) params.set("search", search);
    const ratingMin = searchParams.get("ratingMin");
    if (ratingMin) params.set("ratingMin", ratingMin);
    const ratingMax = searchParams.get("ratingMax");
    if (ratingMax) params.set("ratingMax", ratingMax);
    if (searchParams.get("ratingUnrated") === "1") params.set("ratingUnrated", "1");
    if (searchParams.get("ratingOnlyUnrated") === "1") params.set("ratingOnlyUnrated", "1");
    const query = params.toString();
    return query ? `?${query}` : "";
  })();
  const collectionListPath = collectionId
    ? buildCollectionPath(collectionId, collectionInfo?.name)
    : null;

  const backFooter = collectionId ? (
    <button
      onClick={() => collectionListPath && navigate(collectionListPath)}
      className="text-indigo-ink hover:text-indigo-ink"
      type="button"
    >
      ← Back to collection
    </button>
  ) : returnUrl ? (
    <button
      onClick={() => navigate(returnUrl)}
      className="text-indigo-ink hover:text-indigo-ink"
      type="button"
    >
      ← Back
    </button>
  ) : (
    <Link to="/categories" className="text-indigo-ink hover:text-indigo-ink">
      ← Categories
    </Link>
  );

  return (
    <div className="py-4 sm:py-6">
      <ScopeSecondaryBar
        scopeType={collectionId ? "collection" : "category"}
        activeMode="explore"
        availableModes={categoryAvailableModes}
        onModeChange={(mode) => {
          const search = exploreItemSearch;
          if (mode === "sets") {
            if (category) navigate(categoryScopePath);
            else navigate("/categories");
          } else if (mode === "list") {
            if (collectionId && collectionListPath) navigate(collectionListPath);
            else if (category)
              navigate(`${categoryScopePath}${categoryListSearch}`);
            else navigate("/categories");
          } else if (mode === "quiz") {
            const targetItemId = currentItem?.id ?? sourceDeck[0]?.id;
            if (sourceDeck.length > 0 && targetItemId) {
              const payload = {
                mode: "quiz" as const,
                category: category,
                items: sourceDeck,
                currentIndex: Math.max(0, deckIndex),
              };
              sessionStorage.setItem("navigationContext_quiz", JSON.stringify(payload));
              sessionStorage.setItem("quiz_scope_items_from_categories", JSON.stringify(payload));
            }
            if (collectionId)
              navigate(
                `${buildCollectionStudyPath("quiz", collectionId, collectionInfo?.name, currentItem?.id ?? sourceDeck[0]?.id)}${search}`
              );
            else if (category)
              navigate(
                `/quiz/${categoryNameToSlug(category)}/item/${currentItem?.id ?? sourceDeck[0]?.id}${search}`
              );
            else if (sourceDeck[0])
              navigate(`/quiz/item/${currentItem?.id ?? sourceDeck[0].id}${search}`);
          } else if (mode === "learn") {
            if (collectionId)
              navigate(`${buildCollectionStudyPath("learn", collectionId, collectionInfo?.name)}${search}`);
            else if (category)
              navigate(`/learn/${categoryNameToSlug(category)}${search}`);
            else navigate(`/learn${search}`);
          } else if (mode === "games") {
            if (collectionId)
              navigate(`${buildCollectionStudyPath("games", collectionId, collectionInfo?.name)}${search}`);
            else if (category)
              navigate(`/games/${categoryNameToSlug(category)}${search}`);
            else navigate(`/games${search}`);
          }
        }}
      />
      {collectionId && collectionInfo && (
        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 mb-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Collection
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <div className="text-lg font-semibold text-gray-900 truncate max-w-xs sm:max-w-sm md:max-w-md">
                {collectionInfo.name}
              </div>
              {collectionInfo.description && collectionInfo.description.trim() !== "" && (
                <div className="text-sm text-gray-500 truncate max-w-xs sm:max-w-sm md:max-w-lg">
                  {collectionInfo.description}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-sm text-gray-600">
              {collectionInfo.itemCount ?? sourceDeck.length} items
            </div>
            {ratingData && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">Rating</span>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      className="p-0.5"
                      title={!isAuthenticated ? "Sign in to rate this collection." : undefined}
                    >
                      {ratingData.averageStars != null && star <= Math.round(ratingData.averageStars) ? (
                        <StarIconSolid className="h-4 w-4 text-amber-500" />
                      ) : (
                        <StarIcon className="h-4 w-4 text-gray-300" />
                      )}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-gray-500">
                  {ratingData.averageStars != null
                    ? `${ratingData.averageStars} (${ratingData.count})`
                    : "No ratings yet"}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Details
            </button>
          </div>
        </div>
      )}
      {category && !collectionId && (
        <ScopePathHeader
          breadcrumb={
            <ExploreQuizBreadcrumb
              mode="explore"
              categorySlug={categoryNameToSlug(category)}
              categoryDisplayName={category}
              keywords={navigationKeywords}
              keywordDescriptions={keywordDescriptions}
              onNavigate={(path) => navigate(path)}
            />
          }
          count={sourceDeck.length}
          hint="Flashcards-style study mode for reviewing quiz items."
        />
      )}
      {showDetails && collectionId && collectionInfo && (
        <div
          className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-40"
          onClick={() => setShowDetails(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-details-title"
            className="relative top-24 mx-auto p-5 border w-full max-w-md shadow-lg rounded-md bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 id="collection-details-title" className="text-lg font-medium text-gray-900">Collection details</h3>
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
                <dd className="text-right break-words">{collectionInfo.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Author</dt>
                <dd className="text-right break-all">{collectionInfo.createdBy}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Created</dt>
                <dd className="text-right">
                  {new Date(collectionInfo.createdAt).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-gray-600">Items</dt>
                <dd className="text-right">{collectionInfo.itemCount}</dd>
              </div>
              {"isPublic" in collectionInfo && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-gray-600">Visibility</dt>
                  <dd className="text-right">
                    {collectionInfo.isPublic ? "Public" : "Private"}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      )}
      {showSummary ? (
        <FlashcardsDeckSummary
          isLoopRound={run.loopIds !== null}
          counts={counts}
          onStudyPile={handleStudyPile}
          onRestart={handleRestart}
          backContent={backFooter}
        />
      ) : (
      <StudyShell
        headerExtra={
          canShuffle ? (
            <button
              type="button"
              role="switch"
              aria-checked={shuffleOn}
              onClick={handleShuffleToggle}
              className="inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span
                aria-hidden="true"
                className={`relative inline-block h-5 w-9 rounded-full transition-colors ${shuffleOn ? "bg-indigo-600" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-all ${shuffleOn ? "left-4.5" : "left-0.5"}`}
                />
              </span>
              Shuffle
            </button>
          ) : undefined
        }
        backContent={
          <>
            {!category && !collectionId && returnUrl && (
              <div className="mb-6">
                <nav className="flex items-center gap-1 text-sm text-gray-600">
                  <button
                    onClick={() => navigate(returnUrl)}
                    className="text-indigo-ink hover:text-indigo-ink"
                    type="button"
                  >
                    ← Back
                  </button>
                </nav>
              </div>
            )}
          </>
        }
        description={
          !category || !!collectionId
            ? "Flashcards-style study mode for reviewing quiz items."
            : undefined
        }
        currentIndex={currentIndex}
        totalCount={items.length}
        onPrev={handlePrev}
        onNext={handleNext}
        nextLabel={isLastCard ? "Finish" : undefined}
        roundLabel={run.loopIds ? "Still learning" : undefined}
        isPrevDisabled={currentIndex === 0}
        isNextDisabled={false}
        currentItem={currentItem ?? undefined}
        navigationContext={navigationContext}
        onOpenComments={(id) => setCommentsDrawerItemId(id)}
        onOpenManageCollections={(id) => setSelectedItemForCollections(id)}
        isAuthenticated={isAuthenticated}
        signUpPrompt={
          !isAuthenticated ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800">
                <Link to="/signup" className="font-medium underline">
                  Sign up
                </Link>{" "}
                or{" "}
                <Link to="/login" className="font-medium underline">
                  sign in
                </Link>{" "}
                to create your own items and collections!
              </p>
            </div>
          ) : undefined
        }
        footerContent={backFooter}
        onOpenShortcuts={openHelp}
      >
        {currentItem && (
          <>
            <ExploreRenderer
              key={`${run.roundKey}:${currentItem.id}`}
              item={currentItem}
              onReveal={handleFlashcardRevealed}
              grade={run.grades[currentItem.id]}
              onGrade={handleGrade}
              isFlipped={isFlipped}
              onFlippedChange={setIsFlipped}
              questionPicture={pictures.controlsFor(currentItem, handleNext)}
            />
            <p role="status" aria-live="polite" className="min-h-5 text-sm text-gray-600">
              {enqueueStatus?.itemId === currentItem.id && (
                <>
                  {enqueueStatus.kind === "added" && "Added to Review"}
                  {enqueueStatus.kind === "unavailable" && "This card can't be added to Review"}
                  {enqueueStatus.kind === "failed" && (
                    <>
                      Couldn't add to Review. It stays in this session's pile.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          clearEnqueueStatus();
                          startEnqueue(currentItem.id, true);
                        }}
                        className="font-medium text-indigo-ink underline hover:text-indigo-ink"
                      >
                        Retry
                      </button>
                    </>
                  )}
                </>
              )}
            </p>
          </>
        )}
      </StudyShell>
      )}

      <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={showSummary ? [] : FLASHCARD_SHORTCUTS} />
      <CommentsDrawer
        itemId={commentsDrawerItemId}
        onClose={() => setCommentsDrawerItemId(null)}
        onNavigateToItem={(targetId) => {
          const idx = items.findIndex((i) => i.id === targetId);
          if (idx !== -1) setCurrentIndex(idx);
          if (sourceDeck.some((i) => i.id === targetId)) setCommentsDrawerItemId(targetId);
        }}
        previousItemId={
          commentsDrawerItemId
            ? (() => {
                const idx = sourceDeck.findIndex((i) => i.id === commentsDrawerItemId);
                return idx > 0 ? sourceDeck[idx - 1]?.id ?? null : null;
              })()
            : null
        }
        nextItemId={
          commentsDrawerItemId
            ? (() => {
                const idx = sourceDeck.findIndex((i) => i.id === commentsDrawerItemId);
                return idx >= 0 && idx < sourceDeck.length - 1
                  ? sourceDeck[idx + 1]?.id ?? null
                  : null;
              })()
            : null
        }
      />
      {selectedItemForCollections && (
        <ItemCollectionsModal
          isOpen={!!selectedItemForCollections}
          onClose={() => setSelectedItemForCollections(null)}
          itemId={selectedItemForCollections}
        />
      )}
    </div>
  );
};

export default ExploreModePage;
