import { createElement, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { itemsApi } from "@/api/items";
import { gamesApi } from "@/api/games";
import { collectionsApi } from "@/api/collections";
import { categoriesApi } from "@/api/categories";
import { useAuth } from "@/contexts/AuthContext";
import type { ViewMode } from "@/components/ModeSwitcher";
import { buildCategoryPath, categoryNameToSlug, findCategoryNameFromSlug } from "@/utils/categorySlug";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import { getCategoryScopeModeConfig } from "@/features/categories/utils/categoryScopeMode";
import { getStudyScopeKeywords } from "@/features/items/utils/studyScopeParams";
import { useInterests } from "@/features/interests/useInterests";
import { topicNavigationSearch, topicParts } from "@/features/interests/topicPaths";
import { GameTopicsBar, GameTopicsPrompt } from "./GameTopicsBar";
import { resolveGameTopics, type GameTopicResolution } from "./gameTopicResolution";
import type { GameRosterResponse, ItemResponse } from "@/types/api";
import { GAME_FETCH_SIZE, buildGamePool } from "./gameRoster";
import { buildGamePath, type GameScope } from "./gameScope";

const EMPTY_ITEMS: ItemResponse[] = [];

/**
 * Loads a fixed roster for explicit URL scopes or the visitor's saved topic union (AC 3.20.2) and the mode navigation shared by the Games pages.
 * Collections load every item. Category and global scopes without keyword filters ask GET /games/roster, which applies
 * the short-text rule in SQL before sampling 200 (AC 3.20.26); keyword-filtered scopes still sample 200 then filter here.
 */
export function useGameRoster() {
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
  const identityKey = isAuthenticated ? `user:${userId ?? "unknown"}` : "guest";
  const authSettled = !isAuthLoading;
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const explicitScope = Boolean(collectionId || categorySlug || filterKeywords.length);
  const allTopics = searchParams.get("all") === "1";
  const preferences = useInterests({ enabled: !explicitScope && !allTopics });
  const candidate = resolveGameTopics(explicitScope, allTopics, authSettled ? preferences.status : "loading", preferences.interests);
  const snapshotKey = `${identityKey}|${location.key}|${location.pathname}|${search}`;
  const [snapshot, setSnapshot] = useState<{ key: string; value: GameTopicResolution } | null>(null);
  // Lock only a playable choice. The empty/error prompt must still respond to Retry or choosing topics.
  const ready = candidate.mode === "explicit" || candidate.mode === "all" || candidate.mode === "topics";
  if (authSettled && ready && snapshot?.key !== snapshotKey) setSnapshot({ key: snapshotKey, value: candidate });
  const resolution = snapshot?.key === snapshotKey ? snapshot.value : candidate;
  const canLoad = resolution.mode === "explicit" || resolution.mode === "all" || resolution.mode === "topics";


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

  const { data: collectionInfo } = useQuery({
    queryKey: ["collection", collectionId, identityKey],
    queryFn: () => collectionsApi.getById(collectionId!),
    enabled: !!collectionId,
  });

  // Scope token for GET /games/roster ("" = every category), or null when the roster endpoint cannot express the scope.
  const rosterScope: string | null = useMemo(() => {
    if (collectionId || filterKeywords.length > 0) return null;
    const segments: string[] = category ? [category, ...(hasCategoryScope ? navigationKeywords : [])] : [];
    // "/" separates the segments on the wire, so a name containing one falls back to the items endpoint.
    return segments.some((segment) => segment.includes("/")) ? null : segments.join("/");
  }, [collectionId, filterKeywords, category, hasCategoryScope, navigationKeywords]);

  const {
    data: fetchedRoster,
    error,
    isPending,
    refetch,
  } = useQuery<GameRosterResponse>({
    queryKey: ["gameRoster", "v3", identityKey, collectionId ?? null, category ?? null, navigationKeywords, filterKeywords, resolution],
    queryFn: async () => {
      if (collectionId) {
        const response = await collectionsApi.getItems(collectionId, true);
        return { items: response.items, scopes: [] };
      }
      if (resolution.mode === "topics") return gamesApi.getRoster(resolution.topics, GAME_FETCH_SIZE);
      if (rosterScope !== null) return gamesApi.getRoster(rosterScope ? [rosterScope] : [], GAME_FETCH_SIZE);
      const response = await itemsApi.getRandom(
        category,
        GAME_FETCH_SIZE,
        filterKeywords.length > 0 ? filterKeywords : undefined,
        { navigationKeywords: hasCategoryScope && navigationKeywords.length > 0 ? navigationKeywords : undefined, excludeQuestionPictures: true },
      );
      return { items: response.items, scopes: [] };
    },
    enabled: authSettled && categoryReady && canLoad,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const [rosterSnapshot, setRosterSnapshot] = useState<{ key: string; data: GameRosterResponse } | null>(null);
  if (authSettled && canLoad && fetchedRoster && rosterSnapshot?.key !== snapshotKey)
    setRosterSnapshot({ key: snapshotKey, data: fetchedRoster });
  const rosterData = rosterSnapshot?.key === snapshotKey ? rosterSnapshot.data : fetchedRoster;
  const rosterItems = rosterData?.items;
  const pool = useMemo<ItemResponse[]>(() => buildGamePool(rosterItems ?? []), [rosterItems]);

  // Picture questions no game can use (#403): the server counts them per scope; collection and keyword paths count the roster.
  const excludedPictures = useMemo<number>(() => {
    const scopes = rosterData?.scopes ?? [];
    if (scopes.length > 0) return scopes.reduce((sum, entry) => sum + (entry.excludedPictures ?? 0), 0);
    return (rosterItems ?? []).filter((item) => !!item.questionImage).length;
  }, [rosterData?.scopes, rosterItems]);

  const scope = useMemo<GameScope>(() => {
    if (resolution.mode === "topics") return { kind: "topics", topics: resolution.topics, search };
    if (collectionId) return { kind: "collection", collectionId, collectionName: collectionInfo?.name, search };
    if (category) return { kind: "category", category, navigationKeywords, filterKeywords, search };
    return { kind: "global", filterKeywords, search };
  }, [collectionId, collectionInfo?.name, category, navigationKeywords, filterKeywords, search, resolution]);

  const hideSetsMode = !!category && navigationKeywords.length >= 2;
  const availableModes: ViewMode[] = collectionId
    ? ["list", "explore", "quiz", "learn", "games"]
    : getCategoryScopeModeConfig("sets", hideSetsMode).availableModes;
  const categoryScopePath = category
    ? buildCategoryPath(categoryNameToSlug(category), navigationKeywords)
    : "/categories";
  const collectionListPath = collectionId ? buildCollectionPath(collectionId, collectionInfo?.name) : null;

  const studyPath = (mode: "explore" | "quiz" | "learn"): string => {
    if (collectionId) return `${buildCollectionStudyPath(mode, collectionId, collectionInfo?.name)}${search}`;
    if (scope.kind === "topics") {
      const first = topicParts(scope.topics[0]);
      return `/${mode}/${first.category}${topicNavigationSearch(scope.topics[0])}`;
    }
    if (category) return `/${mode}/${categoryNameToSlug(category)}${search}`;
    return `/${mode}${search}`;
  };
  const quizPath = studyPath("quiz");

  const handleModeChange = (mode: ViewMode) => {
    if (mode === "sets") navigate(categoryScopePath);
    else if (mode === "list") {
      if (collectionListPath) navigate(collectionListPath);
      else if (category) navigate(`${categoryScopePath}?view=items`);
      else navigate("/categories");
    } else if (mode === "explore" || mode === "quiz" || mode === "learn") navigate(studyPath(mode));
    else navigate(buildGamePath(scope));
  };

  const title = collectionId ? (collectionInfo?.name ?? "Collection") : (category ?? "All categories");

  return {
    scope,
    runIdentityKey: snapshotKey,
    topicBar: createElement(GameTopicsBar, { scope, resolution, unavailable: (rosterData?.scopes ?? []).filter(entry => entry.status === "empty").map(entry => entry.scope) }),
    topicPrompt: resolution.mode === "choose" || resolution.mode === "error" ? createElement(GameTopicsPrompt, { mode: resolution.mode, onRetry: preferences.retry }) : null,
    title,
    pool,
    /** The roster before the short-text game pool rules; Sort It builds its own pool from it. */
    rawItems: rosterItems ?? EMPTY_ITEMS,
    isPending: !authSettled || resolution.mode === "loading" || (canLoad && isPending),
    error: error && !rosterItems ? error : null,
    refetch: () => void refetch(),
    availableModes,
    handleModeChange,
    quizPath,
    excludedPictures,
  };
}
