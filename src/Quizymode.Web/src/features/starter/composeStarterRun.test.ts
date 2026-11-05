import { describe, expect, it } from "vitest";
import { composeStarterRun, pickExploreWorlds } from "./composeStarterRun";
import { fullPool, poolEntry } from "./starterTestUtils";

describe("composeStarterRun", () => {
  it("opens with a flag that has a picture, includes Gen AI, and uses five distinct worlds", () => {
    const pool = fullPool();
    for (let seed = 0; seed < 25; seed += 1) {
      const run = composeStarterRun(pool, [], `seed-${seed}`);
      expect(run).toHaveLength(5);
      expect(run[0]?.world).toBe("flags");
      expect(run[0]?.item.questionImage).toBeTruthy();
      expect(run.some((entry) => entry.world === "genai")).toBe(true);
      expect(new Set(run.map((entry) => entry.world)).size).toBe(5);
    }
  });

  it("is deterministic for one seed", () => {
    const pool = fullPool();
    const ids = (seed: string) => composeStarterRun(pool, [], seed).map((entry) => entry.item.id);
    expect(ids("same")).toEqual(ids("same"));
  });

  it("shows no item twice across consecutive runs while unseen items remain", () => {
    const pool = fullPool(3);
    const seen: string[] = [];
    const first = composeStarterRun(pool, seen, "a");
    seen.push(...first.map((entry) => entry.item.id));
    const second = composeStarterRun(pool, seen, "b");
    const firstIds = new Set(first.map((entry) => entry.item.id));
    expect(second.filter((entry) => firstIds.has(entry.item.id))).toEqual([]);
  });

  it("falls back to the least recently seen item once every item has been seen", () => {
    const pool = fullPool(2);
    const flags = pool.filter((entry) => entry.world === "flags");
    // Every item seen; flags[0] was seen before flags[1], so it is the least recently seen and leads.
    const others = pool.map((entry) => entry.item.id).filter((id) => id !== flags[0]?.item.id && id !== flags[1]?.item.id);
    const seen = [flags[0]!.item.id, ...others, flags[1]!.item.id];
    const run = composeStarterRun(pool, seen, "x");
    expect(run).toHaveLength(5);
    expect(run[0]?.item.id).toBe(flags[0]?.item.id);
  });

  it("skips worlds the web app does not know and returns [] when fewer than five usable items remain", () => {
    const unknownOnly = [poolEntry("mystery"), poolEntry("mystery"), ...fullPool(1).slice(0, 4)];
    expect(composeStarterRun(unknownOnly, [], "s")).toEqual([]);

    const mixed = [poolEntry("mystery"), ...fullPool(1)];
    const run = composeStarterRun(mixed, [], "s");
    expect(run).toHaveLength(5);
    expect(run.some((entry) => entry.world === "mystery")).toBe(false);
  });

  it("tops up from repeated worlds when fewer than five worlds exist", () => {
    const pool = [poolEntry("flags"), poolEntry("flags"), poolEntry("genai"), poolEntry("space"), poolEntry("space")];
    const run = composeStarterRun(pool, [], "s");
    expect(run).toHaveLength(5);
    expect(new Set(run.map((entry) => entry.item.id)).size).toBe(5);
  });
});

describe("pickExploreWorlds", () => {
  it("returns up to three distinct worlds in run order, flags first", () => {
    const run = composeStarterRun(fullPool(), [], "seed");
    const worlds = pickExploreWorlds(run);
    expect(worlds).toHaveLength(3);
    expect(worlds[0]).toBe("flags");
    expect(new Set(worlds).size).toBe(3);
  });
});
