import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse } from "axios";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { studyPlansApi, type StudyPlanDto } from "@/api/studyPlans";
import { claimLocalStudyPlans } from "./claimLocalStudyPlans";
import { STUDY_PLANS_STORAGE_KEY, readLocalStudyPlans, upsertLocalStudyPlan } from "./localStudyPlans";
import { addLocalDays } from "./studyPlanSteps";

vi.mock("@/api/studyPlans", () => ({ studyPlansApi: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() } }));

const now = new Date();
const day = (offset: number) => addLocalDays(now, offset);
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function serverPlan(collectionId: string, testDate: string): StudyPlanDto {
  return {
    collectionId,
    available: true,
    collectionName: "Set",
    itemCount: 3,
    testDate,
    createdAt: now.toISOString(),
    firstLearnAt: null,
    lastActivityAt: null,
  };
}

function httpError(status: number, title?: string): AxiosError {
  return new AxiosError("failed", "ERR", undefined, undefined, { status, data: { title } } as AxiosResponse);
}

describe("claimLocalStudyPlans", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installMemoryLocalStorage();
    vi.mocked(studyPlansApi.list).mockResolvedValue([]);
    vi.mocked(studyPlansApi.upsert).mockImplementation(async (collectionId, testDate) => serverPlan(collectionId, testDate));
  });

  it("does nothing without local plans", async () => {
    expect(await claimLocalStudyPlans(now)).toBe(false);
    expect(studyPlansApi.list).not.toHaveBeenCalled();
  });

  it("uploads local plans and clears the local copy", async () => {
    upsertLocalStudyPlan(id(1), day(4), now);
    upsertLocalStudyPlan(id(2), day(6), now);

    expect(await claimLocalStudyPlans(now)).toBe(true);

    expect(studyPlansApi.upsert).toHaveBeenCalledWith(id(1), day(4));
    expect(studyPlansApi.upsert).toHaveBeenCalledWith(id(2), day(6));
    expect(window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY)).toBeNull();
  });

  it("the account wins: an existing server plan is never changed", async () => {
    upsertLocalStudyPlan(id(1), day(4), now);
    upsertLocalStudyPlan(id(2), day(6), now);
    vi.mocked(studyPlansApi.list).mockResolvedValue([serverPlan(id(1), day(10))]);

    await claimLocalStudyPlans(now);

    expect(studyPlansApi.upsert).toHaveBeenCalledTimes(1);
    expect(studyPlansApi.upsert).toHaveBeenCalledWith(id(2), day(6));
    expect(window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY)).toBeNull();
  });

  it("skips plans whose test date has passed", async () => {
    window.localStorage.setItem(
      STUDY_PLANS_STORAGE_KEY,
      JSON.stringify({ version: 1, plans: [{ collectionId: id(1), testDate: day(-1), createdAt: now.toISOString() }] }),
    );

    expect(await claimLocalStudyPlans(now)).toBe(false);

    expect(studyPlansApi.upsert).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY)).toBeNull();
  });

  it("drops a plan the server rejects with 400 or 404 and keeps going", async () => {
    upsertLocalStudyPlan(id(1), day(4), now);
    upsertLocalStudyPlan(id(2), day(5), now);
    upsertLocalStudyPlan(id(3), day(6), now);
    vi.mocked(studyPlansApi.upsert)
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(400, "StudyPlans.InvalidDate"))
      .mockImplementationOnce(async (collectionId, testDate) => serverPlan(collectionId, testDate));

    expect(await claimLocalStudyPlans(now)).toBe(true);

    expect(studyPlansApi.upsert).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY)).toBeNull();
  });

  it("stops at the server cap and clears the rest", async () => {
    upsertLocalStudyPlan(id(1), day(4), now);
    upsertLocalStudyPlan(id(2), day(5), now);
    upsertLocalStudyPlan(id(3), day(6), now);
    vi.mocked(studyPlansApi.upsert)
      .mockImplementationOnce(async (collectionId, testDate) => serverPlan(collectionId, testDate))
      .mockRejectedValueOnce(httpError(400, "StudyPlans.LimitReached"));

    await claimLocalStudyPlans(now);

    expect(studyPlansApi.upsert).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(STUDY_PLANS_STORAGE_KEY)).toBeNull();
  });

  it("keeps the local copy when the plan list cannot be read", async () => {
    upsertLocalStudyPlan(id(1), day(4), now);
    vi.mocked(studyPlansApi.list).mockRejectedValue(new Error("offline"));

    expect(await claimLocalStudyPlans(now)).toBe(false);

    expect(readLocalStudyPlans()).toHaveLength(1);
  });

  it.each([
    ["a network error", new AxiosError("Network Error", "ERR_NETWORK")],
    ["a 5xx", httpError(503)],
  ])("keeps the local copy after %s so the next session retries", async (_name, error) => {
    upsertLocalStudyPlan(id(1), day(4), now);
    upsertLocalStudyPlan(id(2), day(5), now);
    vi.mocked(studyPlansApi.upsert).mockRejectedValue(error);

    expect(await claimLocalStudyPlans(now)).toBe(false);

    expect(studyPlansApi.upsert).toHaveBeenCalledTimes(1);
    expect(readLocalStudyPlans()).toHaveLength(2);
  });
});
