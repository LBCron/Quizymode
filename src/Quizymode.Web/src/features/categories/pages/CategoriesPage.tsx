import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams, useParams, Link, useLocation } from "react-router-dom";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import { itemsApi } from "@/api/items";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { getApiErrorMessage } from "@/utils/apiError";
import ItemListSection from "@/components/ItemListSection";
import ItemCollectionsModal from "@/components/ItemCollectionsModal";
import { ItemCollectionControls } from "@/components/ItemCollectionControls";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { ScopePathHeader } from "@/components/ScopePathHeader";
import { BucketGridView } from "@/components/BucketGridView";
import { useAuth } from "@/contexts/AuthContext";
import { usePageSize } from "@/hooks/usePageSize";
import { useShowAnswers } from "@/hooks/useShowAnswers";
import { useListenAll } from "@/hooks/useListenAll";
import { SEO } from "@/components/SEO";
import {
  categoryNameToSlug,
  findCategoryNameFromSlug,
  buildCategoryPath,
  parseKeywordSegment,
  isAllCategoriesSlug,
  getAllCategoriesSlug,
} from "@/utils/categorySlug";
import { buildAddItemsPathWithParams } from "@/utils/addItemsScopeUrl";
import { ScopeFilterCombobox } from "@/components/ScopeFilterCombobox";
import { KeywordFilterCombobox } from "@/components/KeywordFilterCombobox";
import { FilterControlBar } from "@/components/FilterControlBar";
import CategoriesMapModal from "@/components/CategoriesMapModal";
import { FilterBottomSheet } from "@/components/FilterBottomSheet";
import { AddFiltersSection } from "../../items/components/filters/AddFiltersSection";
import { ItemTypeFilter } from "../../items/components/filters/ItemTypeFilter";
import { SearchFilter } from "../../items/components/filters/SearchFilter";
import { RatingFilter } from "../../items/components/filters/RatingFilter";
import { filterItems } from "../../items/utils/itemFilters";
import { useBulkRatings } from "../../items/hooks/useBulkRatings";
import type { FilterType } from "../../items/types/filters";
import type { ItemTypeFilter as ItemTypeFilterValue } from "../../items/types/filters";
import { useExtraKeywordAutocompleteSource } from "@/hooks/useExtraKeywordAutocompleteSource";
import { getCategoryScopeModeConfig } from "../utils/categoryScopeMode";
import { getCategoryThemeByName } from "../categoryThemes";
import {
  AcademicCapIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  Squares2X2Icon,
  PlusIcon,
  ArrowDownTrayIcon,
  ChevronRightIcon as BreadcrumbChevron,
  XMarkIcon,
} from "@heroicons/react/24/outline";

type SortOption = "name" | "rating" | "count";

const CATEGORIES_PER_PAGE = 12;
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

const CategoriesPage = () => {
  const { isAuthenticated } = useAuth();
  const { category: categorySlugParam, kw1: kw1Param, kw2: kw2Param } = useParams<{
    category?: string;
    kw1?: string;
    kw2?: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const viewFromUrl = searchParams.get("view") || "sets";
  const pageFromUrl = parseInt(searchParams.get("page") || "1", 10);
  const pageSizeFromUrl = parseInt(searchParams.get("pagesize") || "10", 10);
  const sortFromUrl = (searchParams.get("sort") || "name") as SortOption;
  const categoriesPageFromUrl = parseInt(
    searchParams.get("categoriesPage") || "1",
    10
  );

  const [categoriesPage, setCategoriesPage] = useState(categoriesPageFromUrl);
  const [itemsPage, setItemsPage] = useState(pageFromUrl);
  const [manageCollectionsItemId, setManageCollectionsItemId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>(sortFromUrl);
  const [isExporting, setIsExporting] = useState(false);
  const { pageSize: userPageSize } = usePageSize();
  const pageSize = searchParams.has("pagesize") ? pageSizeFromUrl : userPageSize;
  const showAnswersParam = searchParams.get("showAnswers");
  const showAnswersOverride = showAnswersParam === "true" ? true : showAnswersParam === "false" ? false : undefined;
  const { showAnswers, toggleShowAnswers } = useShowAnswers(showAnswersOverride);
  const view = viewFromUrl === "items" ? "items" : "sets";
  const navigate = useNavigate();
  const location = useLocation();
  // Scope filter state (synced from URL, applied on Apply)
  const filterTypeFromUrl = (searchParams.get("filterType") || "all") as ItemTypeFilterValue;
  const scopeSearchFromUrl = searchParams.get("search") || "";
  const scopeRatingMinFromUrl = searchParams.get("ratingMin");
  const scopeRatingMaxFromUrl = searchParams.get("ratingMax");
  const scopeRatingUnratedFromUrl = searchParams.get("ratingUnrated");
  const scopeRatingOnlyUnratedFromUrl = searchParams.get("ratingOnlyUnrated");
  const scopeRatingMinFromUrlNum = scopeRatingMinFromUrl ? parseInt(scopeRatingMinFromUrl, 10) : null;
  const scopeRatingMaxFromUrlNum = scopeRatingMaxFromUrl ? parseInt(scopeRatingMaxFromUrl, 10) : null;
  const scopeRatingIncludeUnratedFromUrl = scopeRatingUnratedFromUrl === "1" || scopeRatingUnratedFromUrl === "true";
  const scopeRatingOnlyUnratedFromUrlBool = scopeRatingOnlyUnratedFromUrl === "1" || scopeRatingOnlyUnratedFromUrl === "true";

  const [showFilters, setShowFilters] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [filterCategorySlug, setFilterCategorySlug] = useState(
    categorySlugParam ?? getAllCategoriesSlug()
  );
  const [filterKeywords, setFilterKeywords] = useState<string[]>([]);
  const [scopeFilterType, setScopeFilterType] = useState<ItemTypeFilterValue>(filterTypeFromUrl);
  const [scopeSearchText, setScopeSearchText] = useState(scopeSearchFromUrl);
  const [scopeRatingMin, setScopeRatingMin] = useState<number | null>(scopeRatingMinFromUrlNum);
  const [scopeRatingMax, setScopeRatingMax] = useState<number | null>(scopeRatingMaxFromUrlNum);
  const [scopeRatingIncludeUnrated, setScopeRatingIncludeUnrated] = useState(scopeRatingIncludeUnratedFromUrl);
  const [scopeRatingOnlyUnrated, setScopeRatingOnlyUnrated] = useState(scopeRatingOnlyUnratedFromUrlBool);
  const [activeScopeFilters, setActiveScopeFilters] = useState<Set<FilterType>>(() => {
    const s = new Set<FilterType>();
    if (filterTypeFromUrl !== "all") s.add("itemType");
    if (scopeSearchFromUrl) s.add("search");
    if (scopeRatingMinFromUrlNum !== null || scopeRatingMaxFromUrlNum !== null || scopeRatingIncludeUnratedFromUrl || scopeRatingOnlyUnratedFromUrlBool) s.add("rating");
    return s;
  });

  const pathKeyRef = useRef<string | null>(null);
  const pathKey = `${categorySlugParam ?? ""}/${kw1Param ?? ""}/${kw2Param ?? ""}`;

  // Sync scope from URL; filter panel shows path (nav) keywords
  useEffect(() => {
    setFilterCategorySlug(categorySlugParam ?? getAllCategoriesSlug());
    if (isAllCategoriesSlug(categorySlugParam)) {
      const q = searchParams.get("keywords");
      setFilterKeywords(q ? q.split(",").map((k) => k.trim()).filter(Boolean) : []);
    } else {
      const fromPath: string[] = [];
      if (kw1Param) fromPath.push(parseKeywordSegment(kw1Param));
      if (kw2Param) fromPath.push(parseKeywordSegment(kw2Param));
      setFilterKeywords(fromPath);
    }

    const pathChanged = pathKeyRef.current !== null && pathKeyRef.current !== pathKey;
    pathKeyRef.current = pathKey;

    if (pathChanged) {
      setScopeFilterType("all");
      setScopeSearchText("");
      setScopeRatingMin(null);
      setScopeRatingMax(null);
      setScopeRatingIncludeUnrated(false);
      setScopeRatingOnlyUnrated(false);
      setActiveScopeFilters((prev) => {
        const next = new Set(prev);
        next.delete("itemType");
        next.delete("search");
        next.delete("rating");
        return next;
      });
      const p = new URLSearchParams(searchParams);
      p.delete("filterType");
      p.delete("search");
      p.delete("ratingMin");
      p.delete("ratingMax");
      p.delete("ratingUnrated");
      p.delete("ratingOnlyUnrated");
      setSearchParams(p, { replace: true });
    } else {
      setScopeFilterType(filterTypeFromUrl);
      setScopeSearchText(scopeSearchFromUrl);
      setScopeRatingMin(scopeRatingMinFromUrlNum);
      setScopeRatingMax(scopeRatingMaxFromUrlNum);
      setScopeRatingIncludeUnrated(scopeRatingIncludeUnratedFromUrl);
      setScopeRatingOnlyUnrated(scopeRatingOnlyUnratedFromUrlBool);
      setActiveScopeFilters((prev) => {
        const next = new Set(prev);
        if (filterTypeFromUrl !== "all") next.add("itemType"); else next.delete("itemType");
        if (scopeSearchFromUrl) next.add("search"); else next.delete("search");
        if (scopeRatingMinFromUrlNum !== null || scopeRatingMaxFromUrlNum !== null || scopeRatingIncludeUnratedFromUrl || scopeRatingOnlyUnratedFromUrlBool) next.add("rating"); else next.delete("rating");
        return next;
      });
    }
  }, [categorySlugParam, kw1Param, kw2Param, pathKey, filterTypeFromUrl, scopeSearchFromUrl, scopeRatingMinFromUrlNum, scopeRatingMaxFromUrlNum, scopeRatingIncludeUnratedFromUrl, scopeRatingOnlyUnratedFromUrlBool]); // eslint-disable-line react-hooks/exhaustive-deps -- searchParams intentionally not in deps

  const hasActiveScopeFilters =
    scopeFilterType !== "all" || scopeSearchText !== "" || scopeRatingMin !== null || scopeRatingMax !== null || scopeRatingIncludeUnrated || scopeRatingOnlyUnrated;
  const itemDetailSearch = useMemo(() => {
    const params = new URLSearchParams();
    params.set("return", `${location.pathname}${location.search}`);
    return `?${params.toString()}`;
  }, [location.pathname, location.search]);

  const removeTagKeywordFilter = (kw: string) => {
    const updated = filterKeywordsFromQuery.filter(
      (k) => k.toLowerCase() !== kw.toLowerCase()
    );
    const p = new URLSearchParams(searchParams);
    if (updated.length > 0) p.set("keywords", updated.join(","));
    else p.delete("keywords");
    navigate(`${location.pathname}?${p.toString()}`);
    setShowFilters(false);
  };

  const addTagKeywordFilter = (kw: string) => {
    const seen = new Set<string>();
    const updated = [...filterKeywordsFromQuery, kw].filter((k) => {
      const lower = k.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
    const p = new URLSearchParams(searchParams);
    p.set("keywords", updated.join(","));
    navigate(`${location.pathname}?${p.toString()}`);
  };

  const handleApplyFilter = () => {
    const path = buildCategoryPath(filterCategorySlug, filterKeywords);
    const params = new URLSearchParams();
    params.set("view", activeView);
    params.set("page", "1");
    params.set("pagesize", pageSize.toString());
    if (sortBy) params.set("sort", sortBy);
    if (scopeFilterType !== "all") params.set("filterType", scopeFilterType);
    if (scopeSearchText) params.set("search", scopeSearchText);
    if (scopeRatingMin !== null) params.set("ratingMin", scopeRatingMin.toString());
    if (scopeRatingMax !== null) params.set("ratingMax", scopeRatingMax.toString());
    if (scopeRatingIncludeUnrated) params.set("ratingUnrated", "1");
    if (scopeRatingOnlyUnrated) params.set("ratingOnlyUnrated", "1");
    if (filterKeywordsFromQuery.length > 0) params.set("keywords", filterKeywordsFromQuery.join(","));
    else params.delete("keywords");
    navigate(`${path}?${params.toString()}`);
    setShowFilters(false);
  };

  const addScopeFilter = (type: FilterType) => {
    setActiveScopeFilters((prev) => new Set(prev).add(type));
    setShowFilters(true);
  };

  const removeScopeFilter = (type: FilterType) => {
    setActiveScopeFilters((prev) => {
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
    if (type === "itemType") setScopeFilterType("all");
    if (type === "search") setScopeSearchText("");
    if (type === "rating") {
      setScopeRatingMin(null);
      setScopeRatingMax(null);
      setScopeRatingIncludeUnrated(false);
      setScopeRatingOnlyUnrated(false);
    }
  };

  const handleFilterCategoryChange = (slug: string) => {
    setFilterCategorySlug(slug);
    setFilterKeywords([]);
  };

  const handleFilterPrimaryTopicChange = (kw1: string) => {
    setFilterKeywords(kw1 ? [kw1] : []);
  };

  const handleFilterSubtopicChange = (kw2: string) => {
    setFilterKeywords((prev) => {
      if (!kw2) return prev.slice(0, 1);
      if (prev[0]) return [prev[0], kw2];
      return prev;
    });
  };

  // Path keywords = navigation scope (from URL path: certs/aws/c002)
  const pathKeywordsFromUrl = useMemo(() => {
    const kws: string[] = [];
    if (kw1Param) kws.push(parseKeywordSegment(kw1Param));
    if (kw2Param) kws.push(parseKeywordSegment(kw2Param));
    return kws;
  }, [kw1Param, kw2Param]);

  // Filter keywords = additional narrowing (from query ?keywords=s3,ec2); only items that have these too
  const filterKeywordsFromQuery = useMemo(() => {
    const q = searchParams.get("keywords");
    if (!q) return [];
    return q.split(",").map((k) => k.trim()).filter(Boolean);
  }, [searchParams]);

  // For "all" categories we have no path; keywords come from query only
  const keywordsFromUrl = useMemo(() => {
    if (isAllCategoriesSlug(categorySlugParam)) return filterKeywordsFromQuery;
    return pathKeywordsFromUrl;
  }, [categorySlugParam, pathKeywordsFromUrl, filterKeywordsFromQuery]);

  const keywordsFromUrlOrQuery = useMemo(() => {
    if (isAllCategoriesSlug(categorySlugParam)) return filterKeywordsFromQuery;
    return pathKeywordsFromUrl;
  }, [categorySlugParam, pathKeywordsFromUrl, filterKeywordsFromQuery]);

  const { data: categoriesData, isLoading, error, refetch } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
  });

  const categoryName = useMemo(() => {
    if (!categorySlugParam || !categoriesData?.categories) return null;
    if (isAllCategoriesSlug(categorySlugParam)) return null;
    const names = categoriesData.categories.map((c) => c.category);
    return findCategoryNameFromSlug(categorySlugParam, names);
  }, [categorySlugParam, categoriesData?.categories]);

  const { data: breadcrumbKeywordDescriptionsData } = useQuery({
    queryKey: ["keyword-descriptions", categoryName, pathKeywordsFromUrl],
    queryFn: () =>
      keywordsApi.getKeywordDescriptions(categoryName!, pathKeywordsFromUrl),
    enabled: !!categoryName && pathKeywordsFromUrl.length > 0,
  });
  const breadcrumbKeywordDescriptions =
    breadcrumbKeywordDescriptionsData?.keywords?.map((k) => k.description) ?? undefined;

  const filterCategoryName = useMemo(() => {
    if (!categoriesData?.categories || isAllCategoriesSlug(filterCategorySlug)) return null;
    const names = categoriesData.categories.map((c) => c.category);
    return findCategoryNameFromSlug(filterCategorySlug, names);
  }, [filterCategorySlug, categoriesData?.categories]);

  const currentCategoryMeta = useMemo(() => {
    if (!categoryName || !categoriesData?.categories) return null;
    return categoriesData.categories.find((c) => c.category === categoryName) ?? null;
  }, [categoryName, categoriesData?.categories]);

  const currentCategoryTheme = useMemo(
    () => getCategoryThemeByName(categoryName),
    [categoryName]
  );
  const categoriesOverviewTheme = useMemo(
    () => getCategoryThemeByName("Trivia"),
    []
  );
  const { data: rank1Data } = useQuery({
    queryKey: ["keywords", "rank1", filterCategoryName],
    queryFn: () => keywordsApi.getNavigationKeywords(filterCategoryName!, undefined),
    enabled: !!filterCategoryName && !!categoriesData?.categories,
  });

  const { data: rank2Data } = useQuery({
    queryKey: ["keywords", "rank2", filterCategoryName, filterKeywords[0]],
    queryFn: () =>
      keywordsApi.getNavigationKeywords(filterCategoryName!, [filterKeywords[0]]),
    enabled: !!filterCategoryName && !!filterKeywords[0]?.trim(),
  });

  const { data: rank1AllData } = useQuery({
    queryKey: ["keywords", "rank1", "all", categoriesData?.categories?.length],
    queryFn: async () => {
      const categories = categoriesData!.categories!;
      const results = await Promise.all(
        categories.map((c) => keywordsApi.getNavigationKeywords(c.category, undefined))
      );
      const names = new Set<string>();
      results.forEach((r) =>
        r.keywords.forEach((k) => {
          if (k.name.toLowerCase() !== "other") names.add(k.name);
        })
      );
      return Array.from(names).sort();
    },
    enabled:
      isAllCategoriesSlug(filterCategorySlug) &&
      !!categoriesData?.categories?.length,
  });

  const { data: rank2AllData } = useQuery({
    queryKey: [
      "keywords",
      "rank2",
      "all",
      filterKeywords[0],
      categoriesData?.categories?.length,
    ],
    queryFn: async () => {
      const categories = categoriesData!.categories!;
      const kw1 = filterKeywords[0]!;
      const results = await Promise.all(
        categories.map((c) =>
          keywordsApi.getNavigationKeywords(c.category, [kw1])
        )
      );
      const names = new Set<string>();
      results.forEach((r) =>
        r.keywords.forEach((k) => {
          if (k.name.toLowerCase() !== "other") names.add(k.name);
        })
      );
      return Array.from(names).sort();
    },
    enabled:
      isAllCategoriesSlug(filterCategorySlug) &&
      !!filterKeywords[0]?.trim() &&
      !!categoriesData?.categories?.length,
  });

  const rank1Options = useMemo(() => {
    if (isAllCategoriesSlug(filterCategorySlug)) return rank1AllData ?? [];
    return rank1Data?.keywords?.filter((k) => k.name.toLowerCase() !== "other").map((k) => k.name) ?? [];
  }, [filterCategorySlug, rank1Data, rank1AllData]);

  const rank2Options = useMemo(() => {
    if (isAllCategoriesSlug(filterCategorySlug)) return rank2AllData ?? [];
    return rank2Data?.keywords?.map((k) => k.name) ?? [];
  }, [filterCategorySlug, rank2Data, rank2AllData]);

  const { data: keywordsData, isLoading: isLoadingKeywords } = useQuery({
    queryKey: ["keywords", categoryName, pathKeywordsFromUrl],
    queryFn: () =>
      keywordsApi.getNavigationKeywords(
        categoryName!,
        pathKeywordsFromUrl.length > 0 ? pathKeywordsFromUrl : undefined
      ),
    enabled: !!categoryName && view === "sets",
  });

  const { extraKeywordAutocompleteSource: setsViewKeywordOptions } = useExtraKeywordAutocompleteSource(
    categoryName ?? "",
    [],
    view === "sets" && !!categoryName
  );

  const tagFromUrl = searchParams.get("tag") || undefined;
  const itemTagKeywords = useMemo(() => {
    const seen = new Set<string>();
    const combined = [...filterKeywordsFromQuery, ...(tagFromUrl ? [tagFromUrl] : [])].filter((k) => {
      const lower = k.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
    return combined;
  }, [
    filterKeywordsFromQuery,
    tagFromUrl,
  ]);
  const navigationKeywordsForScope = useMemo(
    () => (isAllCategoriesSlug(categorySlugParam) ? [] : pathKeywordsFromUrl),
    [categorySlugParam, pathKeywordsFromUrl]
  );
  const keywordsForStudy = useMemo(() => {
    const seen = new Set<string>();
    return [...navigationKeywordsForScope, ...itemTagKeywords].filter((k) => {
      const lower = k.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  }, [navigationKeywordsForScope, itemTagKeywords]);
  const remainingNavigationKeywordCount = useMemo(() => {
    if (!keywordsData?.keywords) return 0;
    const pathKwLower = new Set(pathKeywordsFromUrl.map((k) => k.toLowerCase()));
    return keywordsData.keywords.filter(
      (keyword) => !pathKwLower.has(keyword.name.toLowerCase())
    ).length;
  }, [keywordsData?.keywords, pathKeywordsFromUrl]);

  const isLeaf = !!categoryName && pathKeywordsFromUrl.length >= 2;
  const effectiveLeaf =
    isLeaf || (keywordsFromUrl.length >= 1 && remainingNavigationKeywordCount === 0);
  const hideSetsMode = isLeaf || (view === "sets" && effectiveLeaf);
  const { activeView, availableModes: categoryAvailableModes } =
    getCategoryScopeModeConfig(view, hideSetsMode);

  const isItemsViewAllowed =
    activeView === "items" &&
    (!!categoryName || isAllCategoriesSlug(categorySlugParam));
  const scopeIsPrivate =
    scopeFilterType === "all" ? undefined : scopeFilterType === "private";
  const hasClientSideScopeFilters =
    scopeSearchText !== "" || scopeRatingMin !== null || scopeRatingMax !== null || scopeRatingOnlyUnrated;
  const scopeQueryPageSize = hasClientSideScopeFilters ? 1000 : pageSize;
  const scopeQueryPage = hasClientSideScopeFilters ? 1 : itemsPage;

  const { data: itemsData, isLoading: isLoadingItems, error: itemsError, refetch: refetchItems } = useQuery({
    queryKey: [
      "categoryItems",
      categoryName,
      navigationKeywordsForScope,
      itemTagKeywords,
      scopeQueryPage,
      scopeQueryPageSize,
      scopeIsPrivate,
    ],
    queryFn: () =>
      itemsApi.getAll(
        categoryName || undefined,
        scopeIsPrivate,
        itemTagKeywords.length > 0 ? itemTagKeywords : undefined,
        undefined,
        undefined,
        scopeQueryPage,
        scopeQueryPageSize,
        {
          navigationKeywords: navigationKeywordsForScope.length > 0 ? navigationKeywordsForScope : undefined,
        }
      ),
    enabled: isItemsViewAllowed,
  });

  const itemIds = (itemsData?.items ?? []).map((i) => i.id);
  const { ratingsMap, isSuccess: ratingsLoaded } = useBulkRatings(
    hasClientSideScopeFilters ? itemIds : []
  );

  const scopeFilteredItems = useMemo(
    () =>
      hasClientSideScopeFilters && itemsData?.items
        ? filterItems({
            items: itemsData.items,
            searchText: scopeSearchText,
            ratingRange: { min: scopeRatingMin, max: scopeRatingMax, includeUnrated: scopeRatingIncludeUnrated, onlyUnrated: scopeRatingOnlyUnrated },
            ratingsMap,
            ratingsLoaded,
          })
        : itemsData?.items ?? [],
    [
      hasClientSideScopeFilters,
      itemsData?.items,
      scopeSearchText,
      scopeRatingMin,
      scopeRatingMax,
      scopeRatingIncludeUnrated,
      scopeRatingOnlyUnrated,
      ratingsMap,
      ratingsLoaded,
    ]
  );

  const scopeDisplayItems = useMemo(() => {
    if (!hasClientSideScopeFilters) return itemsData?.items ?? [];
    const start = (itemsPage - 1) * pageSize;
    return scopeFilteredItems.slice(start, start + pageSize);
  }, [
    hasClientSideScopeFilters,
    itemsData?.items,
    scopeFilteredItems,
    itemsPage,
    pageSize,
  ]);

  const scopeTotalCount = hasClientSideScopeFilters
    ? scopeFilteredItems.length
    : itemsData?.totalCount ?? 0;
  const scopeTotalPages = hasClientSideScopeFilters
    ? Math.ceil(scopeFilteredItems.length / pageSize) || 1
    : itemsData?.totalPages ?? 1;

  const { listenState: listenAllState, handleButton: handleListenAll, isSupported: ttsSupported } = useListenAll(scopeFilteredItems);

  /** All unique keyword names across loaded items, for the in-memory keyword search combobox. */
  const allItemKeywords = useMemo(() => {
    const names = (itemsData?.items ?? []).flatMap(
      (item) => (item.keywords ?? []).map((kw) => kw.name)
    );
    return Array.from(new Set(names)).sort();
  }, [itemsData?.items]);

  useEffect(() => {
    setSortBy(sortFromUrl);
    setCategoriesPage(categoriesPageFromUrl);
    setItemsPage(pageFromUrl);
  }, [sortFromUrl, categoriesPageFromUrl, pageFromUrl]);

  const sortedAndPaginatedCategories = useMemo(() => {
    if (!categoriesData?.categories)
      return { categories: [], totalCount: 0, totalPages: 0, startIndex: 0, endIndex: 0 };
    const sorted = [...categoriesData.categories].sort((a, b) =>
      a.category.localeCompare(b.category)
    );
    const totalCount = sorted.length;
    const totalPages = Math.ceil(totalCount / CATEGORIES_PER_PAGE);
    const startIndex = (categoriesPage - 1) * CATEGORIES_PER_PAGE;
    const endIndex = startIndex + CATEGORIES_PER_PAGE;
    return {
      categories: sorted.slice(startIndex, endIndex),
      totalCount,
      totalPages,
      startIndex: startIndex + 1,
      endIndex: Math.min(endIndex, totalCount),
    };
  }, [categoriesData?.categories, categoriesPage]);

  const sortedKeywords = useMemo(() => {
    if (!keywordsData?.keywords) return [];
    const pathKwLower = new Set(pathKeywordsFromUrl.map((k) => k.toLowerCase()));
    const filtered = keywordsData.keywords.filter(
      (kw) => !pathKwLower.has(kw.name.toLowerCase())
    );
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "rating": {
          const aR = a.averageRating ?? -1;
          const bR = b.averageRating ?? -1;
          if (aR !== bR) return bR - aR;
          return a.name.localeCompare(b.name);
        }
        case "count":
          if (a.itemCount !== b.itemCount) return b.itemCount - a.itemCount;
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });
  }, [keywordsData?.keywords, pathKeywordsFromUrl, sortBy]);

  const setsScopeCount = useMemo(() => {
    if (!categoryName) return null;
    if (pathKeywordsFromUrl.length === 0) {
      return currentCategoryMeta?.count ?? null;
    }
    if (sortedKeywords.length > 0) {
      return sortedKeywords.reduce((sum, keyword) => sum + keyword.itemCount, 0);
    }
    return null;
  }, [categoryName, currentCategoryMeta?.count, pathKeywordsFromUrl.length, sortedKeywords]);

  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    setCategoriesPage(1);
    const p = new URLSearchParams(searchParams);
    p.set("sort", newSort);
    p.set("categoriesPage", "1");
    setSearchParams(p);
  };

  const handleCategoriesPageChange = (newPage: number) => {
    setCategoriesPage(newPage);
    const p = new URLSearchParams(searchParams);
    p.set("categoriesPage", newPage.toString());
    setSearchParams(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Full path = category + nav keywords (path segments); "all" has no path keywords
  const scopePathWithNav = useMemo(
    () =>
      buildCategoryPath(
        categorySlugParam ?? getAllCategoriesSlug(),
        isAllCategoriesSlug(categorySlugParam) ? [] : pathKeywordsFromUrl
      ),
    [categorySlugParam, pathKeywordsFromUrl]
  );
  const currentScopePath = scopePathWithNav;

  const stripEphemeralFilterParams = (p: URLSearchParams) => {
    p.delete("filterType");
    p.delete("search");
    p.delete("ratingMin");
    p.delete("ratingMax");
    p.delete("ratingUnrated");
    p.delete("ratingOnlyUnrated");
  };

  const navigateToSets = (path: string) => {
    const p = new URLSearchParams(searchParams);
    if (path !== currentScopePath) stripEphemeralFilterParams(p);
    p.set("view", "sets");
    p.delete("page");
    p.delete("pagesize");
    p.delete("keywords"); // sets view = nav only; filter keywords cleared
    navigate(`${path}?${p.toString()}`);
  };

  const navigateToItems = (
    path: string,
    resetPage = true,
    tag?: string,
    filterKeywords?: string[]
  ) => {
    const p = new URLSearchParams(searchParams);
    if (path !== currentScopePath) stripEphemeralFilterParams(p);
    p.set("view", "items");
    if (resetPage) p.set("page", "1");
    p.set("pagesize", pageSize.toString());
    if (tag) p.set("tag", tag);
    else p.delete("tag");
    // filterKeywords = query param for narrowing (path has nav scope)
    if (filterKeywords !== undefined) {
      if (filterKeywords.length > 0) p.set("keywords", filterKeywords.join(","));
      else p.delete("keywords");
    }
    navigate(`${path}?${p.toString()}`);
  };

  const dedupeKeywords = (kws: string[]) => {
    const seen = new Set<string>();
    return kws.filter((k) => {
      const lower = k.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
  };

  const navigateToExplore = (
    pathCategorySlug: string,
    kws: string[],
    filteredItems?: { id: string }[]
  ) => {
    const deduped = dedupeKeywords(kws);
    const p = buildScopeFilterQuery();
    p.set("nav", pathKeywordsFromUrl.join(","));
    if (deduped.length > 0) p.set("keywords", deduped.join(","));
    const query = p.toString() ? `?${p.toString()}` : "";
    if (filteredItems && filteredItems.length > 0) {
      sessionStorage.setItem(
        "navigationContext_explore",
        JSON.stringify({
          mode: "explore",
          category: categoryName ?? undefined,
          items: filteredItems,
          currentIndex: 0,
        })
      );
      navigate(`/explore/${pathCategorySlug}/item/${filteredItems[0].id}${query}`);
    } else {
      navigate(`/explore/${pathCategorySlug}${query}`);
    }
  };

  const navigateToQuiz = (
    pathCategorySlug: string,
    kws: string[],
    filteredItems?: { id: string }[]
  ) => {
    const deduped = dedupeKeywords(kws);
    const p = buildScopeFilterQuery();
    p.set("nav", pathKeywordsFromUrl.join(","));
    if (deduped.length > 0) p.set("keywords", deduped.join(","));
    const query = p.toString() ? `?${p.toString()}` : "";
    if (filteredItems && filteredItems.length > 0) {
      const payload = {
        mode: "quiz" as const,
        category: categoryName ?? undefined,
        items: filteredItems,
        currentIndex: 0,
      };
      sessionStorage.setItem("navigationContext_quiz", JSON.stringify(payload));
      sessionStorage.setItem("quiz_scope_items_from_categories", JSON.stringify(payload));
      navigate(`/quiz/${pathCategorySlug}/item/${filteredItems[0].id}${query}`);
    } else {
      navigate(`/quiz/${pathCategorySlug}${query}`);
    }
  };

  const navigateToLearn = (pathCategorySlug: string, kws: string[]) => {
    const deduped = dedupeKeywords(kws);
    const p = buildScopeFilterQuery();
    p.set("nav", pathKeywordsFromUrl.join(","));
    if (deduped.length > 0) p.set("keywords", deduped.join(","));
    const query = p.toString() ? `?${p.toString()}` : "";
    navigate(pathCategorySlug === "all" ? `/learn${query}` : `/learn/${pathCategorySlug}${query}`);
  };

  const navigateToGames = (pathCategorySlug: string, kws: string[]) => {
    const deduped = dedupeKeywords(kws);
    const p = buildScopeFilterQuery();
    p.set("nav", pathKeywordsFromUrl.join(","));
    if (deduped.length > 0) p.set("keywords", deduped.join(","));
    const query = p.toString() ? `?${p.toString()}` : "";
    navigate(pathCategorySlug === "all" ? `/games${query}` : `/games/${pathCategorySlug}${query}`);
  };

  // Sets view: click = add keyword to path (navigate deeper)
  const handleKeywordClick = (keyword: string) => {
    const newPathKeywords = [...pathKeywordsFromUrl, keyword];
    const path = categoryName
      ? buildCategoryPath(categoryNameToSlug(categoryName), newPathKeywords)
      : "/categories";
    navigateToSets(path);
  };

  const buildItemsViewPath = () => scopePathWithNav;

  /** Build query params for scope filters (item type, search, rating) for use in Flashcards/Quiz URLs */
  const buildScopeFilterQuery = () => {
    const p = new URLSearchParams();
    if (scopeFilterType !== "all") p.set("filterType", scopeFilterType);
    if (scopeSearchText) p.set("search", scopeSearchText);
    if (scopeRatingMin !== null) p.set("ratingMin", scopeRatingMin.toString());
    if (scopeRatingMax !== null) p.set("ratingMax", scopeRatingMax.toString());
    if (scopeRatingIncludeUnrated) p.set("ratingUnrated", "1");
    if (scopeRatingOnlyUnrated) p.set("ratingOnlyUnrated", "1");
    return p;
  };

  const buildItemsViewSearchParams = (pageNum: number, pageSizeNum: number) => {
    const p = new URLSearchParams(searchParams);
    p.set("view", "items");
    p.set("page", pageNum.toString());
    p.set("pagesize", pageSizeNum.toString());
    if (scopeFilterType !== "all") p.set("filterType", scopeFilterType);
    if (scopeSearchText) p.set("search", scopeSearchText);
    if (scopeRatingMin !== null) p.set("ratingMin", scopeRatingMin.toString());
    if (scopeRatingMax !== null) p.set("ratingMax", scopeRatingMax.toString());
    if (scopeRatingIncludeUnrated) p.set("ratingUnrated", "1");
    if (scopeRatingOnlyUnrated) p.set("ratingOnlyUnrated", "1");
    if (filterKeywordsFromQuery.length > 0) {
      p.set("keywords", filterKeywordsFromQuery.join(","));
    }
    if (tagFromUrl) p.set("tag", tagFromUrl);
    return p;
  };

  const handlePageChange = (newPage: number) => {
    setItemsPage(newPage);
    const path = buildItemsViewPath();
    const p = buildItemsViewSearchParams(newPage, pageSize);
    navigate(`${path}?${p.toString()}`);
  };

  const handlePageSizeChange = (newSize: number) => {
    const path = buildItemsViewPath();
    const p = buildItemsViewSearchParams(1, newSize);
    navigate(`${path}?${p.toString()}`);
  };

  const listItemsReturnUrl = (categoryName || isAllCategoriesSlug(categorySlugParam))
    ? `${buildItemsViewPath()}?${buildItemsViewSearchParams(itemsPage, pageSize).toString()}`
    : undefined;

  const fromFeatured = searchParams.get("from") === "featured";

  if (isLoading) return <LoadingSpinner />;
  if (error) {
    const errorDetail = getApiErrorMessage(error);
    if (typeof window !== "undefined") {
      console.error("[Categories] Failed to load categories:", errorDetail, error);
    }
    return (
      <ErrorMessage
        message="Failed to load categories"
        errorDetail={errorDetail}
        onRetry={() => refetch()}
      />
    );
  }

  if (categorySlugParam && !isAllCategoriesSlug(categorySlugParam) && !categoryName && categoriesData?.categories) {
    return (
      <div className="px-4 py-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-gray-600 mb-4">Category not found.</p>
          <Link
            to="/categories"
            className="text-indigo-ink hover:text-indigo-ink"
          >
            ← Back to Categories
          </Link>
        </div>
      </div>
    );
  }

  const handleExport = async () => {
    if (!categoryName || keywordsForStudy.length === 0) return;
    setIsExporting(true);
    try {
      const data = await itemsApi.exportItems(categoryName, keywordsForStudy);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const parts = [categoryName.toLowerCase(), ...keywordsForStudy.map((k) => k.toLowerCase())];
      const filename = parts.join(".") + ".json";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  if (activeView === "items" && (categoryName || isAllCategoriesSlug(categorySlugParam))) {
    if (isLoadingItems) return <LoadingSpinner />;
    if (itemsError) {
      const itemsErrorDetail = getApiErrorMessage(itemsError);
      if (typeof window !== "undefined") {
        console.error("[Categories] Failed to load items:", itemsErrorDetail, itemsError);
      }
      return (
        <ErrorMessage
          message="Failed to load items"
          errorDetail={itemsErrorDetail}
          onRetry={() => refetchItems()}
        />
      );
    }

    const scopePath = scopePathWithNav;

    return (
      <>
        <SEO
          title={categoryName ? `${categoryName} Category` : "All categories"}
          description={categoryName ? (currentCategoryMeta?.description ?? `Browse items in the ${categoryName} category on Quizymode.`) : "Browse items across all categories on Quizymode."}
          canonical={`https://www.quizymode.com${scopePath}`}
        />
        <div className="space-y-4 px-3 py-4 sm:px-0">
          {fromFeatured && (
            <Link
              to="/featured"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-400 hover:text-on-panel-muted"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Back to Featured
            </Link>
          )}
          {!categoryName ? (
            <CategoryPageHero
              theme={categoriesOverviewTheme}
              eyebrow="Public question bank"
              title="Browse across all categories"
              description="Search across public questions, narrow by category and keywords, and jump straight into flashcards or quiz mode."
            />
          ) : null}

          <section className="rounded-[30px] border border-on-panel/10 bg-surface/95 p-3 shadow-2xl shadow-slate-950/20 backdrop-blur sm:p-5">
            <ScopeSecondaryBar
              scopeType="category"
              activeMode="list"
              availableModes={categoryAvailableModes}
              onModeChange={(mode) => {
                const path = scopePathWithNav;
                const kw = keywordsForStudy;
                if (mode === "sets") navigateToSets(path);
                else if (mode === "explore") navigateToExplore(categoryName ? categoryNameToSlug(categoryName)! : "all", kw, scopeFilteredItems);
                else if (mode === "quiz") navigateToQuiz(categoryName ? categoryNameToSlug(categoryName)! : "all", kw, scopeFilteredItems);
                else if (mode === "learn") navigateToLearn(categoryName ? categoryNameToSlug(categoryName)! : "all", kw);
                else if (mode === "games") navigateToGames(categoryName ? categoryNameToSlug(categoryName)! : "all", kw);
              }}
              endSlot={
                isAuthenticated && categoryName ? (
                  <div className="hidden items-center gap-2 sm:inline-flex">
                    {keywordsForStudy.length > 0 && (
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="Export items as seed JSON"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        {isExporting ? "Exporting…" : "Export"}
                      </button>
                    )}
                    <Link
                      to={buildAddItemsPathWithParams(
                        categoryName,
                        pathKeywordsFromUrl,
                        filterKeywordsFromQuery
                      )}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                      title="Add items for this category and navigation path"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add
                    </Link>
                  </div>
                ) : null
              }
            />
            <FilterControlBar
              hasActiveFilters={
                !isAllCategoriesSlug(categorySlugParam) ||
                keywordsFromUrlOrQuery.length > 0 ||
                hasActiveScopeFilters
              }
              activeFilterCount={activeScopeFilters.size}
              onOpenFilters={() => setShowFilters(true)}
              showAnswers={showAnswers}
              onToggleShowAnswers={toggleShowAnswers}
              listenAllState={ttsSupported ? listenAllState : undefined}
              onListenAll={ttsSupported ? handleListenAll : undefined}
              middleSlot={
                isAuthenticated && categoryName ? (
                  <div className="inline-flex items-center gap-2 sm:hidden">
                    {keywordsForStudy.length > 0 && (
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="Export items as seed JSON"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        {isExporting ? "Exporting…" : "Export"}
                      </button>
                    )}
                    <Link
                      to={buildAddItemsPathWithParams(
                        categoryName,
                        pathKeywordsFromUrl,
                        filterKeywordsFromQuery
                      )}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                      title="Add items for this category and navigation path"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add
                    </Link>
                  </div>
                ) : null
              }
              onOpenMap={() => setShowMapModal(true)}
            />
            <FilterBottomSheet
              isOpen={showFilters}
              onClose={() => setShowFilters(false)}
              hasActiveFilters={
                !isAllCategoriesSlug(categorySlugParam) ||
                keywordsFromUrlOrQuery.length > 0 ||
                hasActiveScopeFilters
              }
              onClearAll={() => {
                setFilterCategorySlug(categorySlugParam ?? getAllCategoriesSlug());
                const q = searchParams.get("keywords");
                const kws = q ? q.split(",").map((k) => k.trim()).filter(Boolean) : [];
                setFilterKeywords(kws);
                setScopeFilterType("all");
                setScopeSearchText("");
                setScopeRatingMin(null);
                setScopeRatingMax(null);
                setScopeRatingIncludeUnrated(false);
                setScopeRatingOnlyUnrated(false);
                setActiveScopeFilters(new Set());
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    Keywords
                  </label>
                  <KeywordFilterCombobox
                    options={allItemKeywords.filter(
                      (k) =>
                        !filterKeywordsFromQuery.some(
                          (s) => s.toLowerCase() === k.toLowerCase()
                        )
                    )}
                    onAdd={(kw) =>
                      navigateToItems(
                        scopePathWithNav,
                        true,
                        undefined,
                        dedupeKeywords([...filterKeywordsFromQuery, kw])
                      )
                    }
                  />
                  {filterKeywordsFromQuery.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {filterKeywordsFromQuery.map((kw) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => removeTagKeywordFilter(kw)}
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          {kw}
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
                    <select
                      value={filterCategorySlug}
                      onChange={(e) => handleFilterCategoryChange(e.target.value)}
                      className="min-w-[10rem] rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value={getAllCategoriesSlug()}>All categories</option>
                      {categoriesData?.categories?.map((c) => (
                        <option key={c.category} value={categoryNameToSlug(c.category)}>
                          {c.category}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ScopeFilterCombobox
                    label="Primary topic (optional)"
                    value={filterKeywords[0] ?? ""}
                    options={rank1Options}
                    onChange={handleFilterPrimaryTopicChange}
                    placeholder="All topics"
                    disabled={!filterCategorySlug}
                  />
                  <ScopeFilterCombobox
                    label="Subtopic (optional)"
                    value={filterKeywords[1] ?? ""}
                    options={rank2Options}
                    onChange={handleFilterSubtopicChange}
                    placeholder="All subtopics"
                    disabled={!filterKeywords[0]}
                  />
                  <button
                    type="button"
                    onClick={handleApplyFilter}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Apply
                  </button>
                </div>
                <AddFiltersSection
                  availableFilters={["itemType", "search", "rating"].filter(
                    (f) => !activeScopeFilters.has(f as FilterType)
                  ) as FilterType[]}
                  onAddFilter={addScopeFilter}
                />
                {activeScopeFilters.has("itemType") && (
                  <ItemTypeFilter
                    value={scopeFilterType}
                    onChange={setScopeFilterType}
                    onRemove={() => removeScopeFilter("itemType")}
                  />
                )}
                {activeScopeFilters.has("search") && (
                  <SearchFilter
                    value={scopeSearchText}
                    onChange={setScopeSearchText}
                    onRemove={() => removeScopeFilter("search")}
                  />
                )}
                {activeScopeFilters.has("rating") && (
                  <RatingFilter
                    value={{
                      min: scopeRatingMin,
                      max: scopeRatingMax,
                      includeUnrated: scopeRatingIncludeUnrated,
                      onlyUnrated: scopeRatingOnlyUnrated,
                    }}
                    onChange={(v) => {
                      setScopeRatingMin(v.min);
                      setScopeRatingMax(v.max);
                      setScopeRatingIncludeUnrated(v.includeUnrated ?? false);
                      setScopeRatingOnlyUnrated(v.onlyUnrated ?? false);
                    }}
                    onRemove={() => removeScopeFilter("rating")}
                  />
                )}
              </div>
            </FilterBottomSheet>
            <ScopePathHeader
              breadcrumb={
                <Breadcrumb
                  categoryName={categoryName}
                  pathKeywords={categoryName ? pathKeywordsFromUrl : filterKeywordsFromQuery}
                  keywordDescriptions={categoryName ? breadcrumbKeywordDescriptions : undefined}
                  onNavigate={(path) => {
                    if (path.includes("?")) navigate(path);
                    else navigateToSets(path);
                  }}
                />
              }
              count={scopeTotalCount}
              hint="Browse items in this scope."
              endSlot={
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-500">Per page:</label>
                  <select
                    value={pageSize}
                    onChange={(e) =>
                      handlePageSizeChange(parseInt(e.target.value, 10))
                    }
                    className="rounded border-gray-300 text-sm"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              }
            />

            {scopeDisplayItems.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-gray-500">No items found.</p>
              </div>
            ) : (
              <ItemListSection
                items={scopeDisplayItems}
                totalCount={scopeTotalCount}
                page={itemsPage}
                totalPages={scopeTotalPages}
                onPrevPage={() => handlePageChange(Math.max(1, itemsPage - 1))}
                onNextPage={() =>
                  handlePageChange(Math.min(scopeTotalPages, itemsPage + 1))
                }
                showRatingsAndComments
                returnUrl={listItemsReturnUrl}
                showAnswers={showAnswers}
                onKeywordClick={(keywordName) => {
                  const isSelected = filterKeywordsFromQuery.some(
                    (k) => k.toLowerCase() === keywordName.toLowerCase()
                  );
                  const newFilterKeywords = isSelected
                    ? filterKeywordsFromQuery.filter(
                        (k) => k.toLowerCase() !== keywordName.toLowerCase()
                      )
                    : dedupeKeywords([...filterKeywordsFromQuery, keywordName]);
                  navigateToItems(
                    scopePathWithNav,
                    true,
                    undefined,
                    newFilterKeywords
                  );
                }}
                selectedKeywords={itemTagKeywords}
                renderActions={(item) => (
                  <>
                    <Link
                      to={`/items/${item.id}${itemDetailSearch}`}
                      className="inline-flex rounded-md p-1.5 text-indigo-ink hover:bg-indigo-50 sm:p-2"
                      title="View item details"
                    >
                      <EyeIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </Link>
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
            )}
            {manageCollectionsItemId && (
              <ItemCollectionsModal
                isOpen={!!manageCollectionsItemId}
                onClose={() => setManageCollectionsItemId(null)}
                itemId={manageCollectionsItemId}
              />
            )}
          </section>
        </div>
      </>
    );
  }

  if (categoryName && activeView === "sets") {
    if (isLoadingKeywords) return <LoadingSpinner />;

    return (
      <>
        <SEO
          title={`${categoryName} - Sets`}
          description={currentCategoryMeta?.description ?? `Browse sets in the ${categoryName} category on Quizymode.`}
          canonical={`https://www.quizymode.com${scopePathWithNav}${filterKeywordsFromQuery.length > 0 ? `?keywords=${filterKeywordsFromQuery.map(encodeURIComponent).join(",")}` : ""}`}
        />
        <div className="space-y-4 px-3 py-4 sm:px-0">
          {fromFeatured && (
            <Link
              to="/featured"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-400 hover:text-on-panel-muted"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Back to Featured
            </Link>
          )}
          <section className="rounded-[30px] border border-on-panel/10 bg-surface/95 p-3 shadow-2xl shadow-slate-950/20 backdrop-blur sm:p-5">
            <ScopeSecondaryBar
              scopeType="category"
              activeMode="sets"
              availableModes={categoryAvailableModes}
              onModeChange={(mode) => {
                const path = scopePathWithNav;
                const kw = keywordsForStudy;
                if (mode === "list") navigateToItems(path, true, undefined, filterKeywordsFromQuery);
                else if (mode === "explore") navigateToExplore(categoryNameToSlug(categoryName)!, kw);
                else if (mode === "quiz") navigateToQuiz(categoryNameToSlug(categoryName)!, kw);
                else if (mode === "learn") navigateToLearn(categoryNameToSlug(categoryName)!, kw);
                else if (mode === "games") navigateToGames(categoryNameToSlug(categoryName)!, kw);
              }}
              endSlot={
                isAuthenticated ? (
                  <div className="hidden items-center gap-2 sm:inline-flex">
                    {pathKeywordsFromUrl.length >= 1 && (
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="Export items as seed JSON"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        {isExporting ? "Exporting…" : "Export"}
                      </button>
                    )}
                    <Link
                      to={buildAddItemsPathWithParams(
                        categoryName,
                        pathKeywordsFromUrl,
                        filterKeywordsFromQuery
                      )}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                      title="Add items for this category and navigation path"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add
                    </Link>
                  </div>
                ) : null
              }
            />
            <FilterControlBar
              hasActiveFilters={
                !isAllCategoriesSlug(categorySlugParam) ||
                keywordsFromUrlOrQuery.length > 0 ||
                hasActiveScopeFilters
              }
              activeFilterCount={activeScopeFilters.size}
              onOpenFilters={() => setShowFilters(true)}
              middleSlot={
                isAuthenticated ? (
                  <div className="inline-flex items-center gap-2 sm:hidden">
                    {pathKeywordsFromUrl.length >= 1 && (
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-surface px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="Export items as seed JSON"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        {isExporting ? "Exporting…" : "Export"}
                      </button>
                    )}
                    <Link
                      to={buildAddItemsPathWithParams(
                        categoryName,
                        pathKeywordsFromUrl,
                        filterKeywordsFromQuery
                      )}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                      title="Add items for this category and navigation path"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add
                    </Link>
                  </div>
                ) : null
              }
              onOpenMap={() => setShowMapModal(true)}
              sortBy={sortBy}
              onSortChange={(s) => handleSortChange(s as SortOption)}
              sortOptions={[
                { value: "name", label: "Name" },
                { value: "count", label: "Item count" },
                { value: "rating", label: "Rating" },
              ]}
            />
            <FilterBottomSheet
              isOpen={showFilters}
              onClose={() => setShowFilters(false)}
              hasActiveFilters={
                !isAllCategoriesSlug(categorySlugParam) ||
                keywordsFromUrlOrQuery.length > 0 ||
                hasActiveScopeFilters
              }
              onClearAll={() => {
                setFilterCategorySlug(categorySlugParam ?? getAllCategoriesSlug());
                const q = searchParams.get("keywords");
                const kws = q ? q.split(",").map((k) => k.trim()).filter(Boolean) : [];
                setFilterKeywords(kws);
                setScopeFilterType("all");
                setScopeSearchText("");
                setScopeRatingMin(null);
                setScopeRatingMax(null);
                setScopeRatingIncludeUnrated(false);
                setScopeRatingOnlyUnrated(false);
                setActiveScopeFilters(new Set());
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    Keywords
                  </label>
                  <KeywordFilterCombobox
                    options={setsViewKeywordOptions.filter(
                      (k) =>
                        !filterKeywordsFromQuery.some(
                          (s) => s.toLowerCase() === k.toLowerCase()
                        )
                    )}
                    onAdd={addTagKeywordFilter}
                  />
                  {filterKeywordsFromQuery.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {filterKeywordsFromQuery.map((kw) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => removeTagKeywordFilter(kw)}
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          {kw}
                          <XMarkIcon className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
                    <select
                      value={filterCategorySlug}
                      onChange={(e) => handleFilterCategoryChange(e.target.value)}
                      className="min-w-[10rem] rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value={getAllCategoriesSlug()}>All categories</option>
                      {categoriesData?.categories?.map((c) => (
                        <option key={c.category} value={categoryNameToSlug(c.category)}>
                          {c.category}
                        </option>
                      ))}
                    </select>
                  </div>
                  <ScopeFilterCombobox
                    label="Primary topic (optional)"
                    value={filterKeywords[0] ?? ""}
                    options={rank1Options}
                    onChange={handleFilterPrimaryTopicChange}
                    placeholder="All topics"
                    disabled={!filterCategorySlug}
                  />
                  <ScopeFilterCombobox
                    label="Subtopic (optional)"
                    value={filterKeywords[1] ?? ""}
                    options={rank2Options}
                    onChange={handleFilterSubtopicChange}
                    placeholder="All subtopics"
                    disabled={!filterKeywords[0]}
                  />
                  <button
                    type="button"
                    onClick={handleApplyFilter}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Apply
                  </button>
                </div>
                <AddFiltersSection
                  availableFilters={["itemType", "search", "rating"].filter(
                    (f) => !activeScopeFilters.has(f as FilterType)
                  ) as FilterType[]}
                  onAddFilter={addScopeFilter}
                />
                {activeScopeFilters.has("itemType") && (
                  <ItemTypeFilter
                    value={scopeFilterType}
                    onChange={setScopeFilterType}
                    onRemove={() => removeScopeFilter("itemType")}
                  />
                )}
                {activeScopeFilters.has("search") && (
                  <SearchFilter
                    value={scopeSearchText}
                    onChange={setScopeSearchText}
                    onRemove={() => removeScopeFilter("search")}
                  />
                )}
                {activeScopeFilters.has("rating") && (
                  <RatingFilter
                    value={{
                      min: scopeRatingMin,
                      max: scopeRatingMax,
                      includeUnrated: scopeRatingIncludeUnrated,
                      onlyUnrated: scopeRatingOnlyUnrated,
                    }}
                    onChange={(v) => {
                      setScopeRatingMin(v.min);
                      setScopeRatingMax(v.max);
                      setScopeRatingIncludeUnrated(v.includeUnrated ?? false);
                      setScopeRatingOnlyUnrated(v.onlyUnrated ?? false);
                    }}
                    onRemove={() => removeScopeFilter("rating")}
                  />
                )}
              </div>
            </FilterBottomSheet>
            <ScopePathHeader
              breadcrumb={
                <Breadcrumb
                  categoryName={categoryName}
                  pathKeywords={pathKeywordsFromUrl}
                  keywordDescriptions={breadcrumbKeywordDescriptions}
                  onNavigate={navigateToSets}
                />
              }
              count={setsScopeCount}
              hint={
                keywordsFromUrl.length === 0 && currentCategoryMeta?.description
                  ? currentCategoryMeta.description
                  : "Browse subtopics in this scope."
              }
            />

            {sortedKeywords.length > 0 ? (
              <BucketGridView
                buckets={sortedKeywords.map((kw) => ({
                  id: kw.name,
                  label: kw.name.toLowerCase() === "other" ? "Others" : kw.name,
                  itemCount: kw.itemCount,
                  description: kw.description ?? null,
                  averageRating: kw.averageRating ?? null,
                  privateItemCount: kw.privateItemCount ?? 0,
                  backgroundImage: currentCategoryTheme.image,
                  eyebrow: categoryName,
                }))}
                onOpenBucket={(bucket) => {
                  if (isLeaf) {
                    navigateToItems(
                      scopePathWithNav,
                      true,
                      bucket.label,
                      filterKeywordsFromQuery
                    );
                  } else {
                    handleKeywordClick(bucket.id);
                  }
                }}
                columnsClassName="grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
                compact
              />
            ) : effectiveLeaf ? (
              <div className="mb-6">
                <p className="mb-4 text-gray-600">
                  You&apos;ve reached the end of the sets hierarchy. Browse items, explore, or quiz.
                </p>
                <div className="flex flex-wrap gap-2">
                  <ActionButtons
                    onListSets={undefined}
                    onListItems={() =>
                      navigateToItems(scopePathWithNav, true, undefined, filterKeywordsFromQuery)
                    }
                    onExplore={() =>
                      navigateToExplore(categoryNameToSlug(categoryName)!, keywordsForStudy)
                    }
                    onQuiz={() =>
                      navigateToQuiz(categoryNameToSlug(categoryName)!, keywordsForStudy)
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="mb-4 text-gray-500">No sets in this level.</p>
                <ActionButtons
                  onListSets={undefined}
                  onListItems={() =>
                    navigateToItems(scopePathWithNav, true, undefined, filterKeywordsFromQuery)
                  }
                  onExplore={() =>
                    navigateToExplore(categoryNameToSlug(categoryName)!, keywordsForStudy)
                  }
                  onQuiz={() =>
                    navigateToQuiz(categoryNameToSlug(categoryName)!, keywordsForStudy)
                  }
                />
              </div>
            )}
          </section>
        </div>
      <CategoriesMapModal isOpen={showMapModal} onClose={() => setShowMapModal(false)} />
      </>
    );
  }

  return (
    <>
      <SEO
        title="Categories"
        description="Browse all categories on Quizymode. Find flashcards and quizzes organized by topic."
        canonical="https://www.quizymode.com/categories"
      />
      <div className="bg-panel-deep text-on-panel">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 flex flex-col gap-3">
          <div className="rounded-[24px] border border-on-panel/10 bg-panel-deep/70 px-5 py-4 shadow-xl shadow-slate-950/25">
            <h1 className="text-2xl font-semibold text-on-panel">Categories</h1>
            <p className="mt-1 text-sm leading-6 text-on-panel-muted">
              Browse the public question bank by category and jump into sets, flashcards, or quiz mode.
            </p>
          </div>

          <section className="rounded-[24px] border border-on-panel/10 bg-panel-deep/70 p-4 shadow-xl shadow-slate-950/25">
            <div className="flex justify-end pb-2">
              <button
                type="button"
                onClick={() => setShowMapModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-on-panel/20 bg-on-panel/8 px-3 py-1.5 text-sm font-medium text-on-panel transition hover:bg-on-panel/14 hover:text-on-panel"
              >
                Map
              </button>
            </div>
            <BucketGridView
              buckets={sortedAndPaginatedCategories.categories.map((cat) => ({
                id: cat.category,
                label: cat.category,
                itemCount: cat.count,
                description: cat.description ?? cat.shortDescription ?? null,
                averageRating: cat.averageStars ?? null,
                backgroundImage: getCategoryThemeByName(cat.category).image,
              }))}
              columnsClassName="grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4"
              compact
              onOpenBucket={(bucket) =>
                navigateToSets(`/categories/${categoryNameToSlug(bucket.label)}`)
              }
            />

            {sortedAndPaginatedCategories.categories.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-slate-400">No categories found.</p>
              </div>
            )}

            {sortedAndPaginatedCategories.totalPages > 1 && (
              <Pagination
                currentPage={categoriesPage}
                totalPages={sortedAndPaginatedCategories.totalPages}
                onPageChange={handleCategoriesPageChange}
              />
            )}
          </section>
        </div>
      </div>
      <CategoriesMapModal isOpen={showMapModal} onClose={() => setShowMapModal(false)} />
    </>
  );
};

function CategoryPageHero({
  theme,
  eyebrow,
  title,
  description,
}: {
  theme: { image: string; accent: string; accentSoft: string };
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-on-panel/10 bg-panel-deep shadow-2xl shadow-slate-950/30">
      <img
        src={theme.image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.88)_0%,rgba(2,6,23,0.62)_42%,rgba(2,6,23,0.35)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18)_0%,transparent_34%)]" />
      <div className="relative px-6 py-7 sm:px-8 sm:py-9">
        <div
          className="inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] backdrop-blur"
          style={{
            borderColor: `${theme.accent}55`,
            backgroundColor: `${theme.accent}22`,
            color: theme.accentSoft,
          }}
        >
          {eyebrow}
        </div>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-on-panel sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-on-panel sm:text-base">
          {description}
        </p>
      </div>
    </section>
  );
}

function breadcrumbKeywordLabel(kw: string): string {
  return kw.toLowerCase() === "other" ? "Others" : kw;
}

function Breadcrumb({
  categoryName,
  pathKeywords,
  keywordDescriptions,
  onNavigate,
}: {
  categoryName: string | null;
  pathKeywords: string[];
  keywordDescriptions?: (string | null)[];
  onNavigate: (path: string) => void;
}) {
  const pathSegments: { label: string; path: string; description?: string | null }[] = [];
  if (categoryName) {
    const slug = categoryNameToSlug(categoryName);
    pathSegments.push({ label: categoryName, path: buildCategoryPath(slug, []) });
    pathKeywords.forEach((kw, i) => {
      pathSegments.push({
        label: breadcrumbKeywordLabel(kw),
        path: buildCategoryPath(slug, pathKeywords.slice(0, i + 1)),
        description: keywordDescriptions?.[i] ?? undefined,
      });
    });
  } else {
    pathSegments.push({ label: "All categories", path: "/categories" });
    pathKeywords.forEach((kw, i) => {
      pathSegments.push({
        label: breadcrumbKeywordLabel(kw),
        path: `/categories?view=items&keywords=${pathKeywords.slice(0, i + 1).map(encodeURIComponent).join(",")}`,
      });
    });
  }

  return (
    <nav className="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
      {pathSegments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <BreadcrumbChevron className="h-4 w-4 text-gray-400" />}
          <button
            onClick={() => onNavigate(seg.path)}
            className="text-indigo-ink hover:text-indigo-ink"
            title={seg.description ?? undefined}
          >
            {seg.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function ActionButtons({
  onListSets,
  onListItems,
  onExplore,
  onQuiz,
}: {
  onListSets?: () => void;
  onListItems: () => void;
  onExplore: () => void;
  onQuiz: () => void;
}) {
  return (
    <>
      {onListSets && (
        <button
          onClick={onListSets}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-indigo-ink bg-indigo-50 rounded-md hover:bg-indigo-100"
        >
          <Squares2X2Icon className="h-4 w-4" />
          List sets
        </button>
      )}
      <button
        onClick={onListItems}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-emerald-600 bg-emerald-50 rounded-md hover:bg-emerald-100"
      >
        <ListBulletIcon className="h-4 w-4" />
        List items
      </button>
      <button
        onClick={onExplore}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-indigo-ink bg-indigo-50 rounded-md hover:bg-indigo-100"
      >
        <MagnifyingGlassIcon className="h-4 w-4" />
        Flashcards mode
      </button>
      <button
        onClick={onQuiz}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 rounded-md hover:bg-purple-100"
      >
        <AcademicCapIcon className="h-4 w-4" />
        Quiz mode
      </button>
    </>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between border-t border-on-panel/10 px-1 pt-4">
      <div className="flex flex-1 justify-between sm:hidden">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="inline-flex items-center rounded-md border border-on-panel/20 bg-on-panel/8 px-4 py-2 text-sm font-medium text-on-panel-muted hover:bg-on-panel/12 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="ml-3 inline-flex items-center rounded-md border border-on-panel/20 bg-on-panel/8 px-4 py-2 text-sm font-medium text-on-panel-muted hover:bg-on-panel/12 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <p className="text-sm text-slate-400">
          Page <span className="font-medium text-on-panel">{currentPage}</span> of{" "}
          <span className="font-medium text-on-panel">{totalPages}</span>
        </p>
        <nav className="isolate inline-flex -space-x-px rounded-md">
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="inline-flex items-center rounded-l-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-on-panel/20 hover:bg-on-panel/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) =>
                p === 1 ||
                p === totalPages ||
                Math.abs(p - currentPage) <= 1
            )
            .map((p, idx, arr) => {
              const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
              return (
                <div key={p} className="flex items-center">
                  {showEllipsis && (
                    <span className="px-4 py-2 text-sm text-slate-500 ring-1 ring-inset ring-on-panel/20">
                      ...
                    </span>
                  )}
                  <button
                    onClick={() => onPageChange(p)}
                    className={`inline-flex items-center px-4 py-2 text-sm font-semibold ${
                      p === currentPage
                        ? "z-10 bg-indigo-600 text-white"
                        : "text-on-panel-muted ring-1 ring-inset ring-on-panel/20 hover:bg-on-panel/10"
                    }`}
                  >
                    {p}
                  </button>
                </div>
              );
            })}
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="inline-flex items-center rounded-r-md px-2 py-2 text-slate-400 ring-1 ring-inset ring-on-panel/20 hover:bg-on-panel/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </nav>
      </div>
    </div>
  );
}

export default CategoriesPage;
