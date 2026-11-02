import { isAxiosError } from "axios";
import { studyPlansApi } from "@/api/studyPlans";
import { clearLocalStudyPlans, readLocalStudyPlans } from "./localStudyPlans";
import { daysUntil } from "./studyPlanSteps";

/**
 * After sign-in, moves test-date plans made in this browser into the account (#364, AC 3.23.9). The account wins per
 * collection (an existing server plan is never changed), plans whose date passed are skipped, and the server's cap of
 * 5 stops the pass. A rejected plan (400/404) is dropped. The local copy is cleared unless a network or 5xx failure
 * means a later session should retry. Silent: no UI. Returns true when at least one plan was saved.
 */
export async function claimLocalStudyPlans(now: Date = new Date()): Promise<boolean> {
  const local = readLocalStudyPlans();
  if (local.length === 0) return false;

  let serverIds: Set<string>;
  try {
    serverIds = new Set((await studyPlansApi.list()).map((plan) => plan.collectionId.toLowerCase()));
  } catch {
    return false;
  }

  let saved = false;
  let retryLater = false;
  const candidates = local.filter(
    (plan) => (daysUntil(plan.testDate, now) ?? -1) >= 0 && !serverIds.has(plan.collectionId.toLowerCase()),
  );
  for (const plan of candidates) {
    try {
      await studyPlansApi.upsert(plan.collectionId, plan.testDate);
      saved = true;
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 400) {
        const title = (error as { response?: { data?: { title?: string } } }).response?.data?.title;
        if (title === "StudyPlans.LimitReached") break;
        continue;
      }
      if (status === 404) continue;
      retryLater = true;
      break;
    }
  }

  if (!retryLater) clearLocalStudyPlans();
  return saved;
}
