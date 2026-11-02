import { apiClient } from "./client";

/** Test-date plans (#364). */
export interface StudyPlanDto {
  collectionId: string;
  /** False when the collection is gone or no longer visible to the caller. */
  available: boolean;
  /** Null when unavailable. */
  collectionName: string | null;
  itemCount: number;
  /** Calendar day, yyyy-MM-dd, no time zone. */
  testDate: string;
  createdAt: string;
  /** Earliest Learn run of the collection from 14 days before the plan was created, UTC ISO. */
  firstLearnAt: string | null;
  /** Latest Learn or Quiz run of the collection in the same window, UTC ISO. */
  lastActivityAt: string | null;
}

export const studyPlansApi = {
  list: async (): Promise<StudyPlanDto[]> =>
    (await apiClient.get<{ plans: StudyPlanDto[] }>("/study-plans")).data.plans,
  upsert: async (collectionId: string, testDate: string): Promise<StudyPlanDto> =>
    (await apiClient.put<StudyPlanDto>(`/study-plans/${encodeURIComponent(collectionId)}`, { testDate })).data,
  remove: async (collectionId: string): Promise<void> => {
    await apiClient.delete(`/study-plans/${encodeURIComponent(collectionId)}`);
  },
};
