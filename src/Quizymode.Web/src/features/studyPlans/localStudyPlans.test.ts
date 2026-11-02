import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { GUEST_HISTORY_STORAGE_KEY } from "@/features/guestHistory/guestHistoryStorage";
import { LEARNING_STATE_CHANGED_EVENT } from "@/features/learningLoop/localLearningState";
import {
  STUDY_PLANS_STORAGE_KEY,
  clearLocalStudyPlans,
  readLocalStudyPlans,
  removeLocalStudyPlan,
  upsertLocalStudyPlan,
} from "./localStudyPlans";
import { addLocalDays } from "./studyPlanSteps";

const now = new Date(2026, 10, 2, 12);
const day = (offset: number) => addLocalDays(now, offset);
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("localStudyPlans", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("round-trips a plan and keeps createdAt when the date changes", () => {
    expect(upsertLocalStudyPlan(id(1), day(5), now)).toBe("ok");
    const later = new Date(2026, 10, 3, 12);
    expect(upsertLocalStudyPlan(id(1), day(8), later)).toBe("ok");

    expect(readLocalStudyPlans()).toEqual([{ collectionId: id(1), testDate: day(8), createdAt: now.toISOString() }]);
  });

  it("allows at most 5 upcoming plans but still lets an existing one change", () => {
    for (let i = 1; i <= 5; i += 1) expect(upsertLocalStudyPlan(id(i), day(i + 2), now)).toBe("ok");

    expect(upsertLocalStudyPlan(id(6), day(4), now)).toBe("limit");
    expect(upsertLocalStudyPlan(id(2), day(20), now)).toBe("ok");
    expect(readLocalStudyPlans()).toHaveLength(5);
  });

  it("drops plans whose test date passed on the next write, so they never block the cap", () => {
    for (let i = 1; i <= 5; i += 1) upsertLocalStudyPlan(id(i), day(1), now);
    const nextWeek = new Date(2026, 10, 9, 12);

    expect(upsertLocalStudyPlan(id(6), addLocalDays(nextWeek, 3), nextWeek)).toBe("ok");
    expect(readLocalStudyPlans().map((plan) => plan.collectionId)).toEqual([id(6)]);
  });

  it("removes one plan and notifies listeners", () => {
    upsertLocalStudyPlan(id(1), day(5), now);
    upsertLocalStudyPlan(id(2), day(6), now);
    const listener = vi.fn();
    window.addEventListener(LEARNING_STATE_CHANGED_EVENT, listener);

    expect(removeLocalStudyPlan(id(1), now)).toBe(true);

    window.removeEventListener(LEARNING_STATE_CHANGED_EVENT, listener);
    expect(listener).toHaveBeenCalled();
    expect(readLocalStudyPlans().map((plan) => plan.collectionId)).toEqual([id(2)]);
  });

  it("tolerates missing, corrupt, wrong-version and oversized documents", () => {
    expect(readLocalStudyPlans()).toEqual([]);
    window.localStorage.setItem(STUDY_PLANS_STORAGE_KEY, "{not json");
    expect(readLocalStudyPlans()).toEqual([]);
    window.localStorage.setItem(STUDY_PLANS_STORAGE_KEY, JSON.stringify({ version: 2, plans: [] }));
    expect(readLocalStudyPlans()).toEqual([]);
    window.localStorage.setItem(STUDY_PLANS_STORAGE_KEY, JSON.stringify({ version: 1, plans: "x".repeat(5000) }));
    expect(readLocalStudyPlans()).toEqual([]);
  });

  it("keeps only well-formed, de-duplicated entries", () => {
    const good = { collectionId: id(1), testDate: day(3), createdAt: now.toISOString() };
    window.localStorage.setItem(
      STUDY_PLANS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        plans: [
          good,
          { ...good, testDate: day(9) },
          { collectionId: "nope", testDate: day(3), createdAt: now.toISOString() },
          { collectionId: id(2), testDate: "2026-13-45", createdAt: now.toISOString() },
          { collectionId: id(3), testDate: day(3), createdAt: "yesterday-ish" },
          null,
        ],
      }),
    );

    expect(readLocalStudyPlans()).toEqual([good]);
  });

  it("reports a storage failure instead of throwing", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(upsertLocalStudyPlan(id(1), day(3), now)).toBe("storage");
    vi.restoreAllMocks();
  });

  it("is not touched by Clear guest history, which removes only quizymode.guest.v1", async () => {
    const { clearGuestHistory } = await import("@/features/guestHistory/guestHistoryStorage");
    upsertLocalStudyPlan(id(1), day(3), now);
    window.localStorage.setItem(GUEST_HISTORY_STORAGE_KEY, JSON.stringify({ version: 2, summaries: [] }));

    clearGuestHistory();

    expect(window.localStorage.getItem(GUEST_HISTORY_STORAGE_KEY)).toBeNull();
    expect(readLocalStudyPlans()).toHaveLength(1);
  });

  it("clearLocalStudyPlans removes the whole document", () => {
    upsertLocalStudyPlan(id(1), day(3), now);
    clearLocalStudyPlans();
    expect(window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY)).toBeNull();
  });
});
