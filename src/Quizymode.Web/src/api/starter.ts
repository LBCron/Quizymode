import { z } from "zod";
import { apiClient } from "./client";
import type { ItemResponse } from "@/types/api";

/**
 * Starter pool (#462): seed-managed public items for the /start quiz. Validated here so a malformed response falls back
 * to the legacy quick quiz instead of breaking the page. `item` is checked only for what a quiz run needs.
 */
const starterItemSchema = z.object({
  item: z
    .object({
      id: z.string().min(1),
      question: z.string().min(1),
      correctAnswer: z.string().min(1),
      incorrectAnswers: z.array(z.string()).min(1),
    })
    .passthrough(),
  world: z.string().min(1),
  wowLine: z.string(),
});

export const starterPoolSchema = z.object({
  version: z.string(),
  items: z.array(starterItemSchema),
});

export interface StarterPoolEntry {
  item: ItemResponse;
  world: string;
  wowLine: string;
}

export interface StarterPool {
  version: string;
  items: StarterPoolEntry[];
}

export const starterApi = {
  /** Throws when the request fails or the body does not match the contract. */
  getPool: async (): Promise<StarterPool> => {
    const response = await apiClient.get<unknown>("/starter-pool");
    return starterPoolSchema.parse(response.data) as unknown as StarterPool;
  },
};
