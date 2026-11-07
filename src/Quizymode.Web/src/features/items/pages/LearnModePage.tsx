import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { itemsApi } from "@/api/items";
import { collectionsApi } from "@/api/collections";
import { categoriesApi } from "@/api/categories";
import { useAuth } from "@/contexts/AuthContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { LearnQuestion } from "@/components/study/LearnQuestion";
import { QuestionImage } from "@/components/study/QuestionImage";
import { useQuestionPictureStatuses } from "@/components/study/pictureGate";
import { usePreloadNextPicture } from "@/components/study/preloadPicture";
import { LearnRecap, type LearnRecapRow } from "@/components/study/LearnRecap";
import { LearnFinish } from "@/components/study/LearnFinish";
import { MasteryProgress } from "@/components/study/MasteryProgress";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import type { ViewMode } from "@/components/ModeSwitcher";
import { useStudyHotkeys } from "@/components/study/useStudyHotkeys";
import { StudyHotkeysDialog } from "@/components/study/StudyHotkeysDialog";
import { LEARN_SHORTCUTS } from "@/components/study/studyShortcuts";
import {
  buildCategoryPath,
  categoryNameToSlug,
  findCategoryNameFromSlug,
} from "@/utils/categorySlug";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import { getCategoryScopeModeConfig } from "@/features/categories/utils/categoryScopeMode";
import { getStudyScopeKeywords } from "@/features/items/utils/studyScopeParams";
import { flushDeferredAnalyticsEvents } from "@/features/analytics/analyticsEvents";
import { isQuizPlayable, sameQuizScope, type QuizRunScope } from "@/features/items/quiz/quizRun";
import {
  LEARN_MAX_ITEMS,
  createLearnRun,
  getCurrentLearnItemId,
  getLearnAttemptInRound,
  getLearnOptions,
  reduceLearnRun,
  summarizeLearnRun,
  toLearnCompletionSnapshot,
  type LearnRunState,
} from "@/features/items/learn/learnRun";
import {
  GUEST_IDENTITY_KEY,
  type LearnRestoreResult,
  keepsItemSnapshot,
  learnScopeKey,
  readLearnRun,
  removeLearnRun,
  writeLearnRun,
} from "@/features/items/learn/learnStorage";
import {
  trackLearnFirstAttempt,
  trackLearnRunCompleted,
  trackLearnRunStarted,
} from "@/features/items/learn/learnAnalytics";
import { recordGuestCompletion } from "@/features/guestHistory/guestHistoryStorage";
import { recordAuthenticatedCompletion } from "@/features/studySessions/recordStudySession";
import type { ItemResponse } from "@/types/api";

const DEFAULT_LEARN_SIZE = 10;
const RESTORE_NOTICE = "Your saved Learn progress couldn't be restored, so we started over.";

type SaveState = "idle" | "saving" | "saved" | "failed";

interface RosterResult {
  items: ItemResponse[];
  /** True when a signed-in run's items could not all be refetched. */
  restoreFailed: boolean;
}

const LearnModePage = () => {
  const { category: categorySlug, collectionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const hasCategoryScope = !!categorySlug && !collectionId;
  const { navigationKeywords, filterKeywords } = useMemo(
    () => getStudyScopeKeywords(searchParams, hasCategoryScope),
    [searchParams, hasCategoryScope],
  );
  const { isAuthenticated, isLoading: isAuthLoading, userId } = useAuth();
  const identityKey = isAuthenticated ? `user:${userId ?? "unknown"}` : GUEST_IDENTITY_KEY;
  const authSettled = !isAuthLoading;

  const [run, setRun] = useState<LearnRunState | null>(null);
  const [learnSize, setLearnSize] = useState(DEFAULT_LEARN_SIZE);
  const [learnSizeInput, setLearnSizeInput] = useState(String(DEFAULT_LEARN_SIZE));
  const [notice, setNotice] = useState<string | null>(null);
  // "Make a quiz" can hand over one line about sections that could not be made (#363); captured once, then dropped from history.
  const [quickNotice, setQuickNotice] = useState<{ text: string; documentId?: string } | null>(() => {
    const state = location.state as { quickNotice?: unknown; documentId?: unknown } | null;
    return typeof state?.quickNotice === "string"
      ? { text: state.quickNotice, documentId: typeof state.documentId === "string" ? state.documentId : undefined }
      : null;
  });
  const [storageFailed, setStorageFailed] = useState(false);
  const [abandonedRestoreKey, setAbandonedRestoreKey] = useState<string | null>(null);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  /** A size change waiting for confirmation because it would discard progress. */
  const [pendingSize, setPendingSize] = useState<number | null>(null);
  const [saveInfo, setSaveInfo] = useState<{ runId: string; state: SaveState } | null>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const startTrackedRunId = useRef<string | null>(null);
  const completionHandledRunIds = useRef(new Set<string>());

  useEffect(() => {
    if ((location.state as { quickNotice?: unknown } | null)?.quickNotice !== undefined) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  const { data: categoriesData, error: categoriesError } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: hasCategoryScope,
  });
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const category = useMemo(() => {
    if (!categorySlug || collectionId) return undefined;
    if (!categoriesData?.categories) return categorySlug;
    const names = categoriesData.categories.map((c) => c.category);
    return findCategoryNameFromSlug(categorySlug, names) || categorySlug;
  }, [categorySlug, collectionId, categoriesData?.categories]);
  const categoryReady = !hasCategoryScope || !!categoriesData?.categories || !!categoriesError;

  const runScope = useMemo<QuizRunScope>(
    () =>
      collectionId
        ? { kind: "collection", collectionId }
        : {
            kind: category ? "category" : "global",
            category: category ?? null,
            navigationKeywords: [...navigationKeywords],
            filterKeywords: [...filterKeywords],
            quizSize: learnSize,
          },
    [collectionId, category, navigationKeywords, filterKeywords, learnSize],
  );
  const restoreKey = `${learnScopeKey(runScope)}|${identityKey}`;

  const { data: collectionInfo } = useQuery({
    queryKey: ["collection", collectionId, identityKey],
    queryFn: () => collectionsApi.getById(collectionId!),
    enabled: !!collectionId,
  });

  // The stored run for this scope and identity, read once the scope and identity are settled.
  const storedResult = useMemo(
    () => (authSettled && categoryReady ? readLearnRun(runScope, identityKey) : null),
    [authSettled, categoryReady, runScope, identityKey],
  );
  const stored = useMemo<LearnRestoreResult | null>(
    () => (storedResult && abandonedRestoreKey === restoreKey ? { status: "none" } : storedResult),
    [storedResult, abandonedRestoreKey, restoreKey],
  );
  const snapshotItems = stored?.status === "restored" ? stored.items : null;
  const restoreIds =
    stored?.status === "restored" && !stored.items && !collectionId ? stored.state.itemIds : null;

  const {
    data: rosterData,
    error: rosterError,
    isPending: rosterPending,
    refetch: refetchRoster,
  } = useQuery<RosterResult>({
    queryKey: [
      "learnRoster",
      collectionId ?? null,
      category ?? null,
      learnSize,
      navigationKeywords,
      filterKeywords,
      identityKey,
      restoreIds?.join(",") ?? "fresh",
    ],
    queryFn: async () => {
      if (collectionId) {
        const response = await collectionsApi.getItems(collectionId);
        return { items: response.items, restoreFailed: false };
      }
      if (restoreIds) {
        // Signed-in runs keep ids only: refetch them, and restart if any is no longer accessible (AC 3.17.8).
        try {
          const items = await Promise.all(restoreIds.map((id) => itemsApi.getById(id)));
          return { items, restoreFailed: false };
        } catch {
          return { items: [], restoreFailed: true };
        }
      }
      const response = await itemsApi.getRandom(
        category,
        learnSize,
        filterKeywords.length > 0 ? filterKeywords : undefined,
        { navigationKeywords: hasCategoryScope && navigationKeywords.length > 0 ? navigationKeywords : undefined },
      );
      return { items: response.items, restoreFailed: false };
    },
    enabled: authSettled && categoryReady && stored !== null && !snapshotItems,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  /** Playable, de-duplicated items the run draws from (AC 3.17.1). */
  const pool = useMemo<ItemResponse[]>(() => {
    const source = snapshotItems ?? rosterData?.items ?? [];
    const seen = new Set<string>();
    return source.filter((item) => {
      if (!item.id || seen.has(item.id) || !isQuizPlayable(item)) return false;
      seen.add(item.id);
      return true;
    });
  }, [snapshotItems, rosterData?.items]);
  const itemsById = useMemo(() => new Map(pool.map((item) => [item.id, item])), [pool]);

  const activeRun =
    run && run.identityKey === identityKey && sameQuizScope(run.scope, runScope) ? run : null;

  // Start or restore the run once its items are known.
  useEffect(() => {
    if (activeRun || stored === null) return;

    if (stored.status === "invalid") {
      removeLearnRun(runScope, identityKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotice(RESTORE_NOTICE);
      setAbandonedRestoreKey(restoreKey);
      return;
    }

    if (stored.status === "restored") {
      if (snapshotItems) {
        setRun(stored.state);
        return;
      }
      if (!rosterData) return;
      const poolIds = new Set(pool.map((item) => item.id));
      if (rosterData.restoreFailed || !stored.state.itemIds.every((id) => poolIds.has(id))) {
        removeLearnRun(runScope, identityKey);
        setNotice(RESTORE_NOTICE);
        setAbandonedRestoreKey(restoreKey);
        return;
      }
      setRun(stored.state);
      return;
    }

    if (rosterData && pool.length > 0) {
      setRun(createLearnRun(runScope, pool.map((item) => item.id), identityKey));
    }
  }, [activeRun, stored, snapshotItems, rosterData, pool, runScope, identityKey, restoreKey]);

  // Keep the run on this device (guest category/global runs also keep their items).
  useEffect(() => {
    if (!activeRun) return;
    let items: ItemResponse[] | null = null;
    if (keepsItemSnapshot(activeRun.scope, activeRun.identityKey)) {
      const resolved = activeRun.itemIds.map((id) => itemsById.get(id));
      if (resolved.some((item) => !item)) return;
      items = resolved as ItemResponse[];
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageFailed(!writeLearnRun(activeRun.scope, activeRun, items));
  }, [activeRun, itemsById]);

  // Funnel start: only a new run id is a new start (restores and remounts reuse the run id).
  useEffect(() => () => flushDeferredAnalyticsEvents(), []);
  useEffect(() => {
    if (!activeRun || startTrackedRunId.current === activeRun.runId) return;
    startTrackedRunId.current = activeRun.runId;
    trackLearnRunStarted(activeRun);
  }, [activeRun]);

  const saveSession = useCallback((target: LearnRunState) => {
    const snapshot = toLearnCompletionSnapshot(target);
    if (!snapshot) return;
    setSaveInfo({ runId: target.runId, state: "saving" });
    void recordAuthenticatedCompletion(snapshot).then((saved) => {
      setSaveInfo({ runId: target.runId, state: saved ? "saved" : "failed" });
    });
  }, []);

  // Completion side effects run once per run, as soon as the last item is mastered (AC 3.17.9, 3.17.10, 3.17.11).
  // Learn deliberately does not dispatch quizymode:quiz-completed.
  useEffect(() => {
    if (!activeRun || activeRun.completionEmitted || completionHandledRunIds.current.has(activeRun.runId)) return;
    const snapshot = toLearnCompletionSnapshot(activeRun);
    if (!snapshot) return;
    completionHandledRunIds.current.add(activeRun.runId);
    trackLearnRunCompleted(snapshot);
    recordGuestCompletion(snapshot, {
      isAuthenticated,
      isAuthLoading,
      runIdentityKey: activeRun.identityKey,
      currentIdentityKey: identityKey,
    });
    if (isAuthenticated && !isAuthLoading && activeRun.identityKey === identityKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      saveSession(activeRun);
    }
    setRun((current) =>
      current?.runId === activeRun.runId ? reduceLearnRun(current, { type: "mark-completion-emitted" }) : current,
    );
  }, [activeRun, isAuthenticated, isAuthLoading, identityKey, saveSession]);

  const currentItemId = activeRun ? getCurrentLearnItemId(activeRun) : undefined;
  const currentItem = currentItemId ? itemsById.get(currentItemId) : undefined;
  const currentAttempt =
    activeRun && currentItemId ? getLearnAttemptInRound(activeRun, currentItemId) : undefined;
  const options = useMemo(
    () => (activeRun && currentItem ? getLearnOptions(activeRun, currentItem) : []),
    [activeRun, currentItem],
  );
  const view = activeRun?.view;
  const summary = activeRun ? summarizeLearnRun(activeRun) : null;
  // #403: answers stay off until the question's picture has loaded.
  const pictures = useQuestionPictureStatuses();
  const pictureBlocked = pictures.isBlocked(currentItem);
  const nextItemId = activeRun ? activeRun.round.itemIds[activeRun.round.position + 1] : undefined;
  usePreloadNextPicture(nextItemId ? itemsById.get(nextItemId) : undefined);

  const handleAnswer = (answer: string) => {
    if (!activeRun || !currentItem || currentAttempt || activeRun.view !== "active" || pictureBlocked) return;
    const selectedIndex = options.indexOf(answer);
    if (selectedIndex < 0) return;
    const isCorrect = answer === currentItem.correctAnswer;
    // Only an item's first attempt is reported (AC 3.17.11).
    if ((activeRun.progress[currentItem.id]?.attempts.length ?? 0) === 0) {
      trackLearnFirstAttempt(activeRun, currentItem.id, isCorrect);
    }
    setRun((current) =>
      current
        ? reduceLearnRun(current, {
            type: "answer",
            itemId: currentItem.id,
            selectedIndex,
            isCorrect,
            completedAt: new Date().toISOString(),
          })
        : current,
    );
  };

  /** Leaves a question whose picture will not load: no attempt and no miss are recorded (#403). */
  const handleSkipUnavailable = () => {
    if (!currentItem) return;
    setRun((current) =>
      current
        ? reduceLearnRun(current, {
            type: "skip-unavailable",
            reason: pictures.isBlocked(currentItem) ? "picture-unavailable" : "picture-inaccessible",
            itemId: currentItem.id,
            completedAt: new Date().toISOString(),
          })
        : current,
    );
  };

  const handleContinue = () => setRun((current) => (current ? reduceLearnRun(current, { type: "advance" }) : current));
  const handleNextRound = () => setRun((current) => (current ? reduceLearnRun(current, { type: "next-round" }) : current));

  const startNewRun = () => {
    if (pool.length === 0) return;
    setRun(createLearnRun(runScope, pool.map((item) => item.id), identityKey));
    setNotice(null);
    setConfirmingRestart(false);
  };

  const handleSizeCommit = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setLearnSizeInput(String(learnSize));
      return;
    }
    const next = Math.min(LEARN_MAX_ITEMS, Math.max(1, parsed));
    setLearnSizeInput(String(next));
    if (next === learnSize) return;
    const hasProgress = activeRun ? Object.keys(activeRun.progress).length > 0 : false;
    if (hasProgress) {
      setPendingSize(next);
      return;
    }
    applySize(next);
  };

  const applySize = (next: number) => {
    setPendingSize(null);
    setRun(null);
    setNotice(null);
    setConfirmingRestart(false);
    setLearnSize(next);
  };

  const canAnswer = view === "active" && !!currentItem && !currentAttempt && !pictureBlocked;
  const { isHelpOpen, openHelp, closeHelp } = useStudyHotkeys({
    enabled: true,
    letter: canAnswer ? (index) => options[index] !== undefined && handleAnswer(options[index]) : undefined,
    digit: canAnswer ? (n) => options[n - 1] !== undefined && handleAnswer(options[n - 1]) : undefined,
    enter:
      view === "active" && currentAttempt
        ? handleContinue
        : view === "recap"
          ? handleNextRound
          : undefined,
  });

  // Focus: the question heading on each new question (recap and finish views focus their own h2).
  const positionKey = activeRun ? `${activeRun.runId}:${activeRun.round.number}:${activeRun.round.position}` : "";
  useEffect(() => {
    if (view === "active") questionHeadingRef.current?.focus();
  }, [view, positionKey]);

  // ---- Rendering ----------------------------------------------------------------------------------------------

  const hideSetsMode = !!category && navigationKeywords.length >= 2;
  const availableModes: ViewMode[] = collectionId
    ? ["list", "explore", "quiz", "learn", "games"]
    : getCategoryScopeModeConfig("sets", hideSetsMode).availableModes;
  const categoryScopePath = category
    ? buildCategoryPath(categoryNameToSlug(category), navigationKeywords)
    : "/categories";
  const collectionListPath = collectionId ? buildCollectionPath(collectionId, collectionInfo?.name) : null;
  const studySearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const exploreTarget = collectionId
    ? buildCollectionStudyPath("explore", collectionId, collectionInfo?.name)
    : category
      ? `/explore/${categoryNameToSlug(category)}${studySearch}`
      : `/explore${studySearch}`;

  const handleModeChange = (mode: ViewMode) => {
    if (mode === "sets") navigate(categoryScopePath);
    else if (mode === "list") {
      if (collectionListPath) navigate(collectionListPath);
      else if (category) navigate(`${categoryScopePath}?view=items`);
      else navigate("/categories");
    } else if (mode === "explore") navigate(exploreTarget);
    else if (mode === "quiz") {
      if (collectionId) navigate(`${buildCollectionStudyPath("quiz", collectionId, collectionInfo?.name)}${studySearch}`);
      else if (category) navigate(`/quiz/${categoryNameToSlug(category)}${studySearch}`);
      else navigate(`/quiz${studySearch}`);
    } else if (mode === "games") {
      if (collectionId) navigate(`${buildCollectionStudyPath("games", collectionId, collectionInfo?.name)}${studySearch}`);
      else if (category) navigate(`/games/${categoryNameToSlug(category)}${studySearch}`);
      else navigate(`/games${studySearch}`);
    }
  };

  const title = collectionId ? (collectionInfo?.name ?? "Collection") : (category ?? "All categories");
  const scopeBar = (
    <ScopeSecondaryBar
      scopeType={collectionId ? "collection" : "category"}
      activeMode="learn"
      availableModes={availableModes}
      onModeChange={handleModeChange}
    />
  );

  const loadFailed = !!rosterError && !rosterData;
  if (loadFailed) {
    return (
      <div className="py-3 sm:py-4">
        {scopeBar}
        <div role="alert" className="mx-auto mt-4 max-w-4xl">
          <ErrorMessage message="We couldn't load these questions." onRetry={() => void refetchRoster()} />
        </div>
      </div>
    );
  }

  const isEmpty =
    !activeRun && stored?.status === "none" && !!rosterData && !rosterPending && pool.length === 0;
  if (isEmpty) {
    return (
      <div className="py-3 sm:py-4">
        {scopeBar}
        <section className="mx-auto mt-4 max-w-4xl rounded-lg bg-surface p-6 text-center shadow">
          <h2 className="text-xl font-bold text-gray-900">Nothing to learn here yet</h2>
          <p className="mt-2 text-gray-600">Learn needs questions with answer choices. Try Flashcards instead.</p>
          <button
            type="button"
            onClick={() => navigate(exploreTarget)}
            className="mt-4 rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700"
          >
            Open flashcards
          </button>
        </section>
      </div>
    );
  }

  if (!activeRun || !summary) {
    return <LoadingSpinner />;
  }

  const capped = collectionId && pool.length > activeRun.itemIds.length;
  const caption = capped ? `Learning ${activeRun.itemIds.length} of ${pool.length}` : null;
  const browsePath = collectionListPath ?? categoryScopePath;
  const browseLabel = collectionListPath ? "Back to collection" : "Browse topic";
  const saveState: SaveState = saveInfo?.runId === activeRun.runId ? saveInfo.state : "idle";

  const notices = (
    <>
      {quickNotice && (
        <div
          role="status"
          className="mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <span className="min-w-0 break-words">{quickNotice.text}</span>
          <span className="flex flex-wrap items-center gap-2">
            {quickNotice.documentId && (
              <Link
                to={`/study-guides/documents/${encodeURIComponent(quickNotice.documentId)}`}
                className="inline-flex min-h-11 items-center font-medium text-indigo-ink hover:text-indigo-ink"
              >
                Open study guide
              </Link>
            )}
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setQuickNotice(null)}
              className="inline-flex min-h-11 items-center font-medium text-amber-900 underline"
            >
              Dismiss
            </button>
          </span>
        </div>
      )}
      {notice && (
        <div role="alert" className="mx-auto mb-4 max-w-4xl rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {notice}
        </div>
      )}
      {storageFailed && (
        <p role="status" className="mx-auto mb-3 max-w-4xl text-xs text-amber-800">
          We couldn&apos;t save your progress on this device.
        </p>
      )}
    </>
  );

  if (activeRun.view === "finished") {
    return (
      <div className="py-3 sm:py-4">
        {scopeBar}
        <div className="mt-4">
          {notices}
          <LearnFinish
            total={summary.total}
            firstTryCorrect={summary.firstTryCorrect}
            firstTryPercentage={summary.firstTryPercentage}
            missedCount={summary.missedItemIds.length}
            skippedCount={summary.skipped}
            isAuthenticated={isAuthenticated}
            browsePath={browsePath}
            browseLabel={browseLabel}
            saveState={saveState}
            onLearnAgain={startNewRun}
            onRetrySave={() => saveSession(activeRun)}
          />
        </div>
        <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={[]} />
      </div>
    );
  }

  const restartControl = confirmingRestart ? (
    <div role="group" aria-label="Start over" className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-gray-700">Start over? Your progress in this set will be lost.</span>
      <button type="button" onClick={startNewRun} className="font-medium text-red-700 underline">
        Start over
      </button>
      <button type="button" onClick={() => setConfirmingRestart(false)} className="font-medium text-indigo-ink underline">
        Keep learning
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setConfirmingRestart(true)}
      className="text-sm text-gray-500 underline hover:text-gray-700"
    >
      Start over
    </button>
  );

  const sizeConfirm =
    pendingSize !== null ? (
      <div role="group" aria-label="Change size" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-700">Change size and start over?</span>
        <button type="button" onClick={() => applySize(pendingSize)} className="font-medium text-red-700 underline">
          Start over
        </button>
        <button
          type="button"
          onClick={() => {
            setPendingSize(null);
            setLearnSizeInput(String(learnSize));
          }}
          className="font-medium text-indigo-ink underline"
        >
          Keep learning
        </button>
      </div>
    ) : null;

  const header = (
    <div className="space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold text-gray-900">{title}</h1>
        <p className="text-xs font-medium text-gray-700">Learn, Test and Review are free.</p>
        <p className="text-xs text-gray-500">Quiz: one pass. Learn: repeat until mastered. Review: spaced, due items.</p>
      </div>
      {!collectionId && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <span>Items to learn:</span>
          <input
            type="number"
            min={1}
            max={LEARN_MAX_ITEMS}
            value={learnSizeInput}
            onChange={(e) => setLearnSizeInput(e.target.value)}
            onBlur={(e) => handleSizeCommit(e.target.value)}
            className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
      )}
      </div>
    {sizeConfirm}
    </div>
  );

  if (activeRun.view === "recap") {
    const rows: LearnRecapRow[] = activeRun.round.itemIds.filter((itemId) => !activeRun.skipped.includes(itemId)).map((itemId) => {
      const attempt = getLearnAttemptInRound(activeRun, itemId);
      const mastered = activeRun.progress[itemId]?.mastered ?? false;
      return {
        itemId,
        question: itemsById.get(itemId)?.question ?? "Question",
        questionImage: itemsById.get(itemId)?.questionImage,
        status: !attempt?.isCorrect ? "missed" : mastered ? "mastered" : "one-more",
      };
    });
    return (
      <div className="py-3 sm:py-4">
        {scopeBar}
        <div className="mt-4">{notices}</div>
        <section className="mx-auto max-w-4xl space-y-4 rounded-lg bg-surface p-4 shadow sm:p-6">
          {header}
          <LearnRecap
            roundNumber={activeRun.round.number}
            rows={rows}
            mastered={summary.mastered}
            total={summary.total}
            caption={caption}
            onContinue={handleNextRound}
            onStartOver={() => setConfirmingRestart(true)}
          />
          {confirmingRestart && restartControl}
        </section>
        <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={LEARN_SHORTCUTS} />
      </div>
    );
  }

  const progressEntry = currentItem ? activeRun.progress[currentItem.id] : undefined;
  let feedback = "";
  if (currentAttempt && currentItem) {
    if (!currentAttempt.isCorrect) {
      feedback = `Not quite. Correct answer: ${currentItem.correctAnswer}. Answer it correctly 2 more times to master it.`;
    } else if (progressEntry?.mastered) {
      feedback = "Correct. Mastered.";
    } else {
      feedback = "Correct. 1 more correct answer to master it.";
    }
  }

  return (
    <div className="py-3 sm:py-4">
      {scopeBar}
      <div className="mt-4">{notices}</div>
      <section className="mx-auto max-w-4xl space-y-4 rounded-lg bg-surface p-4 shadow sm:p-6">
        {header}
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Round {activeRun.round.number} · {activeRun.round.position + 1} of {activeRun.round.itemIds.length}
          </span>
        </div>
        <MasteryProgress mastered={summary.mastered} total={summary.total} caption={caption} />
        {currentItem && (
          <LearnQuestion
            item={currentItem}
            options={options}
            selectedAnswer={currentAttempt ? (options[currentAttempt.selectedIndex] ?? null) : null}
            showAnswer={!!currentAttempt}
            onAnswerSelect={handleAnswer}
            headingRef={questionHeadingRef}
            questionPicture={pictures.controlsFor(currentItem, currentAttempt ? undefined : handleSkipUnavailable)}
          />
        )}
        <div aria-live="polite" className="min-h-[1.5rem] text-sm font-medium text-gray-900">
          {feedback}
        </div>
        {currentAttempt && currentItem?.explanation && (
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{currentItem.explanation}</p>
        )}
        {/* Mounted only after the answer is submitted: the picture can show the answer (#403). */}
        {currentAttempt && currentItem?.explanationImage && (
          <QuestionImage
            key={`${currentItem.id}-explanation`}
            itemId={currentItem.id} image={currentItem.explanationImage}
            slot="explanation"
            className="rounded-lg bg-surface"
          />
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="order-2 sm:order-1">{restartControl}</div>
          {currentAttempt && (
            <button
              type="button"
              onClick={handleContinue}
              aria-keyshortcuts="Enter"
              className="order-1 w-full rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:order-2 sm:w-auto"
            >
              Continue
            </button>
          )}
        </div>
        <div className="text-xs text-gray-500">
          <button type="button" onClick={openHelp} className="underline">
            Keyboard shortcuts
          </button>{" "}
          · <Link to={browsePath} className="underline">{browseLabel}</Link>
        </div>
      </section>
      <StudyHotkeysDialog open={isHelpOpen} onClose={closeHelp} shortcuts={LEARN_SHORTCUTS} />
    </div>
  );
};

export default LearnModePage;
