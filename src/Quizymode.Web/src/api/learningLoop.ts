import { apiClient } from "./client";
import type { ItemImageReference, ItemResponse } from "@/types/api";

/** Review queue (REVIEW-001, #117). */
export interface ReviewQueueResponse {
  items: ItemResponse[];
  dueCount: number;
  totalCount: number;
  nextDueAt: string | null;
}

export interface ReviewQueueSummary {
  dueCount: number;
  totalCount: number;
  nextDueAt: string | null;
}

export interface ReviewAnswerResponse {
  itemId: string;
  applied: boolean;
  graduated: boolean;
  intervalDays: number | null;
  dueAt: string | null;
}

export interface ReviewEnqueueResponse {
  itemId: string;
  intervalDays: number;
  dueAt: string;
}

/** Daily quiz (DAILY-001, #119). */
export interface DailyQuizCompletion {
  correct: number;
  /** Roster size, including skipped questions. */
  total: number;
  completedAt: string;
  /** Questions skipped because their picture was unavailable (#403); not scored. */
  skipped?: number;
}

export interface DailyQuizResponse {
  /** UTC calendar date, yyyy-MM-dd. */
  date: string;
  items: ItemResponse[];
  /** Signed-in callers only. */
  completion: DailyQuizCompletion | null;
  /** Signed-in callers only; anonymous visitors keep their streak in the browser. */
  streak: number | null;
}

export interface CompleteDailyQuizResponse {
  created: boolean;
  streak: number;
  completion: DailyQuizCompletion;
}

export interface AdminDailyQuizItem {
  itemId: string;
  position: number;
  question: string;
  category: string | null;
  excluded: boolean;
  excludedAt: string | null;
  questionImage?: ItemImageReference | null;
}

export interface AdminDailyQuizDay {
  date: string;
  items: AdminDailyQuizItem[];
}

export const reviewQueueApi = {
  get: async (): Promise<ReviewQueueResponse> => (await apiClient.get<ReviewQueueResponse>("/review-queue")).data,
  getSummary: async (): Promise<ReviewQueueSummary> =>
    (await apiClient.get<ReviewQueueSummary>("/review-queue/summary")).data,
  /** Queues one item at the first interval (idempotent); 404 when the item cannot be reviewed (#251). */
  enqueue: async (itemId: string): Promise<ReviewEnqueueResponse> =>
    (await apiClient.post<ReviewEnqueueResponse>(`/review-queue/${encodeURIComponent(itemId)}`)).data,
  answer: async (itemId: string, isCorrect: boolean): Promise<ReviewAnswerResponse> =>
    (await apiClient.post<ReviewAnswerResponse>(`/review-queue/${encodeURIComponent(itemId)}/answers`, { isCorrect })).data,
};

export const dailyQuizApi = {
  get: async (): Promise<DailyQuizResponse> => (await apiClient.get<DailyQuizResponse>("/daily-quiz")).data,
  complete: async (date: string, correct: number, total: number, skipped = 0): Promise<CompleteDailyQuizResponse> =>
    (await apiClient.post<CompleteDailyQuizResponse>("/daily-quiz/completions", { date, correct, total, skipped })).data,
  adminGet: async (date?: string): Promise<AdminDailyQuizDay> =>
    (await apiClient.get<AdminDailyQuizDay>("/admin/daily-quiz", { params: date ? { date } : undefined })).data,
  adminExclude: async (date: string, itemId: string): Promise<AdminDailyQuizDay> =>
    (await apiClient.post<AdminDailyQuizDay>(
      `/admin/daily-quiz/${encodeURIComponent(date)}/items/${encodeURIComponent(itemId)}/exclude`,
    )).data,
};

/** Topic interests and cold-start popularity (PERSONAL-001, #116). */
export const interestsApi = {
  get: async (): Promise<string[]> =>
    (await apiClient.get<{ categories: string[] }>("/users/me/interests")).data.categories,
  replace: async (categories: string[]): Promise<string[]> =>
    (await apiClient.put<{ categories: string[] }>("/users/me/interests", { categories })).data.categories,
  popularCategories: async (): Promise<string[]> =>
    (await apiClient.get<{ categories: string[] }>("/home/popular-categories")).data.categories,
};
