import { categoryNameToSlug } from "@/utils/categorySlug";

function parseKeywordList(
  value: string | null | undefined,
  options?: { slugify?: boolean }
): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .map((keyword) =>
      options?.slugify ? categoryNameToSlug(keyword) : keyword
    )
    .filter(Boolean);
}

export function getStudyScopeKeywords(
  searchParams: URLSearchParams,
  hasCategoryScope: boolean
): {
  keywords: string[];
  navigationKeywords: string[];
  filterKeywords: string[];
} {
  const keywords = parseKeywordList(searchParams.get("keywords"));

  if (!hasCategoryScope) {
    return {
      keywords,
      navigationKeywords: [],
      filterKeywords: keywords,
    };
  }

  const navigationKeywords = searchParams.has("nav")
    ? parseKeywordList(searchParams.get("nav"), { slugify: true })
    : keywords;
  const navigationKeywordSet = new Set(
    navigationKeywords.map((keyword) => keyword.toLowerCase())
  );
  const filterKeywords = keywords.filter(
    (keyword) => !navigationKeywordSet.has(keyword.toLowerCase())
  );

  return {
    keywords,
    navigationKeywords,
    filterKeywords,
  };
}

/** Deep-link `size` (explore-next cards, #462): a whole number clamped to 1-50; anything else is ignored. */
export function parseSizeParam(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Math.min(50, Math.max(1, parseInt(raw, 10)));
}
