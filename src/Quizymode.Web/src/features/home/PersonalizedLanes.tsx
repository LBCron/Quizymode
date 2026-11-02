import { topicBrowsePath, topicLabel, topicParts } from "@/features/interests/topicPaths";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/contexts/AuthContext";
import { collectionsApi } from "@/api/collections";
import type { FeaturedSetDto } from "@/api/featured";
import { dailyQuizApi, interestsApi, reviewQueueApi } from "@/api/learningLoop";
import { studySessionsApi } from "@/api/studySessions";
import { buildCategoryPath } from "@/utils/categorySlug";
import { getCategoryThemeBySlug } from "@/features/categories/categoryThemes";
import { readGuestHistory, readGuestRunSummary } from "@/features/guestHistory/guestHistoryStorage";
import { buildGuestPracticePath, describeGuestTopic } from "@/features/guestHistory/guestHistoryLinks";
import { computeStreak, readDailyCompletions, utcToday } from "@/features/learningLoop/localLearningState";
import { useInterests, useLocalVersion } from "@/features/interests/useInterests";
import { useTopicEditor } from "@/features/interests/topicEditorContext";
import { DAILY_QUIZ_QUERY_KEY } from "@/features/learningLoop/pages/DailyQuizPage";
import { StudyPlanTodayCard } from "@/features/studyPlans/StudyPlanTodayCard";
import { useStudyPlanActions, useStudyPlans } from "@/features/studyPlans/useStudyPlans";
import { MAX_LANE_PLANS, daysUntil } from "@/features/studyPlans/studyPlanSteps";
import { homeCategoryCards } from "./homePageData";
import { rankPersonalizedHome, type ActivityRun } from "./personalization";

const laneClass = "rounded-[24px] border border-white/10 bg-slate-950/70 p-2 sm:p-3 shadow-xl shadow-slate-950/25";
const eyebrowClass = "text-xs font-semibold uppercase tracking-[0.22em] text-sky-300";
const pillLinkClass =
  "inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200";
const categoryNames = new Map(homeCategoryCards.map((card) => [card.slug, card.name]));
const knownCategories = homeCategoryCards.map((card) => card.slug);

function ContinueCard({ run }: { run: ActivityRun }) {
  const source = run.source!;
  const collectionId = source.kind === "collection" ? source.collectionId : null;
  const collection = useQuery({
    queryKey: ["home", "continue-collection", collectionId],
    queryFn: () => collectionsApi.getById(collectionId!),
    enabled: !!collectionId,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  // Unavailable collections are not offered (same rule as AC 3.0.16).
  if (source.kind === "collection" && collection.isError) return null;
  const label = source.kind === "collection" ? collection.data?.name ?? "Collection" : describeGuestTopic(source);
  return (
    <Link to={buildGuestPracticePath(source, run.mode)} className={pillLinkClass}>
      {label}
      <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

function FeaturedCard({ set }: { set: FeaturedSetDto }) {
  const keywords = [set.navKeyword1, set.navKeyword2].filter(Boolean) as string[];
  return (
    <Link
      to={buildCategoryPath(set.categorySlug, keywords)}
      className="group relative min-w-0 shrink-0 basis-[calc(50%-0.3125rem)] overflow-hidden rounded-[18px] border border-white/10 bg-slate-900/90 transition duration-200 hover:-translate-y-0.5 hover:border-sky-300/50 md:basis-[calc((100%-0.833rem)/3)] xl:basis-[calc((100%-1.875rem)/4)]"
    >
      <img src={getCategoryThemeBySlug(set.categorySlug).image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.05)_0%,rgba(2,6,23,0.78)_100%)]" />
      <div className="relative flex min-h-[80px] flex-col justify-between p-3 sm:min-h-[96px]">
        <span className="self-end rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
          {categoryNames.get(set.categorySlug) ?? set.categorySlug}
        </span>
        <h3 className="text-sm font-semibold text-white">{set.displayName}</h3>
      </div>
    </Link>
  );
}

/**
 * Personalized home lanes (epic #197): today's daily quiz and review, Continue (signed in), For you and Recommended
 * next (#116). Every query fails soft: a lane whose data is missing is simply not shown (AC 3.0.4).
 */
export function PersonalizedLanes({ featuredSets, focused = false }: { featuredSets: FeaturedSetDto[]; focused?: boolean }) {
  const { isAuthenticated, isLoading: isAuthLoading, userId } = useAuth();
  const topicEditor = useTopicEditor();
  const localVersion = useLocalVersion();
  const signedIn = isAuthenticated && !isAuthLoading;
  const identityKey = signedIn ? `user:${userId ?? "unknown"}` : "guest";

  const { interests: explicitInterests } = useInterests();
  const sessionsQuery = useQuery({
    queryKey: ["home", "sessions", userId],
    queryFn: () => studySessionsApi.list(20),
    enabled: signedIn,
    retry: false,
  });
  const reviewQuery = useQuery({
    queryKey: ["review-queue", "summary", userId],
    queryFn: () => reviewQueueApi.getSummary(),
    enabled: signedIn,
    retry: false,
  });
  const dailyQuery = useQuery({
    queryKey: [...DAILY_QUIZ_QUERY_KEY, identityKey],
    queryFn: () => dailyQuizApi.get(),
    enabled: signedIn,
    retry: false,
    staleTime: 60 * 1000,
  });
  const studyPlans = useStudyPlans();
  const planActions = useStudyPlanActions();
  const popularQuery = useQuery({
    queryKey: ["home", "popular-categories"],
    queryFn: () => interestsApi.popularCategories(),
    enabled: !isAuthLoading,
    retry: false,
    staleTime: 30 * 60 * 1000,
  });

  const runs = useMemo<ActivityRun[]>(() => {
    if (signedIn) {
      return (sessionsQuery.data ?? [])
        .map((session) => readGuestRunSummary(session))
        .filter((summary): summary is NonNullable<typeof summary> => summary !== null)
        .map((summary) => ({ completedAt: summary.completedAt, source: summary.source, mode: summary.mode }));
    }
    return isAuthLoading ? [] : readGuestHistory().map((summary) => ({ completedAt: summary.completedAt, source: summary.source, mode: summary.mode }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, isAuthLoading, sessionsQuery.data, localVersion]);

  const ranked = useMemo(
    () =>
      rankPersonalizedHome({
        explicitInterests,
        runs,
        featuredSets,
        popularCategories: popularQuery.data ?? [],
        knownCategories: [...knownCategories, ...explicitInterests.map(path => topicParts(path).category)],
        categoryNames,
        focused,
      }),
    [explicitInterests, runs, featuredSets, popularQuery.data, focused],
  );

  const today = utcToday();
  const localDaily = signedIn ? [] : readDailyCompletions();
  const dailyDone = signedIn ? Boolean(dailyQuery.data?.completion) : localDaily.some((entry) => entry.date === today);
  const streak = signedIn ? dailyQuery.data?.streak ?? 0 : computeStreak(localDaily.map((entry) => entry.date), today);
  const review = signedIn ? reviewQuery.data : undefined;

  if (isAuthLoading) return null;

  // Plans whose test date passed are hidden before the top 3 are chosen (#364); the rest are summarized as "+N more".
  const planNow = new Date();
  const upcomingPlans = studyPlans.plans.filter((plan) => (daysUntil(plan.testDate, planNow) ?? -1) >= 0);
  const shownPlans = upcomingPlans.slice(0, MAX_LANE_PLANS);
  const morePlans = upcomingPlans.length - shownPlans.length;

  return (
    <>
      <section className={laneClass} aria-labelledby="home-today-heading">
        <h2 id="home-today-heading" className={`${eyebrowClass} mb-1.5`}>Today</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {shownPlans.map((plan) => (
            <StudyPlanTodayCard
              key={plan.collectionId}
              plan={plan}
              isGuest={!signedIn}
              now={planNow}
              onRemove={(collectionId) => void planActions.remove(collectionId).catch(() => undefined)}
            />
          ))}
          {morePlans > 0 && (
            <p className="col-span-full text-xs text-slate-300">
              +{morePlans} more test {morePlans === 1 ? "plan" : "plans"}
            </p>
          )}
          <Link
            to="/daily"
            className="flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-gradient-to-br from-amber-500/20 to-rose-500/10 p-3 hover:border-amber-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            <span>
              <span className="block text-sm font-semibold text-white">Daily quiz</span>
              <span className="block text-xs text-slate-200">
                {dailyDone ? "Done for today. New set at midnight UTC." : "Five new questions, same for everyone today."}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-amber-200">
              {streak > 0 ? `🔥 ${streak}-day streak` : dailyDone ? "✓ Done" : "Play"}
            </span>
          </Link>
          {review && review.totalCount > 0 && (
            <Link
              to="/review"
              className="flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-gradient-to-br from-indigo-500/20 to-sky-500/10 p-3 hover:border-sky-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
            >
              <span>
                <span className="block text-sm font-semibold text-white">Review mistakes</span>
                <span className="block text-xs text-slate-200">
                  {review.dueCount > 0
                    ? `${review.dueCount} ${review.dueCount === 1 ? "question" : "questions"} due`
                    : "Nothing due right now"}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-sky-200">{review.dueCount > 0 ? "Review" : "Later"}</span>
            </Link>
          )}
        </div>
      </section>

      {signedIn && ranked.continueRuns.length > 0 && (
        <section className={laneClass} aria-labelledby="home-continue-heading">
          <h2 id="home-continue-heading" className={`${eyebrowClass} mb-1.5`}>Continue</h2>
          <div className="flex flex-wrap gap-2">
            {ranked.continueRuns.map((run) => (
              <ContinueCard key={`${run.completedAt}:${run.source?.kind}`} run={run} />
            ))}
          </div>
        </section>
      )}

      <section className={laneClass} aria-labelledby="home-for-you-heading">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <h2 id="home-for-you-heading" className={eyebrowClass}>For you</h2>
          <button
            type="button"
            onClick={topicEditor.open}
            className="min-h-[44px] px-2 text-xs font-semibold text-sky-400 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
          >
            Change topics
          </button>
        </div>
        {ranked.forYou.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {ranked.forYou.map((entry) => (
              <Link key={entry.slug} to={topicBrowsePath(entry.slug)} className={pillLinkClass}>
                {topicLabel(entry.slug, categoryNames)}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-300">Choose a few topics and we'll put them first.</p>
        )}
        {ranked.recommended.length > 0 && (
          <>
            <h3 className="mt-3 mb-1.5 text-xs font-semibold text-slate-300">
              {ranked.isColdStart ? "Popular right now" : "Recommended next"}
            </h3>
            <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ranked.recommended.map((set) => (
                <FeaturedCard key={set.id} set={set} />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
