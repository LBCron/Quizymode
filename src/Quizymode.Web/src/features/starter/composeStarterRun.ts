import type { StarterPoolEntry } from "@/api/starter";
import { getStarterWorld } from "./starterWorlds";

export const STARTER_RUN_SIZE = 5;

/** mulberry32 seeded from a string, so one run seed always composes the same five questions. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Composes a five-question starter run from the pool (#462, AC 3.0.2): question 1 is a flag with a picture when one
 * exists, one question is Gen AI, and the rest come from other distinct worlds. Items never shown before come first,
 * then the least recently shown. Worlds the web app does not know are skipped. Returns [] when fewer than five usable
 * items exist, so the caller can fall back to the legacy quick quiz.
 */
export function composeStarterRun(pool: StarterPoolEntry[], seenIds: string[], seed: string): StarterPoolEntry[] {
  const random = seededRandom(seed);
  const seenRank = new Map(seenIds.map((id, index) => [id, index] as const));
  const rankOf = (entry: StarterPoolEntry): number => seenRank.get(entry.item.id) ?? -1;

  const usable: StarterPoolEntry[] = [];
  const knownIds = new Set<string>();
  for (const entry of pool) {
    if (!getStarterWorld(entry.world) || knownIds.has(entry.item.id)) continue;
    knownIds.add(entry.item.id);
    usable.push(entry);
  }
  if (usable.length < STARTER_RUN_SIZE) return [];

  const byWorld = new Map<string, StarterPoolEntry[]>();
  for (const entry of usable) {
    byWorld.set(entry.world, [...(byWorld.get(entry.world) ?? []), entry]);
  }

  const withJitter = <T,>(values: T[], key: (value: T) => number): T[] =>
    values
      .map((value) => ({ value, key: key(value), jitter: random() }))
      .sort((a, b) => a.key - b.key || a.jitter - b.jitter)
      .map((wrapped) => wrapped.value);

  const bestOf = (candidates: StarterPoolEntry[]): StarterPoolEntry | undefined => withJitter(candidates, rankOf)[0];
  const chosen: StarterPoolEntry[] = [];
  const take = (entry: StarterPoolEntry | undefined) => {
    if (entry && !chosen.includes(entry)) chosen.push(entry);
  };

  const flags = byWorld.get("flags") ?? [];
  const pictureFlags = flags.filter((entry) => Boolean(entry.item.questionImage));
  take(bestOf(pictureFlags.length > 0 ? pictureFlags : flags));
  take(bestOf(byWorld.get("genai") ?? []));

  // Other distinct worlds: the ones holding the least recently shown item first.
  const otherWorlds = withJitter(
    [...byWorld.keys()].filter((world) => !chosen.some((entry) => entry.world === world)),
    (world) => Math.min(...(byWorld.get(world) ?? []).map(rankOf)),
  );
  for (const world of otherWorlds) {
    if (chosen.length >= STARTER_RUN_SIZE) break;
    take(bestOf(byWorld.get(world) ?? []));
  }

  // Fewer than five worlds: top up with the best remaining items.
  if (chosen.length < STARTER_RUN_SIZE) {
    for (const entry of withJitter(usable.filter((candidate) => !chosen.includes(candidate)), rankOf)) {
      if (chosen.length >= STARTER_RUN_SIZE) break;
      take(entry);
    }
  }

  // The first pick stays first (the flag hook); the rest are shuffled so Gen AI is not always second.
  const [first, ...rest] = chosen;
  const shuffled = withJitter(rest, () => 0);
  return first ? [first, ...shuffled] : [];
}

/** Up to three distinct world ids for the end cards, in run order (so a flag question puts Flags first). */
export function pickExploreWorlds(run: StarterPoolEntry[], count = 3): string[] {
  const worlds: string[] = [];
  for (const entry of run) {
    if (!worlds.includes(entry.world)) worlds.push(entry.world);
    if (worlds.length === count) break;
  }
  return worlds;
}
