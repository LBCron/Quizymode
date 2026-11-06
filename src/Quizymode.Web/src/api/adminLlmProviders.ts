import { apiClient } from "./client";

/** Admin AI provider routing (AC 5.12, epic #203). Types mirror the API contract exactly. */

export type LlmVendor = "Gemini" | "Groq" | "Cerebras" | "OpenRouter" | "OpenAI";

export const LLM_VENDORS: LlmVendor[] = ["Gemini", "Groq", "Cerebras", "OpenRouter", "OpenAI"];

export type LlmAttemptOutcome =
  | "Success"
  | "ProviderError"
  | "Timeout"
  | "ContentFilter"
  | "LowQuoteYield"
  | "InvalidJson"
  | "AuthError"
  | "RateLimited";

export interface LlmVendorSettings {
  vendor: LlmVendor;
  keyConfigured: boolean;
  model: string;
  /** Set while the vendor is skipped after an HTTP 429 (in-memory on the API instance that answered). */
  coolingDownUntilUtc?: string | null;
}

export interface LlmRoutes {
  free: LlmVendor[];
  premium: LlmVendor[];
}

export interface LlmProvidersResponse {
  vendors: LlmVendorSettings[];
  routes: LlmRoutes;
  monthlySectionBudget: number;
  monthlySectionsUsed: number;
}

export interface UpdateLlmProvidersRequest {
  vendors: Array<{ vendor: LlmVendor; model: string }>;
  routes: LlmRoutes;
}

export interface LlmAttempt {
  createdUtc: string;
  vendor: LlmVendor | string;
  model: string;
  outcome: LlmAttemptOutcome | string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs: number;
  /** HTTP status of the vendor reply; null when no reply arrived or for rows from before this was recorded. */
  httpStatus?: number | null;
}

export interface LlmUsageRow {
  vendor: LlmVendor | string;
  model: string;
  attempts: number;
  successes: number;
  inputTokens: number;
  outputTokens: number;
  avgDurationMs: number;
  /** null when no price is configured for the model. */
  estimatedCostUsd: number | null;
}

export interface LlmTopUser {
  userId: string;
  chargedSections: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmUsageResponse {
  days: number;
  sinceUtc: string;
  rows: LlmUsageRow[];
  topUsers: LlmTopUser[];
}

export interface LlmModelFinding {
  id: string;
  vendor: string;
  model: string;
  kind: string;
  firstSeenUtc: string;
  lastSeenUtc: string;
}

export interface LlmModelFindingsResponse {
  findings: LlmModelFinding[];
}

export const adminLlmProvidersApi = {
  get: async (): Promise<LlmProvidersResponse> => {
    const response = await apiClient.get<LlmProvidersResponse>("/admin/llm-providers");
    return response.data;
  },

  update: async (request: UpdateLlmProvidersRequest): Promise<LlmProvidersResponse> => {
    const response = await apiClient.put<LlmProvidersResponse>("/admin/llm-providers", request);
    return response.data;
  },

  getAttempts: async (days = 7): Promise<{ attempts: LlmAttempt[] }> => {
    const response = await apiClient.get<{ attempts: LlmAttempt[] }>("/admin/llm-providers/attempts", {
      params: { days },
    });
    return response.data;
  },

  getUsage: async (days = 30): Promise<LlmUsageResponse> => {
    const response = await apiClient.get<LlmUsageResponse>("/admin/llm-providers/usage", {
      params: { days },
    });
    return response.data;
  },

  getModelFindings: async (): Promise<LlmModelFindingsResponse> => {
    const response = await apiClient.get<LlmModelFindingsResponse>("/admin/llm-model-findings");
    return response.data;
  },
};
