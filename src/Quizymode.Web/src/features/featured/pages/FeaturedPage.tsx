import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { featuredApi } from "@/api/featured";
import type { FeaturedSetDto, FeaturedCollectionDto } from "@/api/featured";
import { buildCategoryPath } from "@/utils/categorySlug";
import { buildCollectionPath } from "@/utils/collectionPath";
import { SEO } from "@/components/SEO";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import {
  AcademicCapIcon,
  FolderOpenIcon,
  ClockIcon,
  BarsArrowDownIcon,
} from "@heroicons/react/24/outline";

type Tab = "sets" | "collections";
type SortBy = "name" | "modified";

function formatDate(iso: string | null): string {
  if (!iso) return "No items yet";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SetCard({ item, onNavigate }: { item: FeaturedSetDto; onNavigate: () => void }) {
  const keywords = [item.navKeyword1, item.navKeyword2].filter(Boolean) as string[];
  const subtitle = [item.categorySlug, ...keywords].join(" › ");

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="w-full text-left overflow-hidden rounded-2xl border border-on-panel/10 bg-panel-raised/60 p-6 shadow-sm shadow-slate-950/30 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-on-panel/20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <AcademicCapIcon className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
        <span className="ml-auto text-xs font-medium uppercase tracking-wider text-on-panel-muted bg-indigo-500/15 px-2 py-0.5 rounded-full">
          Set
        </span>
      </div>
      <h3 className="text-lg font-semibold text-on-panel mb-1">{item.displayName}</h3>
      <p className="text-sm text-slate-400 mb-1">{subtitle}</p>
      <p className="text-sm text-slate-500 mb-4">
        {item.itemCount} {item.itemCount === 1 ? "item" : "items"}
      </p>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <ClockIcon className="h-3.5 w-3.5" />
        <span>Updated {formatDate(item.lastModifiedAt)}</span>
      </div>
    </button>
  );
}

function CollectionCard({ item, onNavigate }: { item: FeaturedCollectionDto; onNavigate: () => void }) {
  return (
    <button
      type="button"
      onClick={onNavigate}
      disabled={!item.collectionId}
      className="w-full text-left overflow-hidden rounded-2xl border border-on-panel/10 bg-panel-raised/60 p-6 shadow-sm shadow-slate-950/30 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-on-panel/20 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <FolderOpenIcon className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <span className="ml-auto text-xs font-medium uppercase tracking-wider text-amber-ink bg-amber-500/15 px-2 py-0.5 rounded-full">
          Collection
        </span>
      </div>
      <h3 className="text-lg font-semibold text-on-panel mb-1">{item.displayName}</h3>
      {item.description && (
        <p className="text-sm text-slate-400 line-clamp-2 mb-2">{item.description}</p>
      )}
      <p className="text-sm text-slate-500 mb-4">
        {item.itemCount} {item.itemCount === 1 ? "item" : "items"}
      </p>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <ClockIcon className="h-3.5 w-3.5" />
        <span>Updated {formatDate(item.lastModifiedAt)}</span>
      </div>
    </button>
  );
}

const FeaturedPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("sets");
  const [sortBy, setSortBy] = useState<SortBy>("modified");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["featured"],
    queryFn: () => featuredApi.get(),
    staleTime: 60_000,
  });

  const sortedSets = useMemo(() => {
    const sets = data?.sets ?? [];
    return [...sets].sort((a, b) => {
      if (sortBy === "name") return a.displayName.localeCompare(b.displayName);
      const ta = a.lastModifiedAt ? new Date(a.lastModifiedAt).getTime() : 0;
      const tb = b.lastModifiedAt ? new Date(b.lastModifiedAt).getTime() : 0;
      return tb - ta;
    });
  }, [data?.sets, sortBy]);

  const sortedCollections = useMemo(() => {
    const cols = data?.collections ?? [];
    return [...cols].sort((a, b) => {
      if (sortBy === "name") return a.displayName.localeCompare(b.displayName);
      const ta = a.lastModifiedAt ? new Date(a.lastModifiedAt).getTime() : 0;
      const tb = b.lastModifiedAt ? new Date(b.lastModifiedAt).getTime() : 0;
      return tb - ta;
    });
  }, [data?.collections, sortBy]);

  const handleSetClick = (item: FeaturedSetDto) => {
    const keywords = [item.navKeyword1, item.navKeyword2].filter(Boolean) as string[];
    navigate(buildCategoryPath(item.categorySlug, keywords) + "?from=featured");
  };

  const handleCollectionClick = (item: FeaturedCollectionDto) => {
    if (!item.collectionId) return;
    navigate(buildCollectionPath(item.collectionId, item.displayName) + "?from=featured");
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load featured content" onRetry={() => refetch()} />;

  const isEmpty = activeTab === "sets" ? sortedSets.length === 0 : sortedCollections.length === 0;

  return (
    <>
      <SEO
        title="Featured"
        description="Hand-picked quiz sets and collections curated by the Quizymode team."
        canonical="https://www.quizymode.com/featured"
      />
      <div className="bg-panel-deep text-on-panel min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 space-y-4">
          <div className="rounded-[24px] border border-on-panel/10 bg-panel-deep/70 px-5 py-4 shadow-sm shadow-slate-950/25">
            <h1 className="mb-1 text-2xl font-semibold text-on-panel">Featured</h1>
            <p className="max-w-2xl text-sm leading-6 text-on-panel-muted">
              Hand-picked sets and collections. Click any card to start exploring or quizzing.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex overflow-hidden rounded-xl border border-on-panel/15 bg-panel-raised/50 shadow-sm">
              {(["sets", "collections"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 text-sm font-medium capitalize ${
                    activeTab === tab
                      ? "bg-indigo-700 text-white"
                      : "bg-transparent text-on-panel-muted hover:bg-on-panel/10"
                  }`}
                >
                  {tab === "sets" ? "Sets" : "Collections"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <BarsArrowDownIcon className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-400">Sort:</span>
              <div className="flex overflow-hidden rounded-lg border border-on-panel/15 bg-panel-raised/50">
                {(["modified", "name"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSortBy(s)}
                    className={`px-3 py-1.5 text-sm ${
                      sortBy === s
                        ? "bg-panel-raised text-on-panel"
                        : "text-on-panel-muted hover:bg-on-panel/10"
                    }`}
                  >
                    {s === "modified" ? "Last Modified" : "Name"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isEmpty ? (
            <div className="rounded-[28px] border border-dashed border-on-panel/20 bg-panel-raised/30 py-16 text-center">
              <p className="text-slate-400">
                No featured {activeTab} yet. Check back soon.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeTab === "sets"
                ? sortedSets.map((item) => (
                    <SetCard
                      key={item.id}
                      item={item}
                      onNavigate={() => handleSetClick(item)}
                    />
                  ))
                : sortedCollections.map((item) => (
                    <CollectionCard
                      key={item.id}
                      item={item}
                      onNavigate={() => handleCollectionClick(item)}
                    />
                  ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default FeaturedPage;
