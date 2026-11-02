import { useCallback, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { collectionsApi } from "@/api/collections";
import { studyPlansApi, type StudyPlanDto } from "@/api/studyPlans";
import { useAuth } from "@/contexts/AuthContext";
import { readGuestHistory, type GuestRunSummary } from "@/features/guestHistory/guestHistoryStorage";
import { useLocalVersion } from "@/features/interests/useInterests";
import { readLocalStudyPlans, removeLocalStudyPlan, upsertLocalStudyPlan, type LocalStudyPlan } from "./localStudyPlans";
import { ACTIVITY_LOOKBACK_DAYS, type PlanInput } from "./studyPlanSteps";

export const STUDY_PLANS_QUERY_KEY = (userId: string | null | undefined) => ["study-plans", userId] as const;

const DAY_MS = 86_400_000;

/** A plan as the UI consumes it, for signed-in and guest visitors alike. */
export interface PlanView extends PlanInput {
  collectionId: string;
  /** False when the collection is gone or no longer visible. */
  available: boolean;
  collectionName: string | null;
}

export type StudyPlanErrorKind = "limit" | "notFound" | "invalidDate" | "network";

export class StudyPlanError extends Error {
  readonly kind: StudyPlanErrorKind;

  constructor(kind: StudyPlanErrorKind) {
    super(kind);
    this.name = "StudyPlanError";
    this.kind = kind;
  }
}

export function toStudyPlanError(error: unknown): StudyPlanError {
  if (error instanceof StudyPlanError) return error;
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 404) return new StudyPlanError("notFound");
    if (status === 400) {
      const title = (error.response?.data as { title?: string } | undefined)?.title;
      return new StudyPlanError(title === "StudyPlans.LimitReached" ? "limit" : "invalidDate");
    }
  }
  return new StudyPlanError("network");
}

/** First Learn and latest Learn/Quiz of one collection in a guest's browser history, within 14 days before the plan was created. */
export function guestActivity(
  collectionId: string,
  createdAt: string,
  runs: readonly GuestRunSummary[],
): Pick<PlanInput, "firstLearnAt" | "lastActivityAt"> {
  const from = Date.parse(createdAt) - ACTIVITY_LOOKBACK_DAYS * DAY_MS;
  let firstLearn: number | null = null;
  let last: number | null = null;
  for (const run of runs) {
    if (run.source?.kind !== "collection" || run.source.collectionId.toLowerCase() !== collectionId.toLowerCase()) continue;
    const at = Date.parse(run.completedAt);
    if (!Number.isFinite(at) || at < from) continue;
    if (last === null || at > last) last = at;
    if (run.mode === "learn" && (firstLearn === null || at < firstLearn)) firstLearn = at;
  }
  return {
    firstLearnAt: firstLearn === null ? null : new Date(firstLearn).toISOString(),
    lastActivityAt: last === null ? null : new Date(last).toISOString(),
  };
}

function fromServer(plan: StudyPlanDto): PlanView {
  return {
    collectionId: plan.collectionId,
    available: plan.available,
    collectionName: plan.collectionName,
    itemCount: plan.itemCount,
    testDate: plan.testDate,
    createdAt: plan.createdAt,
    firstLearnAt: plan.firstLearnAt,
    lastActivityAt: plan.lastActivityAt,
  };
}

function sortPlans(plans: PlanView[]): PlanView[] {
  return [...plans].sort((a, b) => a.testDate.localeCompare(b.testDate) || a.createdAt.localeCompare(b.createdAt));
}

/** Create, change and remove a plan: through the API when signed in, in this browser otherwise. */
export function useStudyPlanActions() {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = isAuthenticated && !isLoading;

  const save = useCallback(
    async (collectionId: string, testDate: string): Promise<void> => {
      if (signedIn) {
        try {
          await studyPlansApi.upsert(collectionId, testDate);
        } catch (error) {
          throw toStudyPlanError(error);
        }
        await queryClient.invalidateQueries({ queryKey: ["study-plans"] });
        return;
      }
      const outcome = upsertLocalStudyPlan(collectionId, testDate);
      if (outcome === "limit") throw new StudyPlanError("limit");
      if (outcome === "storage") throw new StudyPlanError("network");
    },
    [signedIn, queryClient],
  );

  const remove = useCallback(
    async (collectionId: string): Promise<void> => {
      if (signedIn) {
        try {
          await studyPlansApi.remove(collectionId);
        } catch (error) {
          throw toStudyPlanError(error);
        }
        await queryClient.invalidateQueries({ queryKey: ["study-plans"] });
        return;
      }
      if (!removeLocalStudyPlan(collectionId)) throw new StudyPlanError("network");
    },
    [signedIn, queryClient],
  );

  return { save, remove, isGuest: !signedIn };
}

function useServerPlans(signedIn: boolean, userId: string | null) {
  return useQuery({
    queryKey: STUDY_PLANS_QUERY_KEY(userId),
    queryFn: () => studyPlansApi.list(),
    enabled: signedIn,
    retry: false,
  });
}

/**
 * Every plan of the visitor for the Home Today lane. Signed in: the account's plans. Guest: this browser's plans,
 * each with its collection looked up like Continue (AC 3.0.16): only an HTTP 404 yields an "unavailable" plan; any
 * other lookup failure hides that plan. A failing plans query yields no plans at all (fail soft).
 */
export function useStudyPlans(): { plans: PlanView[]; ready: boolean } {
  const { isAuthenticated, isLoading, userId } = useAuth();
  const localVersion = useLocalVersion();
  const signedIn = isAuthenticated && !isLoading;
  const server = useServerPlans(signedIn, userId);

  const localPlans = useMemo<LocalStudyPlan[]>(
    () => (signedIn || isLoading ? [] : readLocalStudyPlans()),
    // localVersion re-reads browser storage after a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signedIn, isLoading, localVersion],
  );
  const runs = useMemo(
    () => (signedIn || isLoading ? [] : readGuestHistory()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signedIn, isLoading, localVersion],
  );
  const lookups = useQueries({
    queries: localPlans.map((plan) => ({
      queryKey: ["study-plan-collection", plan.collectionId],
      queryFn: () => collectionsApi.getById(plan.collectionId),
      enabled: !signedIn && !isLoading,
      retry: false,
      staleTime: 5 * 60 * 1000,
    })),
  });

  return useMemo(() => {
    if (signedIn) return { plans: sortPlans((server.data ?? []).map(fromServer)), ready: server.isSuccess };
    const views: PlanView[] = [];
    localPlans.forEach((plan, index) => {
      const lookup = lookups[index];
      const activity = guestActivity(plan.collectionId, plan.createdAt, runs);
      const base = { collectionId: plan.collectionId, testDate: plan.testDate, createdAt: plan.createdAt, ...activity };
      if (lookup?.data) {
        views.push({ ...base, available: true, collectionName: lookup.data.name, itemCount: lookup.data.itemCount ?? 0 });
      } else if (lookup?.isError && isAxiosError(lookup.error) && lookup.error.response?.status === 404) {
        views.push({ ...base, available: false, collectionName: null, itemCount: 0 });
      }
    });
    return { plans: sortPlans(views), ready: true };
  }, [signedIn, server.data, server.isSuccess, localPlans, runs, lookups]);
}

export interface CollectionPlan extends PlanInput {
  collectionId: string;
}

/** The visitor's plan for one collection (collection page). `loading` is true while a signed-in plan list is unknown. */
export function useCollectionStudyPlan(collectionId: string | undefined): { plan: CollectionPlan | null; loading: boolean } {
  const { isAuthenticated, isLoading, userId } = useAuth();
  const localVersion = useLocalVersion();
  const signedIn = isAuthenticated && !isLoading;
  const server = useServerPlans(signedIn, userId);

  return useMemo(() => {
    if (!collectionId || isLoading) return { plan: null, loading: isLoading };
    const same = (id: string) => id.toLowerCase() === collectionId.toLowerCase();
    if (signedIn) {
      const found = (server.data ?? []).find((plan) => plan.available && same(plan.collectionId));
      return { plan: found ? fromServer(found) : null, loading: server.isPending };
    }
    const local = readLocalStudyPlans().find((plan) => same(plan.collectionId));
    if (!local) return { plan: null, loading: false };
    return {
      plan: { collectionId: local.collectionId, testDate: local.testDate, createdAt: local.createdAt, itemCount: 0, ...guestActivity(local.collectionId, local.createdAt, readGuestHistory()) },
      loading: false,
    };
    // localVersion re-reads browser storage after a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, isLoading, signedIn, server.data, server.isPending, localVersion]);
}
