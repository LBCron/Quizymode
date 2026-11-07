import { useState, useEffect, useMemo, useRef } from "react";
import { sanitizeInAppPath } from "@/utils/safeInAppPath";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Link,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { itemsApi } from "@/api/items";
import { collectionsApi } from "@/api/collections";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import { useAuth } from "@/contexts/AuthContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { CommentsDrawer } from "@/components/CommentsDrawer";
import { StudyShell } from "@/components/study/StudyShell";
import { QuizRenderer, type TypedAnswerControls } from "@/components/study/QuizRenderer";
import ItemCollectionsModal from "@/components/ItemCollectionsModal";
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
import { StarIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import type { CollectionRatingResponse } from "@/types/api";
import { getCategoryScopeModeConfig } from "@/features/categories/utils/categoryScopeMode";
import { getStudyScopeKeywords, parseSizeParam } from "@/features/items/utils/studyScopeParams";
import { QuizCompletionView } from "@/features/items/quiz/QuizCompletionView";
import { useStudyHotkeys } from "@/components/study/useStudyHotkeys";
import { useQuestionPictureStatuses } from "@/components/study/pictureGate";
import { usePreloadNextPicture } from "@/components/study/preloadPicture";
import { ModeSwitchDialog, QuizModeToggle } from "@/features/items/quiz/test/QuizModeToggle";
import { TestRunView } from "@/features/items/quiz/test/TestRunView";
import { TestSetupCard } from "@/features/items/quiz/test/TestSetupCard";
import { useTestCountdown } from "@/features/items/quiz/test/useTestCountdown";
import { StudyHotkeysDialog } from "@/components/study/StudyHotkeysDialog";
import { QUIZ_SHORTCUTS, TEST_SHORTCUTS } from "@/components/study/studyShortcuts";
import { flushDeferredAnalyticsEvents } from "@/features/analytics/analyticsEvents";
import { buildRunShare } from "@/features/items/quiz/resultShare";
import {
  quizEventContext,
  trackQuestionAnswered,
  trackQuizRunCompleted,
  trackQuizRunStarted,
  trackTestQuestionsAnswered,
} from "@/features/items/quiz/quizAnalytics";
import {
  createQuizRun,
  getQuizOptions,
  isQuizPlayable,
  isTestInProgress,
  publishQuizCompletion,
  seedQuizRoster,
  reduceQuizRun,
  restoreQuizRun,
  readPersistedQuizSize,
  sameQuizScope,
  summarizeQuizRun,
  toCompletionSnapshot,
  uniqueItemIds,
  TEST_MAX_QUESTIONS,
  type QuizRunMode,
  type QuizRunScope,
  type QuizRunState,
} from "@/features/items/quiz/quizRun";
import { gradeTypedAnswer, isTypeable } from "@/features/items/quiz/typedAnswer";
import { recordGuestCompletion } from "@/features/guestHistory/guestHistoryStorage";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";

const TEST_RESTORE_NOTICE = "We could not restore your earlier test, so we started a new one.";

/** Quiz item URL for the current scope; Prev/Next, the initial sync and the deep-link rewrite all share it. */
function buildQuizItemPath(
  scope: {
    collectionId?: string;
    collectionName?: string | null;
    category?: string;
    search: string;
  },
  id: string
): string {
  if (scope.collectionId) {
    return `${buildCollectionStudyPath("quiz", scope.collectionId, scope.collectionName, id)}${scope.search}`;
  }
  if (scope.category) {
    return `/quiz/${categoryNameToSlug(scope.category)}/item/${id}${scope.search}`;
  }
  return `/quiz/item/${id}${scope.search}`;
}

const QuizModePageContent = () => {
  const { category: categorySlug, collectionId, itemId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnUrl = sanitizeInAppPath(searchParams.get("return"));
  const hasCategoryScope = !!categorySlug && !collectionId;
  const hasExplicitNavParam = searchParams.has("nav");
  const { keywords, navigationKeywords, filterKeywords } = useMemo(
    () => getStudyScopeKeywords(searchParams, hasCategoryScope),
    [searchParams, hasCategoryScope]
  );
  /** AC 3.18.1: the URL holds the mode; anything but mode=test is Practice. */
  const mode: QuizRunMode = searchParams.get("mode") === "test" ? "test" : "practice";
  /** Query string for study URLs (Explore, Learn, quiz); preserves keywords, return, and scope filter params. Never carries mode. */
  const studySearch = useMemo(() => {
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
  /** Quiz item URLs also keep mode=test across Next, Prev, palette jumps, the initial sync and size changes. */
  const searchForMode = (target: QuizRunMode): string =>
    target === "test" ? `${studySearch}${studySearch ? "&" : "?"}mode=test` : studySearch;
  const quizItemSearch = searchForMode(mode);
  const { isAuthenticated, isLoading: isAuthLoading, userId } = useAuth();
  const identityKey = isAuthenticated ? `user:${userId ?? "unknown"}` : "guest";
  const previousIdentityKey = useRef(identityKey);
  /** Size of the saved run for this URL scope (AC 3.6.12); 10 when absent or when items come from the Categories list. */
  const readSavedQuizSize = (): number => {
    if (!itemId || collectionId) return 10;
    try {
      const fromCategories = sessionStorage.getItem("quiz_scope_items_from_categories");
      if (fromCategories) {
        try {
          const parsed = JSON.parse(fromCategories) as { items?: Array<{ id?: string }> };
          if (Array.isArray(parsed.items) && parsed.items.some((item) => item.id === itemId)) {
            return 10;
          }
        } catch {
          // Unparseable key is discarded by getStoredItems; fall through to the saved run.
        }
      }
      const stored = sessionStorage.getItem("navigationContext_quiz");
      if (!stored) return 10;
      return readPersistedQuizSize(JSON.parse(stored), identityKey, categorySlug) ?? 10;
    } catch {
      return 10;
    }
  };
  const [currentIndex, setCurrentIndex] = useState(0);
  const [run, setRun] = useState<QuizRunState | null>(null);
  const [runRestartNotice, setRunRestartNotice] = useState<string | null>(null);
  /** Mode the user asked for while a run with answers exists; waits for the confirmation (AC 3.18.1). */
  const [pendingMode, setPendingMode] = useState<QuizRunMode | null>(null);
  /** Time limit kept for the setup card after Play again (AC 3.18.10). */
  const [carriedLimitSec, setCarriedLimitSec] = useState<number | null>(null);
  /** Mode requested by the switch handler until the URL catches up; keeps a stale-mode run from being recreated. */
  const pendingSwitchRef = useRef<QuizRunMode | null>(null);
  const completionPublishedRunIds = useRef(new Set<string>());
  /** Quiz uses random N items (default 10); changing this refetches items */
  const [initialQuizSize] = useState<number>(() => parseSizeParam(searchParams.get("size")) ?? readSavedQuizSize());
  const [quizSize, setQuizSize] = useState<number>(initialQuizSize);
  /** Controlled display value for the quiz size input; committed on blur */
  const [quizSizeInput, setQuizSizeInput] = useState<string>(() => String(initialQuizSize));
  const [selectedItemForCollections, setSelectedItemForCollections] = useState<
    string | null
  >(null);
  const [commentsDrawerItemId, setCommentsDrawerItemId] = useState<string | null>(
    null
  );
  const [showDetails, setShowDetails] = useState(false);
  const hasSyncedInitialItemUrl = useRef(false);

  // AC 3.6.17 (#278): the item the page was entered on. Pinned for the life of the run so
  // Prev/Next (which change the URL item id) never change the roster.
  const [entryItemId, setEntryItemId] = useState<string | null>(() =>
    !collectionId ? (itemId ?? null) : null
  );

  /** Category/global quiz uses random N items; changing size must refetch and drop session-cached lists. */
  const handleQuizSizeChange = (raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
      setQuizSizeInput(String(quizSize));
      return;
    }
    const next = Math.min(1000, Math.max(1, n));
    setQuizSizeInput(String(next));
    if (collectionId) {
      setQuizSize(next);
      return;
    }
    if (next === quizSize) return;

    setQuizSize(next);
    setStoredItems(null);
    setEntryItemId(null);
    setCurrentIndex(0);
    setRun(null);
    setRunRestartNotice(null);
    hasSyncedInitialItemUrl.current = false;
    try {
      sessionStorage.removeItem("navigationContext_quiz");
      sessionStorage.removeItem("quiz_scope_items_from_categories");
    } catch {
      // Storage is optional; the new in-memory run still starts normally.
    }

    if (category) {
      navigate(`/quiz/${categoryNameToSlug(category)}${quizItemSearch}`, {
        replace: true,
      });
    } else {
      navigate(`/quiz${quizItemSearch}`, { replace: true });
    }

    void queryClient.invalidateQueries({
      queryKey: ["randomItems", category, next, navigationKeywords, filterKeywords],
    });
  };

  // Fetch categories to convert slug to actual category name
  const { data: categoriesData, error: categoriesError } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: !!categorySlug && !collectionId,
  });

  // Convert category slug to actual category name
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const category = useMemo(() => {
    if (!categorySlug) return undefined;
    if (!categoriesData?.categories) return categorySlug; // Fallback to slug if categories not loaded
    const categoryNames = categoriesData.categories.map((c) => c.category);
    const actualCategoryName = findCategoryNameFromSlug(
      categorySlug,
      categoryNames,
    );
    return actualCategoryName || categorySlug; // Fallback to slug if not found
  }, [categorySlug, categoriesData?.categories]);

  const runScope = useMemo<QuizRunScope>(
    () =>
      collectionId
        ? { kind: "collection", collectionId }
        : {
            kind: category ? "category" : "global",
            category: category ?? null,
            navigationKeywords: [...navigationKeywords],
            filterKeywords: [...filterKeywords],
            quizSize,
          },
    // eslint-disable-next-line react-hooks/preserve-manual-memoization
    [collectionId, category, navigationKeywords, filterKeywords, quizSize],
  );

  // A different category scope is a new entry: re-capture from the URL, but only when no run
  // exists for the new scope (Prev/Next write the canonical slug, which must not re-seed).
  const previousCategorySlug = useRef(categorySlug);
  useEffect(() => {
    if (previousCategorySlug.current === categorySlug) return;
    previousCategorySlug.current = categorySlug;
    if (run && sameQuizScope(run.scope, runScope)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntryItemId(!collectionId ? (itemId ?? null) : null);
  }, [categorySlug, collectionId, itemId, run, runScope]);

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
  // Prefer dedicated key from Categories list (filtered scope) so we use it before any overwrite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getStoredItems = (): any[] | null => {
    try {
      if (!collectionId && itemId) {
        const fromCategories = sessionStorage.getItem(
          "quiz_scope_items_from_categories"
        );
        if (fromCategories) {
          try {
            const context = JSON.parse(fromCategories);
            if (
              context.items &&
              Array.isArray(context.items) &&
              context.items.some((item: { id?: string }) => item.id === itemId)
            ) {
              sessionStorage.removeItem("quiz_scope_items_from_categories");
              return context.items;
            }
          } catch {
            sessionStorage.removeItem("quiz_scope_items_from_categories");
          }
        }
        const stored = sessionStorage.getItem("navigationContext_quiz");
        if (stored) {
          try {
            const context = JSON.parse(stored);
            if (
              context.items &&
              context.mode === "quiz" &&
              context.quizRun?.identityKey === identityKey
            ) {
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
    } catch {
      return null;
    }
    return null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [storedItems, setStoredItems] = useState<any[] | null>(
    getStoredItems()
  );

  useEffect(() => {
    if (previousIdentityKey.current === identityKey) return;
    previousIdentityKey.current = identityKey;
    // Identity transitions intentionally invalidate all access-sensitive quiz state.
    setStoredItems(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntryItemId(null);
    setRun(null);
    setRunRestartNotice(null);
    setCurrentIndex(0);
    hasSyncedInitialItemUrl.current = false;
    try {
      sessionStorage.removeItem("navigationContext_quiz");
      sessionStorage.removeItem("quiz_scope_items_from_categories");
    } catch {
      // Access-sensitive in-memory state is already discarded.
    }
    void queryClient.invalidateQueries({ queryKey: ["randomItems"] });
    void queryClient.invalidateQueries({ queryKey: ["collectionItems"] });
  }, [identityKey, queryClient]);

  const { data: singleItemData, isLoading: singleItemLoading } = useQuery({
    queryKey: ["item", entryItemId, identityKey],
    queryFn: () => itemsApi.getById(entryItemId!),
    enabled: !!entryItemId && !collectionId && !storedItems, // Disable when restoring from sessionStorage
  });

  const {
    data: collectionData,
    isLoading: collectionLoading,
    error: collectionError,
    refetch: refetchCollection,
  } = useQuery({
    queryKey: ["collectionItems", collectionId, identityKey],
    queryFn: () => collectionsApi.getItems(collectionId!),
    enabled: !!collectionId, // Load even when itemId is present to get full list
  });

  const { data: collectionInfo, isLoading: collectionInfoLoading } = useQuery({
    queryKey: ["collection", collectionId, identityKey],
    queryFn: () => collectionsApi.getById(collectionId!),
    enabled: !!collectionId, // Allow anonymous: shareable link shows collection name and items
  });

  const { data: ratingData } = useQuery<CollectionRatingResponse>({
    queryKey: ["collectionRating", collectionId, identityKey],
    queryFn: () => collectionsApi.getRating(collectionId!),
    enabled: !!collectionId,
  });

  const {
    data,
    isPending: randomIsPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["randomItems", category, quizSize, navigationKeywords, filterKeywords, identityKey],
    queryFn: () =>
      itemsApi.getRandom(
        category,
        quizSize,
        filterKeywords.length > 0 ? filterKeywords : undefined,
        {
          navigationKeywords: hasCategoryScope && navigationKeywords.length > 0 ? navigationKeywords : undefined,
        }
      ),
    // When URL has a category slug, wait for categories so we send resolved name; otherwise API can resolve by slug.
    enabled:
      !collectionId &&
      !storedItems &&
      (!categorySlug || !!categoriesData?.categories),
  });

  const { data: scopeCountData } = useQuery({
    queryKey: ["scopeCount", category, navigationKeywords, filterKeywords, identityKey],
    queryFn: () =>
      itemsApi.getAll(
        category,
        undefined,
        filterKeywords.length > 0 ? filterKeywords : undefined,
        undefined,
        undefined,
        1,
        1,
        {
          navigationKeywords:
            hasCategoryScope && navigationKeywords.length > 0
              ? navigationKeywords
              : undefined,
        }
      ),
    enabled:
      !collectionId &&
      !!category &&
      (!categorySlug || !!categoriesData?.categories),
  });

  // Clear sessionStorage when starting a fresh quiz (no itemId, no collectionId)
  // This ensures we always fetch fresh items instead of restoring old ones
  useEffect(() => {
    if (!itemId && !collectionId) {
      try {
        // Clear old sessionStorage for this category when starting fresh
        const stored = sessionStorage.getItem("navigationContext_quiz");
        if (stored) {
          const context = JSON.parse(stored);
          // Only clear if category matches (to avoid clearing other categories' data)
          const categoryMatches =
            (!context.category && !category) || context.category === category;
          if (
            categoryMatches &&
            context.mode === "quiz"
          ) {
            sessionStorage.removeItem("navigationContext_quiz");
          }
        }
      } catch {
        // Invalid or unavailable storage is ignored.
      }
    }
  }, [itemId, collectionId, category]);

  // Use full list if available (when category/collection is present), otherwise use stored items or fetched items
  // Never use singleItemData when storedItems exists (restoring from sessionStorage)
  const playableItems = useMemo(() => {
    const loadedItems = collectionId
      ? collectionData?.items ?? []
      : storedItems ||
        seedQuizRoster(data?.items ?? [], singleItemData, {
          categorySlug,
          navigationKeywords,
          filterKeywords,
          quizSize,
        });
    const seen = new Set<string>();
    return loadedItems.filter((item) => {
      if (!item.id || seen.has(item.id) || !isQuizPlayable(item)) return false;
      seen.add(item.id);
      return true;
    });
  }, [
    categorySlug,
    collectionData?.items,
    collectionId,
    data?.items,
    filterKeywords,
    navigationKeywords,
    quizSize,
    singleItemData,
    storedItems,
  ]);
  // AC 3.18.2: a Test uses the first 500 playable items.
  const availableItems = useMemo(
    () => (mode === "test" ? playableItems.slice(0, TEST_MAX_QUESTIONS) : playableItems),
    [mode, playableItems],
  );
  const items = useMemo(() => {
    if (!run || !sameQuizScope(run.scope, runScope) || run.mode !== mode) return availableItems;
    const byId = new Map(availableItems.map((item) => [item.id, item]));
    return run.itemIds.map((id) => byId.get(id)).filter((item): item is (typeof availableItems)[number] => Boolean(item));
  }, [availableItems, mode, run, runScope]);

  // Wait for the random roster (and, for a category link, the category name it depends on) so a
  // one-item run is never created and then replaced (#278). A categories error stops the wait.
  const rosterPending =
    !collectionId && !storedItems && randomIsPending && !categoriesError;
  const isLoadingItems = collectionId
    ? collectionLoading
    : rosterPending || (entryItemId ? singleItemLoading : false);

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

  // Sync URL to include first item id when landing on quiz without item in path (e.g. /quiz/certs?keywords=...)
  useEffect(() => {
    if (
      !itemId &&
      items.length > 0 &&
      currentIndex === 0 &&
      !hasSyncedInitialItemUrl.current
    ) {
      hasSyncedInitialItemUrl.current = true;
      navigate(
        buildQuizItemPath(
          { collectionId, collectionName: collectionInfo?.name, category, search: quizItemSearch },
          items[0].id
        ),
        { replace: true }
      );
    }
  }, [
    itemId,
    items,
    currentIndex,
    collectionId,
    category,
    collectionInfo?.name,
    quizItemSearch,
    navigate,
  ]);

  const currentItem = items[currentIndex];

  useEffect(() => {
    if (items.length > 0 && currentIndex >= items.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentIndex(0);
    }
  }, [items.length, currentIndex]);

  // When entering a collection quiz without an item in the path (fresh start), clear any
  // stale saved state so the quiz always begins from zero.
  useEffect(() => {
    if (collectionId && !itemId) {
      try {
        const raw = sessionStorage.getItem("navigationContext_quiz");
        if (raw) {
          const ctx = JSON.parse(raw);
          if (ctx.collectionId === collectionId) {
            sessionStorage.removeItem("navigationContext_quiz");
          }
        }
      } catch { /* intentional */ }
    }
  }, [collectionId, itemId]);

  useEffect(() => {
    if (isLoadingItems || availableItems.length === 0) return;
    if (pendingSwitchRef.current !== null && pendingSwitchRef.current !== mode) return;
    const roster = uniqueItemIds(availableItems);
    if (run && run.identityKey === identityKey && sameQuizScope(run.scope, runScope) && run.mode === mode) {
      const allRunItemsStillAvailable = run.itemIds.every((id) => roster.includes(id));
      if (allRunItemsStillAvailable || summarizeQuizRun(run).isComplete) return;
      // The API roster is authoritative; synchronously replace a now-invalid active run.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRunRestartNotice("Some questions from the saved run are no longer available, so a new run was started.");
      setRun(createQuizRun(runScope, roster, identityKey, mode));
      setCurrentIndex(0);
      return;
    }

    try {
      const raw = sessionStorage.getItem("navigationContext_quiz");
      if (raw) {
        const context = JSON.parse(raw);
        const restored = restoreQuizRun(context.quizRun, runScope, roster, identityKey, mode);
        if (restored) {
          setRun(restored);
          return;
        }
        // AC 3.18.7: an earlier run of this scope that cannot be restored as a Test starts a new one with a notice.
        if (
          mode === "test" &&
          context.quizRun?.identityKey === identityKey &&
          sameQuizScope(context.quizRun?.scope, runScope)
        ) {
          setRunRestartNotice(TEST_RESTORE_NOTICE);
        }
      }
    } catch {
      // Storage is an optional restoration aid; gameplay remains in memory.
    }

    if (pendingSwitchRef.current === mode) pendingSwitchRef.current = null;
    setRun(createQuizRun(runScope, roster, identityKey, mode));
  }, [availableItems, identityKey, isLoadingItems, mode, run, runScope]);

  // Persist the validated run for URL navigation, item details, comments, and reload restoration.
  useEffect(() => {
    if (!run || items.length === 0) return;
    try {
      sessionStorage.setItem(
        "navigationContext_quiz",
        JSON.stringify({
          mode: "quiz",
          category,
          collectionId,
          currentIndex,
          itemIds: run.itemIds,
          items: collectionId ? undefined : items,
          quizRun: run,
        })
      );
    } catch {
      // Storage failures must never block in-memory play.
    }
  }, [items, currentIndex, category, collectionId, run]);

  // AC 3.6.17 (#275): a deep link to an id outside the playable roster shows the first playable
  // item, so replace the URL (no history entry) with the item actually shown.
  useEffect(() => {
    if (!itemId || isLoadingItems || items.length === 0) return;
    // Wait for collection details so the canonical slug can be included in the rewritten URL.
    if (collectionId && collectionInfoLoading) return;
    if (!run || !sameQuizScope(run.scope, runScope) || run.mode !== mode) return;
    // The run is about to be replaced (roster shrank); wait for the new run's items.
    if (items.length !== run.itemIds.length) return;
    if (items.some((candidate) => candidate.id === itemId)) return;
    const shown = items[currentIndex];
    if (!shown) return;
    navigate(
      buildQuizItemPath(
        { collectionId, collectionName: collectionInfo?.name, category, search: quizItemSearch },
        shown.id
      ),
      { replace: true }
    );
  }, [
    itemId,
    isLoadingItems,
    items,
    run,
    runScope,
    mode,
    currentIndex,
    collectionId,
    collectionInfo?.name,
    collectionInfoLoading,
    category,
    quizItemSearch,
    navigate,
  ]);

  // Prepare navigation context for ItemRatingsComments
  // Include context even when itemId is present (e.g., when navigating back from comments)
  const navigationContext =
    items.length > 0
      ? {
          mode: "quiz" as const,
          category: category,
          collectionId: collectionId,
          currentIndex: currentIndex,
          itemIds: items.map((item) => item.id),
        }
      : undefined;

  // AC 3.6.19: a typed answer is held here (override still possible) until it is recorded on Continue or navigation.
  const [typedItemIds, setTypedItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [typedDraft, setTypedDraft] = useState<{
    runId: string;
    itemId: string;
    typed: string;
    correct: boolean;
  } | null>(null);
  const draftForCurrent =
    typedDraft && run && typedDraft.runId === run.runId && typedDraft.itemId === currentItem?.id ? typedDraft : null;
  const currentOutcome = currentItem && run ? run.outcomes[currentItem.id] : undefined;
  const selectedAnswer = currentOutcome?.selectedAnswer ?? null;
  const showAnswer = Boolean(currentOutcome) || draftForCurrent !== null;
  const runSummary = run ? summarizeQuizRun(run) : null;
  const stats = {
    total: runSummary?.answered ?? 0,
    correct: runSummary?.correct ?? 0,
  };
  const options = currentItem && run ? getQuizOptions(currentItem, run.runId) : [];
  const isCurrentTypeable = currentItem ? isTypeable(currentItem) : false;
  const isPracticeActive = run?.mode === "practice" && run.view === "active";
  // #403: answers stay off until the current question's picture has loaded (also computed for Test).
  const pictures = useQuestionPictureStatuses();
  // A question skipped for an unavailable picture is not answerable again in this run, even if the picture loads later.
  const currentSkipped = Boolean(run && currentItem && run.skipped.includes(currentItem.id));
  const pictureBlocked = pictures.isBlocked(currentItem) || currentSkipped;
  usePreloadNextPicture(items[currentIndex + 1]);
  const typedOutcome = currentOutcome?.inputMode === "typed" ? currentOutcome : undefined;
  const isTypedAnswering = Boolean(
    isPracticeActive && currentItem && isCurrentTypeable && !currentOutcome && typedItemIds.has(currentItem.id)
  );

  // Funnel telemetry (AC 5.4.9): only a new run id is a new start; other run updates are answers.
  // trackEventOnce also dedupes per tab, so restores, remounts and StrictMode do not repeat it.
  const startTrackedRunId = useRef<string | null>(null);
  // Answers are sent in batches; leaving the quiz (in-app navigation) sends any still held.
  useEffect(() => () => flushDeferredAnalyticsEvents(), []);
  useEffect(() => {
    // AC 3.18.2: a Test starts on Start test, not when its setup card appears.
    if (!run || (run.mode === "test" && run.startedAt === null) || startTrackedRunId.current === run.runId) return;
    startTrackedRunId.current = run.runId;
    trackQuizRunStarted(run);
  }, [run]);

  useEffect(() => {
    if (!run || run.completionEmitted || completionPublishedRunIds.current.has(run.runId)) return;
    const snapshot = toCompletionSnapshot(run);
    if (!snapshot) return;
    completionPublishedRunIds.current.add(run.runId);
    publishQuizCompletion(snapshot);
    if (run.mode === "test") trackTestQuestionsAnswered(run);
    trackQuizRunCompleted(snapshot);
    // Browser-local guest history (AC 3.6.13): only runs started and completed anonymously; upserted by run ID.
    recordGuestCompletion(snapshot, {
      isAuthenticated,
      isAuthLoading,
      runIdentityKey: run.identityKey,
      currentIdentityKey: identityKey,
    });
    // Authenticated history (AC 3.6.14): only runs started and completed under the same signed-in identity.
    if (isAuthenticated && !isAuthLoading && run.identityKey === identityKey) {
      void recordAuthenticatedCompletion(snapshot);
    }
    // Persist the one-shot publication marker with the run after notifying consumers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRun((current) =>
      current?.runId === run.runId
        ? reduceQuizRun(current, { type: "mark-completion-emitted" })
        : current
    );
  }, [run, isAuthenticated, isAuthLoading, identityKey]);

  const handleAnswerSelect = (answer: string) => {
    if (!run || !currentItem || pictureBlocked) return;
    if (run.mode === "test") {
      // AC 3.18.3: the last answer before submit counts; nothing is sent per change (AC 3.18.11).
      setRun((current) =>
        current
          ? reduceQuizRun(current, {
              type: "answer",
              itemId: currentItem.id,
              selectedAnswer: answer,
              isCorrect: answer === currentItem.correctAnswer,
              completedAt: new Date().toISOString(),
            })
          : current
      );
      return;
    }
    if (currentOutcome) return;
    // Only the first answer per item is scored and reported (AC 5.5.2); later clicks return above.
    trackQuestionAnswered(run, currentItem.id, answer === currentItem.correctAnswer);
    setRun((current) =>
      current
        ? reduceQuizRun(current, {
            type: "answer",
            itemId: currentItem.id,
            selectedAnswer: answer,
            isCorrect: answer === currentItem.correctAnswer,
            completedAt: new Date().toISOString(),
          })
        : current
    );
  };

  /** AC 3.6.19: records a held typed answer (first answer per item wins, one analytics event). */
  const commitTypedDraft = (draft: NonNullable<typeof typedDraft>) => {
    if (!run) return;
    trackQuestionAnswered(run, draft.itemId, draft.correct);
    setRun((current) =>
      current && current.runId === draft.runId
        ? reduceQuizRun(current, {
            type: "answer",
            itemId: draft.itemId,
            selectedAnswer: draft.typed,
            isCorrect: draft.correct,
            completedAt: new Date().toISOString(),
            inputMode: "typed",
          })
        : current
    );
  };

  // Leaving the item (Next, Prev, palette, drawer, URL) or switching run records the held typed answer.
  useEffect(() => {
    if (!typedDraft) return;
    if (!run || run.runId !== typedDraft.runId || run.view !== "active") {
      setTypedDraft(null);
      return;
    }
    if (currentItem && currentItem.id !== typedDraft.itemId) {
      commitTypedDraft(typedDraft);
      setTypedDraft(null);
    }
    // commitTypedDraft only reads run, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedDraft, run, currentItem]);

  const handleTypedSubmit = (typed: string) => {
    if (!run || !currentItem || pictureBlocked || currentSkipped || currentOutcome || typedDraft) return;
    const result = gradeTypedAnswer(typed, currentItem.correctAnswer);
    setTypedDraft({ runId: run.runId, itemId: currentItem.id, typed: typed.trim(), correct: result.correct });
  };

  const handleTypedOverride = () => {
    setTypedDraft((draft) => (draft && !draft.correct ? { ...draft, correct: true } : draft));
  };

  const handleTypedContinue = () => {
    if (!typedDraft) return;
    if (currentIndex < items.length - 1) {
      // The commit effect records the answer as the item changes.
      handleNext();
      return;
    }
    commitTypedDraft(typedDraft);
    setTypedDraft(null);
  };

  const navigateToItem = (id: string, replace: boolean) => {
    navigate(
      buildQuizItemPath(
        { collectionId, collectionName: collectionInfo?.name, category, search: quizItemSearch },
        id
      ),
      { replace }
    );
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      if (items[newIndex]) navigateToItem(items[newIndex].id, true);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      if (items[newIndex]) navigateToItem(items[newIndex].id, true);
    }
  };

  const navigateToRunItem = (index: number, replace = true) => {
    const target = items[index];
    if (!target) return;
    navigateToItem(target.id, replace);
  };

  const handlePlayAgain = () => {
    if (!run) return;
    const replay = createQuizRun(run.scope, run.itemIds, identityKey, run.mode);
    // AC 3.18.10: a Test returns to the setup card with the same time limit.
    setCarriedLimitSec(run.mode === "test" ? run.timeLimitSec : null);
    setRun(replay);
    setRunRestartNotice(null);
    setCurrentIndex(0);
    navigateToRunItem(0);
  };

  /** AC 3.18.1: the mode lives in the URL; a switch always starts a new run. */
  const applyModeChange = (target: QuizRunMode) => {
    pendingSwitchRef.current = target;
    setPendingMode(null);
    setRun(null);
    setRunRestartNotice(null);
    setCarriedLimitSec(null);
    setCurrentIndex(0);
    try {
      sessionStorage.removeItem("navigationContext_quiz");
    } catch {
      // Storage is optional; the new in-memory run still starts normally.
    }
    const firstId = availableItems[0]?.id;
    const search = searchForMode(target);
    if (firstId) {
      navigate(
        buildQuizItemPath({ collectionId, collectionName: collectionInfo?.name, category, search }, firstId),
        { replace: true }
      );
    } else if (collectionId) {
      navigate(`${buildCollectionStudyPath("quiz", collectionId, collectionInfo?.name)}${search}`, { replace: true });
    } else {
      navigate(category ? `/quiz/${categoryNameToSlug(category)}${search}` : `/quiz${search}`, { replace: true });
    }
  };

  const requestModeChange = (target: QuizRunMode) => {
    if (target === mode) return;
    const hasAnswers = run !== null && Object.keys(run.outcomes).length > 0;
    if (hasAnswers) setPendingMode(target);
    else applyModeChange(target);
  };

  const handleStartTest = (timeLimitSec: number | null) => {
    setRun((current) =>
      current ? reduceQuizRun(current, { type: "start-test", startedAt: new Date().toISOString(), timeLimitSec }) : current
    );
  };

  const handleSubmitTest = (unavailableItemIds: string[] = pictures.unavailableIds(items)) => {
    setRun((current) =>
      current
        ? reduceQuizRun(current, {
            type: "submit",
            submittedAt: new Date().toISOString(),
            reason: "manual",
            unavailableItemIds,
          })
        : current
    );
  };

  /** Practice: leave a question whose picture will not load; it is not scored and the quiz moves on (#403). */
  const handleSkipUnavailable = () => {
    if (!run || !currentItem || currentSkipped || currentOutcome) return;
    setRun((current) =>
      current
        ? reduceQuizRun(current, {
            type: "skip-unavailable",
            reason: pictures.isBlocked(currentItem) ? "picture-unavailable" : "picture-inaccessible",
            itemId: currentItem.id,
            completedAt: new Date().toISOString(),
          })
        : current
    );
    handleNext();
  };

  const handleToggleFlag = () => {
    if (!currentItem) return;
    setRun((current) => (current ? reduceQuizRun(current, { type: "toggle-flag", itemId: currentItem.id }) : current));
  };

  const handleJump = (index: number) => {
    setCurrentIndex(index);
    navigateToRunItem(index);
  };

  const pictureTimerPaused = Boolean(run?.mode === "test" && run.startedAt && !run.submittedAt && currentItem && !currentSkipped && pictures.isBlocked(currentItem));
  useEffect(() => {
    setRun(current => current ? reduceQuizRun(current, { type: "picture-pause", paused: pictureTimerPaused, at: new Date().toISOString() }) : current);
  }, [pictureTimerPaused]);

  // AC 3.18.6: wall-clock countdown; at zero (also after a reload past the deadline) submit at the deadline.
  const remainingSec = useTestCountdown(run, (deadlineIso) =>
    setRun((current) =>
      current
        ? reduceQuizRun(current, {
            type: "submit",
            submittedAt: deadlineIso,
            reason: "timeout",
            unavailableItemIds: pictures.unavailableIds(items),
          })
        : current
    ), pictureTimerPaused
  );

  const handleCollectionChange = (
    changedItemId: string,
    _updatedCollectionIds: Set<string>,
    payload: { added?: { id: string; name: string }; removedId?: string }
  ) => {
    const applyPayload = (collections: { id: string; name: string; createdAt?: string }[] = []) => {
      if (payload.added) {
        return [
          ...collections.filter((c) => c.id !== payload.added!.id),
          {
            id: payload.added.id,
            name: payload.added.name,
            createdAt: new Date().toISOString(),
          },
        ];
      }
      if (payload.removedId) {
        return collections.filter((c) => c.id !== payload.removedId);
      }
      return collections;
    };

    if (collectionId) {
      queryClient.invalidateQueries({ queryKey: ["collectionItems", collectionId] });
      return;
    }
    if (storedItems) {
      setStoredItems((prev) =>
        prev
          ? prev.map((item) =>
              item.id === changedItemId
                ? { ...item, collections: applyPayload(item.collections ?? []) }
                : item
            )
          : prev
      );
      return;
    }
    queryClient.setQueryData(
      ["randomItems", category, quizSize, navigationKeywords, filterKeywords],
      (old: { items?: { id: string; collections?: { id: string; name: string; createdAt?: string }[] }[] } | undefined) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((item) =>
            item.id === changedItemId
              ? { ...item, collections: applyPayload(item.collections ?? []) }
              : item
          ),
        };
      }
    );
  };

  const hasNextQuestion = currentIndex < items.length - 1;
  const isTestRun = run?.mode === "test";
  const testInProgress = run !== null && isTestInProgress(run);
  // A Test has no question until Start test (AC 3.18.2).
  const isQuestionActive = run?.view === "active" && !!currentItem && (!isTestRun || testInProgress);
  const typedResult = draftForCurrent
    ? { typed: draftForCurrent.typed, correct: draftForCurrent.correct, locked: false }
    : typedOutcome
      ? { typed: typedOutcome.selectedAnswer, correct: typedOutcome.isCorrect, locked: true }
      : null;
  const typedAnswerControls: TypedAnswerControls | undefined =
    isPracticeActive && currentItem
      ? {
          isTypeable: isCurrentTypeable,
          enabled: isTypedAnswering,
          onEnabledChange: (enabled) =>
            setTypedItemIds((current) => {
              const next = new Set(current);
              if (enabled) next.add(currentItem.id);
              else next.delete(currentItem.id);
              return next;
            }),
          result: typedResult,
          onSubmit: handleTypedSubmit,
          onOverride: handleTypedOverride,
          onContinue: handleTypedContinue,
          continueLabel: hasNextQuestion ? "Next question" : "Finish",
        }
      : undefined;
  const { isHelpOpen, openHelp, closeHelp } = useStudyHotkeys({
    enabled: true,
    letter: isQuestionActive && !isTypedAnswering && (isTestRun || !showAnswer) ? (index) => options[index] !== undefined && handleAnswerSelect(options[index]) : undefined,
    digit: isQuestionActive && !isTypedAnswering && (isTestRun || !showAnswer) ? (n) => options[n - 1] !== undefined && handleAnswerSelect(options[n - 1]) : undefined,
    prev: isQuestionActive && currentIndex > 0 ? handlePrev : undefined,
    next: isQuestionActive && hasNextQuestion ? handleNext : undefined,
    // AC 3.18.5: in a Test, Enter only ever means Next; no key opens or confirms Submit.
    flag: isQuestionActive && isTestRun ? handleToggleFlag : undefined,
    enter: isTestRun
      ? isQuestionActive && hasNextQuestion
        ? handleNext
        : undefined
      : isQuestionActive && showAnswer
        ? () => {
            if (draftForCurrent) {
              handleTypedContinue();
            } else if (runSummary?.isComplete) {
              setRun((current) => (current ? reduceQuizRun(current, { type: "show-summary" }) : current));
            } else if (hasNextQuestion) {
              handleNext();
            }
          }
        : undefined,
  });

  if (isLoadingItems) return <LoadingSpinner />;
  if (collectionId && collectionError)
    return (
      <div className="py-4 sm:py-6">
        <ErrorMessage
          message="This collection quiz is unavailable."
          onRetry={() => void refetchCollection()}
        />
        <div className="mt-4 text-center">
          <Link to="/categories" className="text-indigo-ink hover:text-indigo-ink">
            Browse categories
          </Link>
        </div>
      </div>
    );
  if (error && !collectionId && !itemId)
    return (
      <ErrorMessage message="Failed to load items" onRetry={() => refetch()} />
    );
  if (items.length === 0 && mode === "test") {
    return (
      <div className="py-4 sm:py-6">
        <div className="text-center py-12">
          <p className="text-gray-700 mb-4">No multiple-choice questions are available for Test here.</p>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => applyModeChange("practice")}
              className="text-indigo-ink hover:text-indigo-ink"
            >
              Switch to Practice
            </button>
            <Link to="/categories" className="text-indigo-ink hover:text-indigo-ink">
              Browse categories
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-4 sm:py-6">
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">
            {collectionId ? "This collection has no playable quiz items." : "No items found."}
          </p>
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
  if (!run) return <LoadingSpinner />;

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

  if (run.view !== "active") {
    return (
      <div className="py-4 sm:py-6">
        <QuizCompletionView
          run={run}
          items={items}
          browsePath={collectionListPath ?? categoryScopePath}
          browseLabel={collectionListPath ? "Back to collection" : "Browse topic"}
          onReviewMistakes={() => setRun((current) => current ? reduceQuizRun(current, { type: "review-mistakes" }) : current)}
          onReviewAll={() => setRun((current) => current ? reduceQuizRun(current, { type: "review-all" }) : current)}
          onBackToResults={() => setRun((current) => current ? reduceQuizRun(current, { type: "show-summary" }) : current)}
          onPlayAgain={handlePlayAgain}
          share={
            run.view === "summary"
              ? buildRunShare({
                  scope: run.scope,
                  correct: runSummary?.correct ?? 0,
                  total: runSummary?.scoredTotal ?? 0,
                  collection:
                    collectionId && collectionInfo
                      ? { id: collectionId, name: collectionInfo.name, isPublic: collectionInfo.isPublic }
                      : null,
                  origin: window.location.origin,
                })
              : null
          }
          analyticsContext={quizEventContext(run.scope)}
        />
        <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={[]} />
      </div>
    );
  }

  // AC 3.18.3: while a Test is running the List/Explore/Sets switch is hidden so the answer cannot be reached.
  const showScopeBar = !testInProgress;
  const modeControls = (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
      <QuizModeToggle mode={mode} onChange={requestModeChange} />
      {!collectionId && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span>Quiz size:</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={quizSizeInput}
            disabled={testInProgress}
            onChange={(e) => setQuizSizeInput(e.target.value)}
            onBlur={(e) => handleQuizSizeChange(e.target.value)}
            className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-500"
          />
        </label>
      )}
    </div>
  );
  const studyFooter = collectionId ? (
    <button
      onClick={() => collectionListPath && navigate(collectionListPath)}
      className="text-indigo-ink hover:text-indigo-ink"
      type="button"
    >
      ← Back to collection
    </button>
  ) : (
    <Link to="/categories" className="text-indigo-ink hover:text-indigo-ink">
      ← Categories
    </Link>
  );
  const studyDescription = !category || !!collectionId ? "Test your knowledge with interactive quizzes." : undefined;

  return (
    <div className="py-3 sm:py-4">
      {showScopeBar && (
      <ScopeSecondaryBar
        scopeType={collectionId ? "collection" : "category"}
        activeMode="quiz"
        availableModes={categoryAvailableModes}
        onModeChange={(viewMode) => {
          const search = studySearch;
          if (viewMode === "sets") {
            if (category) navigate(categoryScopePath);
            else navigate("/categories");
          } else if (viewMode === "list") {
            if (collectionId && collectionListPath) navigate(collectionListPath);
            else if (category)
              navigate(`${categoryScopePath}${categoryListSearch}`);
            else navigate("/categories");
          } else if (viewMode === "explore") {
            if (collectionId)
              navigate(
                `${buildCollectionStudyPath("explore", collectionId, collectionInfo?.name, currentItem?.id ?? items[0]?.id)}${search}`
              );
            else if (category)
              navigate(
                `/explore/${categoryNameToSlug(category)}/item/${currentItem?.id ?? items[0]?.id}${search}`
              );
            else if (items[0])
              navigate(`/explore/item/${currentItem?.id ?? items[0].id}${search}`);
          } else if (viewMode === "learn") {
            if (collectionId)
              navigate(`${buildCollectionStudyPath("learn", collectionId, collectionInfo?.name)}${search}`);
            else if (category)
              navigate(`/learn/${categoryNameToSlug(category)}${search}`);
            else navigate(`/learn${search}`);
          } else if (viewMode === "games") {
            if (collectionId)
              navigate(`${buildCollectionStudyPath("games", collectionId, collectionInfo?.name)}${search}`);
            else if (category)
              navigate(`/games/${categoryNameToSlug(category)}${search}`);
            else navigate(`/games${search}`);
          }
        }}
      />
      )}
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
              {collectionInfo.itemCount ?? items.length} items
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
              mode="quiz"
              categorySlug={categoryNameToSlug(category)}
              categoryDisplayName={category}
              keywords={navigationKeywords}
              keywordDescriptions={keywordDescriptions}
              onNavigate={(path) => navigate(path)}
            />
          }
          count={scopeCountData?.totalCount ?? items.length}
          hint="Test your knowledge with interactive quizzes."
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
      {runRestartNotice && (
        <div role="alert" className="mx-auto mb-4 max-w-4xl rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {runRestartNotice}
        </div>
      )}
      {run.mode === "test" && run.startedAt === null ? (
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 rounded-lg bg-surface p-4 shadow">{modeControls}</div>
          <TestSetupCard
            key={run.runId}
            count={items.length}
            availableCount={playableItems.length}
            requestedSize={collectionId ? null : quizSize}
            initialLimitSec={carriedLimitSec}
            onStart={handleStartTest}
          />
          <div className="mt-4 text-center">{studyFooter}</div>
        </div>
      ) : testInProgress ? (
        <TestRunView
          run={run}
          items={items}
          currentIndex={currentIndex}
          remainingSec={remainingSec}
          onPrev={handlePrev}
          onNext={handleNext}
          onJump={handleJump}
          onAnswer={handleAnswerSelect}
          onToggleFlag={handleToggleFlag}
          onSubmit={handleSubmitTest}
          onSkip={handleSkipUnavailable}
          pictures={pictures}
          shell={{
            backContent: <></>,
            description: studyDescription,
            headerExtra: modeControls,
            navigationContext,
            onOpenComments: (id) => setCommentsDrawerItemId(id),
            onOpenManageCollections: (id) => setSelectedItemForCollections(id),
            isAuthenticated,
            onOpenShortcuts: openHelp,
            footerContent: studyFooter,
          }}
        />
      ) : (
      <StudyShell
        backContent={<></>}
        description={studyDescription}
        headerExtra={modeControls}
        currentIndex={currentIndex}
        totalCount={items.length}
        onPrev={handlePrev}
        onNext={handleNext}
        isPrevDisabled={currentIndex === 0}
        isNextDisabled={currentIndex >= items.length - 1}
        currentItem={currentItem ?? undefined}
        navigationContext={navigationContext}
        onOpenComments={(id) => setCommentsDrawerItemId(id)}
        onOpenManageCollections={(id) => setSelectedItemForCollections(id)}
        onCollectionChange={handleCollectionChange}
        isAuthenticated={isAuthenticated}
        showRatingsAndCollections={showAnswer}
        onOpenShortcuts={openHelp}
        footerContent={studyFooter}
      >
        {currentItem && (
          <>
            <QuizRenderer
              item={currentItem}
              options={options}
              selectedAnswer={selectedAnswer}
              showAnswer={showAnswer}
              onAnswerSelect={handleAnswerSelect}
              stats={stats}
              typedAnswer={typedAnswerControls}
              questionPicture={{
                ...pictures.controlsFor(currentItem, isPracticeActive && !currentSkipped ? handleSkipUnavailable : undefined),
                blocked: pictureBlocked,
              }}
            />
            {runSummary?.isComplete && (
              <div role="status" className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-center">
                <p className="font-semibold text-indigo-950">
                  {runSummary.skipped > 0 ? "You finished every question." : "You answered every question."}
                </p>
                <button
                  type="button"
                  onClick={() => setRun((current) => current ? reduceQuizRun(current, { type: "show-summary" }) : current)}
                  className="mt-3 rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  View results
                </button>
              </div>
            )}
          </>
        )}
      </StudyShell>
      )}
      {pendingMode && (
        <ModeSwitchDialog
          target={pendingMode}
          onKeep={() => setPendingMode(null)}
          onConfirm={() => applyModeChange(pendingMode)}
        />
      )}

      <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={isTestRun ? TEST_SHORTCUTS : QUIZ_SHORTCUTS} />
      <CommentsDrawer
        itemId={commentsDrawerItemId}
        onClose={() => setCommentsDrawerItemId(null)}
        onNavigateToItem={(targetId) => {
          const idx = items.findIndex((i) => i.id === targetId);
          if (idx !== -1) {
            setCurrentIndex(idx);
            setCommentsDrawerItemId(targetId);
          }
        }}
        previousItemId={
          commentsDrawerItemId
            ? (() => {
                const idx = items.findIndex((i) => i.id === commentsDrawerItemId);
                return idx > 0 ? items[idx - 1]?.id ?? null : null;
              })()
            : null
        }
        nextItemId={
          commentsDrawerItemId
            ? (() => {
                const idx = items.findIndex((i) => i.id === commentsDrawerItemId);
                return idx >= 0 && idx < items.length - 1
                  ? items[idx + 1]?.id ?? null
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

// Auth must settle before saved-run restore reads the identity key; otherwise a
// signed-in reload is treated as "guest" and its run is lost (#393).
const QuizModePage = () => {
  const { isLoading } = useAuth();
  if (isLoading) return <LoadingSpinner />;
  return <QuizModePageContent />;
};

export default QuizModePage;
