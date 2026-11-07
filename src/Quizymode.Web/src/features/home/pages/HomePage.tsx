import { isTopicPath, topicLabel, topicParts, topicNavigationSearch } from "@/features/interests/topicPaths";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { SEO } from "@/components/SEO";
import { categoriesApi } from "@/api/categories";
import { collectionsApi } from "@/api/collections";
import { featuredApi, type FeaturedSetDto } from "@/api/featured";
import type { CollectionDiscoverItem } from "@/types/api";
import { useAuth } from "@/contexts/AuthContext";
import { buildCollectionPath } from "@/utils/collectionPath";
import { buildCategoryPath } from "@/utils/categorySlug";
import { getCategoryThemeBySlug } from "@/features/categories/categoryThemes";
import { GuestHistoryCard } from "@/features/guestHistory/GuestHistoryCard";
import { buildGamePath } from "@/features/games/gameScope";
import { useInterests } from "@/features/interests/useInterests";
import { TopicOnboardingPrompt } from "../TopicOnboardingPrompt";
import { PersonalizedLanes } from "../PersonalizedLanes";
import {
  homeCategoryCards,
} from "../homePageData";

const CARD_GRADIENTS = [
  { primary: "#0f2027", secondary: "#203a43", accent: "#7dd3fc" },
  { primary: "#1a1a2e", secondary: "#16213e", accent: "#a78bfa" },
  { primary: "#0d1b2a", secondary: "#1b2a3b", accent: "#34d399" },
  { primary: "#1c0a00", secondary: "#3d1a00", accent: "#fb923c" },
  { primary: "#0a0a14", secondary: "#1e1b4b", accent: "#f472b6" },
  { primary: "#042f2e", secondary: "#134e4a", accent: "#2dd4bf" },
];

function publicCollectionCardImage(index: number): string {
  const g = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg width="1200" height="720" viewBox="0 0 1200 720" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="720" gradientUnits="userSpaceOnUse">
          <stop stop-color="${g.primary}" />
          <stop offset="1" stop-color="${g.secondary}" />
        </linearGradient>
      </defs>
      <rect width="1200" height="720" fill="url(#bg)" />
      <circle cx="1000" cy="140" r="180" fill="${g.accent}" fill-opacity="0.12" />
      <circle cx="160" cy="580" r="200" fill="${g.accent}" fill-opacity="0.07" />
      <path d="M0 480L300 300L500 420L800 200L1100 380L1200 280" stroke="${g.accent}" stroke-opacity="0.18" stroke-width="48" stroke-linecap="round" />
    </svg>
  `)}`;
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatItemCount(count: number) {
  return `${numberFormatter.format(count)} item${count === 1 ? "" : "s"}`;
}

interface CatalogLanesProps {
  countsByCategory: Map<string, number>;
  featuredSets: FeaturedSetDto[];
  publicCollections: CollectionDiscoverItem[];
}

/** The catalog browse lanes; shown directly on the full Home and inside "Explore all topics" on the focused Home. */
function CatalogLanes({ countsByCategory, featuredSets, publicCollections }: CatalogLanesProps) {
  return (
    <>
      {/* ── Categories lane ── */}
      <section className="rounded-[24px] border border-white/10 bg-panel-deep/70 p-2 sm:p-3 shadow-xl shadow-slate-950/25">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-ink">
            Categories
          </div>
          <Link
            to="/categories"
            className="flex items-center gap-1 text-xs font-semibold text-sky-400 transition hover:text-sky-ink"
          >
            Show all
            <ArrowRightIcon className="h-3 w-3" />
          </Link>
        </div>

        {/* Horizontal carousel: 2 visible by default, 3 on md, 4 on xl */}
        <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {homeCategoryCards.map((category) => {
            const liveCount = countsByCategory.get(category.slug);

            return (
              <Link
                key={category.slug}
                to={`/categories/${category.slug}`}
                className="group relative min-w-0 shrink-0 overflow-hidden rounded-[18px] border border-white/10 bg-panel/90 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/50
                  basis-[calc(50%-0.3125rem)] md:basis-[calc((100%-0.833rem)/3)] xl:basis-[calc((100%-1.875rem)/4)]"
              >
                <img
                  src={category.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.05)_0%,rgba(2,6,23,0.78)_100%)]" />
                <div className="relative flex h-full min-h-[80px] flex-col justify-between p-3 text-white sm:min-h-[96px]">
                  <div className="flex justify-end">
                    {liveCount != null && (
                      <span className="rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                        {formatItemCount(liveCount)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">{category.name}</h3>
                    <ArrowRightIcon className="h-4 w-4 shrink-0 text-sky-300 transition group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Featured Sets lane ── */}
      {featuredSets.length > 0 && (
        <section className="rounded-[24px] border border-white/10 bg-panel-deep/70 p-2 sm:p-3 shadow-xl shadow-slate-950/25">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-ink">
              Featured Sets
            </div>
            <Link
              to="/featured"
              className="flex items-center gap-1 text-xs font-semibold text-sky-400 transition hover:text-sky-ink"
            >
              Show all
              <ArrowRightIcon className="h-3 w-3" />
            </Link>
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {featuredSets.map((set) => {
              const keywords = [set.navKeyword1, set.navKeyword2].filter(Boolean) as string[];
              const path = buildCategoryPath(set.categorySlug, keywords);
              const image = getCategoryThemeBySlug(set.categorySlug).image;

              return (
                <Link
                  key={set.id}
                  to={path}
                  className="group relative min-w-0 shrink-0 basis-[calc(50%-0.3125rem)] overflow-hidden rounded-[18px] border border-white/10 bg-panel/90 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/50 md:basis-[calc((100%-0.833rem)/3)] xl:basis-[calc((100%-1.875rem)/4)]"
                >
                  <img
                    src={image}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.05)_0%,rgba(2,6,23,0.78)_100%)]" />
                  <div className="relative flex h-full min-h-[80px] flex-col justify-between p-3 sm:min-h-[96px]">
                    <div className="flex justify-end">
                      <span className="rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                        {set.categorySlug}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">{set.displayName}</h3>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-sky-300 transition group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recently Added Collections lane ── */}
      {publicCollections.length > 0 && (
        <section className="rounded-[24px] border border-white/10 bg-panel-deep/70 p-2 sm:p-3 shadow-xl shadow-slate-950/25">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-ink">
              Recently Added Collections
            </div>
            <Link
              to="/collections?tab=discover"
              className="flex items-center gap-1 text-xs font-semibold text-sky-400 transition hover:text-sky-ink"
            >
              Show all
              <ArrowRightIcon className="h-3 w-3" />
            </Link>
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {publicCollections.map((collection, index) => (
              <Link
                key={collection.id}
                to={buildCollectionPath(collection.id, collection.name)}
                className="group relative min-w-0 shrink-0 basis-[calc(50%-0.3125rem)] overflow-hidden rounded-[18px] border border-white/10 bg-panel/90 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/50 md:basis-[calc((100%-0.833rem)/3)] xl:basis-[calc((100%-1.875rem)/4)]"
              >
                <img
                  src={publicCollectionCardImage(index)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.05)_0%,rgba(2,6,23,0.78)_100%)]" />
                <div className="relative flex h-full min-h-[80px] flex-col justify-between p-3 sm:min-h-[96px]">
                  <div className="flex justify-end">
                    <span className="rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      {collection.itemCount} {collection.itemCount === 1 ? "item" : "items"}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">{collection.name}</h3>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-sky-300 transition group-hover:translate-x-1" />
                    </div>
                    {collection.description && (
                      <p className="mt-0.5 text-xs text-[#cbd5e1] line-clamp-2">
                        {collection.description}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const laneClass = "rounded-[24px] border border-white/10 bg-panel-deep/70 p-2 sm:p-3 shadow-xl shadow-slate-950/25";
const categoryNames = new Map(homeCategoryCards.map((card) => [card.slug, card.name]));

const HomePage = () => {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { interests, status: interestsStatus } = useInterests();
  // Pending only until a signed-in visitor's topics query first settles; a later refetch (after an error) keeps the
  // full layout instead of flipping back to the skeleton, which would remount the lanes and refetch in a loop.
  const [interestsSettled, setInterestsSettled] = useState(false);
  if (!interestsSettled && !isAuthLoading && isAuthenticated && interestsStatus !== "loading") setInterestsSettled(true);
  // Guests with browser-local picks go straight to the focused layout; only a signed-in visitor waits for their topics.
  const layout: "pending" | "focused" | "full" =
    isAuthLoading && interests.length === 0
      ? "pending"
      : !isAuthLoading && isAuthenticated && interestsStatus === "loading" && !interestsSettled
        ? "pending"
        : interestsStatus === "error"
          ? "full"
          : interests.length > 0
            ? "focused"
            : "full";
  const focused = layout === "focused";
  const firstTopic = interests.find(isTopicPath);
  const { data: categoriesData } = useQuery({
    queryKey: ["home", "categories"],
    queryFn: () => categoriesApi.getAll(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: publicCollectionsData } = useQuery({
    queryKey: ["home", "public-collections"],
    queryFn: () => collectionsApi.discover({ pageSize: 6 }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: featuredData } = useQuery({
    queryKey: ["home", "featured"],
    queryFn: () => featuredApi.get(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const featuredSets = featuredData?.sets ?? [];

  const publicCollections = publicCollectionsData?.items ?? [];

  const countsByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const category of categoriesData?.categories ?? []) {
      map.set(category.category.toLowerCase(), category.count);
    }
    return map;
  }, [categoriesData?.categories]);

  return (
    <>
      <SEO
        title="Quizymode"
        description="Play a free five-question quiz with no account needed, then browse Quizymode categories, featured sets, and public collections."
        canonical="https://www.quizymode.com"
        structuredData={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Quizymode",
          url: "https://www.quizymode.com",
          description:
            "Play a free five-question quiz with no account needed, then explore categories, featured sets, and public collections.",
        }}
      />

      <div className="bg-panel-deep text-on-panel">
        <section className="relative bg-[radial-gradient(circle_at_top,var(--qm-shell-a)_0%,var(--qm-shell-b)_42%,var(--qm-shell-c)_100%)]">
          {/* Decorative shapes are rotated/skewed past the section edges; clip them so narrow or zoomed viewports never scroll sideways (#151). */}
          <div
            aria-hidden="true"
            data-testid="home-hero-decor"
            className="absolute inset-0 overflow-hidden pointer-events-none opacity-30"
          >
            <div className="absolute inset-y-0 left-[-8%] w-1/3 skew-x-[-24deg] bg-on-panel/5" />
            <div className="absolute inset-y-0 left-[24%] w-24 rotate-12 bg-sky-400/20 blur-3xl" />
            <div className="absolute inset-y-0 right-[18%] w-20 -rotate-12 bg-indigo-300/20 blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-7xl px-1.5 py-2 sm:px-6 lg:px-8 flex flex-col gap-2">

            {/* ── Hero card ── */}
            <section className="rounded-[24px] border border-on-panel/12 bg-on-panel/8 p-2 shadow-2xl shadow-slate-950/30 backdrop-blur sm:flex sm:items-center sm:justify-between sm:gap-6 sm:px-5 sm:py-3">
              <div className="max-w-3xl">
                <h1 className="text-xl font-semibold tracking-tight text-on-panel sm:text-2xl lg:text-[1.65rem] lg:leading-snug">
                  Learn something new in five questions.
                </h1>
                <p className="mt-1 text-xs font-semibold text-sky-ink">Learn, Test and Review are free.</p>
                {!focused && (
                  <p className="mt-1.5 max-w-2xl text-xs leading-5 text-on-panel-muted lg:text-sm">
                    Five quick questions, from flags to space to AI. Then pick what to explore next.
                  </p>
                )}
                {(!focused || !isAuthenticated) && <p className="mt-1 text-xs font-semibold text-sky-ink">No account needed.</p>}
              </div>
              <div className="mt-3 flex shrink-0 items-center sm:mt-0">
                <Link
                  to="/start"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#38bdf8_0%,#2563eb_100%)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:scale-[1.02] hover:shadow-sky-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:w-auto"
                >
                  Play a 5-question quiz
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </section>

            <GuestHistoryCard />

            {layout === "pending" && (
              <div role="status" className="flex flex-col gap-2">
                <span className="sr-only">Loading your home</span>
                <div aria-hidden="true" className={`${laneClass} h-24 animate-pulse bg-on-panel/10`} />
                <div aria-hidden="true" className={`${laneClass} h-24 animate-pulse bg-on-panel/10`} />
              </div>
            )}

            {layout === "full" && (
              <>
                <TopicOnboardingPrompt />
                <PersonalizedLanes featuredSets={featuredSets} />
                <CatalogLanes
                  countsByCategory={countsByCategory}
                  featuredSets={featuredSets}
                  publicCollections={publicCollections}
                />
              </>
            )}

            {focused && (
              <>
                <PersonalizedLanes featuredSets={featuredSets} focused />
                {firstTopic && (
                  <div>
                    <Link
                      to={buildGamePath({ kind: "category", category: topicParts(firstTopic).category, navigationKeywords: topicParts(firstTopic).navigationKeywords, filterKeywords: [], search: topicNavigationSearch(firstTopic) })}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-on-panel/15 bg-on-panel/5 px-3 py-1.5 text-xs font-semibold text-on-panel hover:bg-on-panel/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                    >
                      Play a game in {topicLabel(firstTopic, categoryNames)}
                      <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  </div>
                )}
                <details className="group">
                  <summary
                    className={`${laneClass} flex min-h-[44px] cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-ink">Explore all topics</span>
                    <ChevronDownIcon className="h-4 w-4 text-sky-ink transition group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <CatalogLanes
                      countsByCategory={countsByCategory}
                      featuredSets={featuredSets}
                      publicCollections={publicCollections}
                    />
                  </div>
                </details>
              </>
            )}

          </div>
        </section>
      </div>
    </>
  );
};

export default HomePage;
