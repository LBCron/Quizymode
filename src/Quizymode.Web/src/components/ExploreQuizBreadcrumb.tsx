import { Link } from "react-router-dom";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { buildCategoryPath } from "@/utils/categorySlug";

interface ExploreQuizBreadcrumbProps {
  mode: "explore" | "quiz";
  categorySlug: string;
  categoryDisplayName: string;
  keywords: string[];
  /** Optional descriptions for each keyword (same order as keywords). Shown as tooltip when present. */
  keywordDescriptions?: (string | null)[];
  onNavigate: (path: string) => void;
}

/** Display label for "other" keyword in breadcrumbs. */
function breadcrumbLabel(kw: string): string {
  return kw.toLowerCase() === "other" ? "Others" : kw;
}

/** Breadcrumb links go to the categories boxes view (sets view), not back into explore/quiz. */
export function ExploreQuizBreadcrumb({
  mode: _mode, // eslint-disable-line @typescript-eslint/no-unused-vars
  categorySlug,
  categoryDisplayName,
  keywords,
  keywordDescriptions,
  onNavigate,
}: ExploreQuizBreadcrumbProps) {
  const segments: { label: string; path: string; description?: string | null }[] = [
    { label: categoryDisplayName, path: buildCategoryPath(categorySlug, []) },
  ];
  keywords.forEach((kw, i) => {
    segments.push({
      label: breadcrumbLabel(kw),
      path: buildCategoryPath(categorySlug, keywords.slice(0, i + 1)),
      description: keywordDescriptions?.[i] ?? undefined,
    });
  });

  return (
    <nav className="flex items-center gap-1 text-xs text-gray-600 overflow-x-auto whitespace-nowrap">
      <Link to="/categories" className="text-indigo-ink hover:text-indigo-ink">
        Categories
      </Link>
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRightIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <button
            onClick={() => onNavigate(seg.path)}
            className="text-indigo-ink hover:text-indigo-ink"
            type="button"
            title={seg.description ?? undefined}
          >
            {seg.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
