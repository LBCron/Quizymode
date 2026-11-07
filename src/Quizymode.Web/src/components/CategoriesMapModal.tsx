import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { categoriesApi } from "@/api/categories";
import { keywordsApi } from "@/api/keywords";
import type { TaxonomyCategory, TaxonomyL1, TaxonomyL2 } from "@/api/taxonomy";
import { useTaxonomy } from "@/features/topics/useTaxonomy";
import { categoryNameToSlug } from "@/utils/categorySlug";
import LoadingSpinner from "./LoadingSpinner";
import ErrorMessage from "./ErrorMessage";

interface CategoriesMapModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type CategoriesMapNode = {
  id: string;
  kind: "category" | "group" | "keyword";
  label: string;
  count: number | null;
  description: string | null;
  href: string;
  children: CategoriesMapNode[];
};

function createKeywordNode(
  categorySlug: string,
  groupSlug: string,
  keyword: TaxonomyL2
): CategoriesMapNode {
  return {
    id: `${categorySlug}/${groupSlug}/${keyword.slug}`,
    kind: "keyword",
    label: keyword.slug,
    count: null,
    description: keyword.description,
    href: `/categories/${categorySlug}/${encodeURIComponent(groupSlug)}/${encodeURIComponent(keyword.slug)}`,
    children: [],
  };
}

function createGroupNode(
  categorySlug: string,
  group: TaxonomyL1
): CategoriesMapNode {
  return {
    id: `${categorySlug}/${group.slug}`,
    kind: "group",
    label: group.slug,
    count: null,
    description: group.description,
    href: `/categories/${categorySlug}/${encodeURIComponent(group.slug)}`,
    children: group.keywords.map((keyword) =>
      createKeywordNode(categorySlug, group.slug, keyword)
    ),
  };
}

function createCategoryNode(
  category: TaxonomyCategory
): CategoriesMapNode {
  return {
    id: category.slug,
    kind: "category",
    label: category.name,
    count: null,
    description: category.description ?? null,
    href: `/categories/${category.slug}`,
    children: category.groups.map((group) =>
      createGroupNode(category.slug, group)
    ),
  };
}

function collectExpandableNodeIds(nodes: CategoriesMapNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.children.length === 0) {
      return [];
    }

    return [node.id, ...collectExpandableNodeIds(node.children)];
  });
}

function TreeNode({
  node,
  expandedNodeIds,
  countOverrides,
  onToggle,
  onNavigate,
}: {
  node: CategoriesMapNode;
  expandedNodeIds: Set<string>;
  countOverrides: Map<string, number>;
  onToggle: (nodeId: string) => void;
  onNavigate: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = hasChildren && expandedNodeIds.has(node.id);
  const effectiveCount = countOverrides.get(node.id) ?? node.count;

  return (
    <li className="space-y-0.5">
      <div className="flex items-start gap-1.5 py-0.5">
        <div className="mt-0.5 w-5 shrink-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              className="inline-flex h-4 w-4 items-center justify-center text-slate-500 transition hover:text-sky-700"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.label}`}
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          ) : (
            <span className="block h-4 w-4 text-on-panel-muted" aria-hidden>
              .
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 text-sm leading-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              to={node.href}
              onClick={onNavigate}
              className={`transition hover:text-sky-700 ${
                node.kind === "category"
                  ? "font-semibold text-slate-900"
                  : "font-medium text-slate-800"
              }`}
            >
              {node.label}
            </Link>
            {node.description ? (
              <span className="min-w-0 text-xs text-slate-500">
                / {node.description}
              </span>
            ) : null}
            {effectiveCount != null ? (
              <span
                className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-semibold text-slate-800"
                aria-label={`${effectiveCount} items`}
                title={`${effectiveCount} items`}
              >
                {effectiveCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {isExpanded && (
        <ul className="ml-2 space-y-0.5 border-l border-slate-200 pl-2">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              expandedNodeIds={expandedNodeIds}
              countOverrides={countOverrides}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const CategoriesMapModal = ({
  isOpen,
  onClose,
}: CategoriesMapModalProps) => {
  const { data: taxonomyData, isLoading, error, refetch } = useTaxonomy();
  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    staleTime: 5 * 60 * 1000,
  });

  const categoryDefinitions = useMemo(
    () =>
      (taxonomyData?.categories ?? []).map((category) => {
        const matchedCategoryName =
          (categoriesData?.categories ?? []).find(
            (item) =>
              categoryNameToSlug(item.category).toLowerCase() ===
              category.slug.toLowerCase()
          )?.category ?? category.name ?? null;

        return {
          category,
          queryCategoryName: matchedCategoryName,
        };
      }),
    [categoriesData?.categories, taxonomyData?.categories]
  );

  const nodes = useMemo(
    () =>
      categoryDefinitions.map(({ category, queryCategoryName }) =>
        createCategoryNode({
          ...category,
          name: queryCategoryName ?? category.name,
        })
      ),
    [categoryDefinitions]
  );

  const categoryCountOverrides = useMemo(() => {
    const map = new Map<string, number>();

    for (const category of categoriesData?.categories ?? []) {
      map.set(categoryNameToSlug(category.category), category.count);
    }

    return map;
  }, [categoriesData?.categories]);

  const rank1Queries = useQueries({
    queries: categoryDefinitions.map((definition) => ({
      queryKey: [
        "keywords",
        "rank1",
        definition.queryCategoryName ?? definition.category.slug,
      ],
      queryFn: () =>
        keywordsApi.getNavigationKeywords(definition.queryCategoryName!, undefined),
      enabled: isOpen && !!definition.queryCategoryName,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const rank2Definitions = useMemo(
    () =>
      categoryDefinitions.flatMap((definition) =>
        definition.queryCategoryName
          ? definition.category.groups.map((group) => ({
              categoryName: definition.queryCategoryName,
              categorySlug: definition.category.slug,
              groupSlug: group.slug,
              keywords: group.keywords,
            }))
          : []
      ),
    [categoryDefinitions]
  );

  const rank2Queries = useQueries({
    queries: rank2Definitions.map((definition) => ({
      queryKey: [
        "keywords",
        "rank2",
        definition.categoryName,
        definition.groupSlug,
      ],
      queryFn: () =>
        keywordsApi.getNavigationKeywords(definition.categoryName, [
          definition.groupSlug,
        ]),
      enabled: isOpen,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const liveCountOverrides = useMemo(() => {
    const map = new Map<string, number>(categoryCountOverrides);

    categoryDefinitions.forEach((definition, index) => {
      const rank1Data = rank1Queries[index]?.data;
      for (const group of definition.category.groups) {
        const match = rank1Data?.keywords?.find(
          (keyword) => keyword.name.toLowerCase() === group.slug.toLowerCase()
        );
        if (match) {
          map.set(`${definition.category.slug}/${group.slug}`, match.itemCount);
        }
      }
    });

    rank2Definitions.forEach((definition, index) => {
      const rank2Data = rank2Queries[index]?.data;
      for (const keyword of definition.keywords) {
        const match = rank2Data?.keywords?.find(
          (item) => item.name.toLowerCase() === keyword.slug.toLowerCase()
        );
        if (match) {
          map.set(
            `${definition.categorySlug}/${definition.groupSlug}/${keyword.slug}`,
            match.itemCount
          );
        }
      }
    });

    return map;
  }, [
    categoryCountOverrides,
    rank1Queries,
    rank2Definitions,
    rank2Queries,
    categoryDefinitions,
  ]);

  const expandableNodeIds = useMemo(
    () => collectExpandableNodeIds(nodes),
    [nodes]
  );

  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedNodeIds(new Set());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-panel-deep/72 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="categories-map-title"
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-slate-50 shadow-2xl shadow-slate-950/30"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-surface px-4 py-3 sm:px-5">
          <h2
            id="categories-map-title"
            className="text-base font-semibold text-slate-900"
          >
            Categories map
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpandedNodeIds(new Set(expandableNodeIds))}
              className="rounded border border-slate-300 bg-surface px-2 py-1 text-xs text-slate-700"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setExpandedNodeIds(new Set())}
              className="rounded border border-slate-300 bg-surface px-2 py-1 text-xs text-slate-700"
            >
              Collapse all
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-surface text-slate-600"
              aria-label="Close categories map"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-surface px-4 py-3 sm:px-5">
          {isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <ErrorMessage
              message="Could not load the categories map."
              errorDetail={error instanceof Error ? error.message : undefined}
              onRetry={() => {
                void refetch();
              }}
            />
          ) : nodes.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-surface/80 px-6 py-12 text-center">
              <p className="text-base font-medium text-slate-900">
                No taxonomy categories are available right now.
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Try again later or reload the page.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {nodes.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  expandedNodeIds={expandedNodeIds}
                  countOverrides={liveCountOverrides}
                  onToggle={(nodeId) => {
                    setExpandedNodeIds((previous) => {
                      const next = new Set(previous);

                      if (next.has(nodeId)) {
                        next.delete(nodeId);
                      } else {
                        next.add(nodeId);
                      }

                      return next;
                    });
                  }}
                  onNavigate={onClose}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoriesMapModal;
