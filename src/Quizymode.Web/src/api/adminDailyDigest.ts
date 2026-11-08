import { z } from "zod";
import { apiClient } from "./client";

/**
 * Daily maintainer digest admin API (#509, AC 15). Responses are validated so a contract drift shows as a clear
 * error instead of a half-rendered card.
 */

export const DIGEST_RUN_STATUSES = ["Sending", "Sent", "Failed", "Missed"] as const;

const runSchema = z.object({
  id: z.string(),
  kind: z.enum(["Scheduled", "AdHoc"]),
  reportDate: z.string(),
  status: z.enum(DIGEST_RUN_STATUSES),
  attempts: z.number(),
  windowStartUtc: z.string(),
  windowEndUtc: z.string(),
  sentUtc: z.string().nullish(),
  lastError: z.string().nullish(),
  nextAttemptUtc: z.string().nullish(),
  createdUtc: z.string(),
});

export const dailyDigestRunsSchema = z.object({
  enabled: z.boolean(),
  disabledReason: z.string().nullish(),
  emailConfigured: z.boolean(),
  timeZone: z.string(),
  nextDueUtc: z.string().nullish(),
  lastTestSentUtc: z.string().nullish(),
  runs: z.array(runSchema),
});

export const dailyDigestPreviewSchema = z.object({
  reportDate: z.string(),
  windowStartUtc: z.string(),
  windowEndUtc: z.string(),
  subject: z.string(),
  textBody: z.string(),
});

const testSendSchema = z.object({ subject: z.string() });

const sendNowSchema = z.object({
  id: z.string(),
  status: z.string(),
  windowStartUtc: z.string(),
  windowEndUtc: z.string(),
});

export type DailyDigestRun = z.infer<typeof runSchema>;
export type DailyDigestRuns = z.infer<typeof dailyDigestRunsSchema>;
export type DailyDigestPreview = z.infer<typeof dailyDigestPreviewSchema>;
export type DailyDigestSendNow = z.infer<typeof sendNowSchema>;

export const dailyDigestApi = {
  getRuns: async (days = 14): Promise<DailyDigestRuns> => {
    const response = await apiClient.get("/admin/daily-digest/runs", { params: { days } });
    return dailyDigestRunsSchema.parse(response.data);
  },

  getPreview: async (date?: string): Promise<DailyDigestPreview> => {
    const response = await apiClient.get("/admin/daily-digest/preview", { params: date ? { date } : undefined });
    return dailyDigestPreviewSchema.parse(response.data);
  },

  sendTest: async (): Promise<{ subject: string }> => {
    const response = await apiClient.post("/admin/daily-digest/test-send");
    return testSendSchema.parse(response.data);
  },

  /** Sends a digest for an explicit UTC window to the configured admin address (there is no recipient parameter). */
  sendNow: async (fromUtc: string, toUtc: string): Promise<DailyDigestSendNow> => {
    const response = await apiClient.post("/admin/daily-digest/send-now", { from: fromUtc, to: toUtc });
    return sendNowSchema.parse(response.data);
  },
};
