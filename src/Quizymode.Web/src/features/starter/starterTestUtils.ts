import type { StarterPoolEntry } from "@/api/starter";
import type { ItemResponse } from "@/types/api";

export const WORLD_IDS = ["flags", "genai", "space", "animals", "food", "time", "body", "places"] as const;

let counter = 1000;

/** A valid GUID per number so the seen-list tests pass the GUID filter. */
export function guid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function poolEntry(world: string, n: number = ++counter, extra: Partial<ItemResponse> = {}): StarterPoolEntry {
  const item: ItemResponse = {
    id: guid(n),
    category: "trivia",
    isPrivate: false,
    question: `Question ${world} ${n}`,
    correctAnswer: `Right ${world} ${n}`,
    incorrectAnswers: [`Wrong ${world} ${n}`],
    explanation: "",
    createdAt: "2026-10-01T00:00:00Z",
    keywords: [],
    collections: [],
    ...extra,
  };
  return { item, world, wowLine: `Wow ${world} ${n}` };
}

/** `perWorld` entries for each of the eight worlds; flags carry a question picture. */
export function fullPool(perWorld = 3): StarterPoolEntry[] {
  const entries: StarterPoolEntry[] = [];
  let n = 1;
  for (const world of WORLD_IDS) {
    for (let i = 0; i < perWorld; i += 1) {
      entries.push(
        poolEntry(world, n, world === "flags" ? { questionImage: { key: `k${n}`, altText: "flag" } } : {}),
      );
      n += 1;
    }
  }
  return entries;
}
