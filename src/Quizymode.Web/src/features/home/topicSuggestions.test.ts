import { beforeEach, describe, expect, it } from "vitest";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import type { ActivityRun } from "./personalization";
import { addSuppression, readSuppressions, suggestTopics } from "./topicSuggestions";

const now = new Date("2026-11-06T12:00:00Z");
const run = (slug: string, nav: string[], daysAgo: number): ActivityRun => ({
  completedAt: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
  source: { kind: "category", categorySlug: slug, navigationKeywords: nav, filterKeywords: [] },
});

describe("suggestTopics", () => {
  beforeEach(() => installMemoryLocalStorage());

  it("needs 2 runs in 30 days and rolls up to L1", () => {
    const runs = [run("languages", ["french", "verbs"], 1), run("languages", ["french"], 2), run("history", [], 1), run("tech", [], 40), run("tech", [], 41)];
    expect(suggestTopics(runs, [], [], now).map((s) => s.path)).toEqual(["languages/french"]);
  });

  it("ranks by count, then recency, then id, and keeps 3", () => {
    const runs = [
      run("b", [], 3), run("b", [], 4), run("a", [], 3), run("a", [], 4), run("c", [], 1), run("c", [], 5),
      run("d", [], 2), run("d", [], 2), run("d", [], 6), run("e", [], 1), run("e", [], 1),
    ];
    expect(suggestTopics(runs, [], [], now).map((s) => s.path)).toEqual(["d", "c", "e"]);
  });

  it("skips chosen, overlapping, suppressed and unattributable topics", () => {
    const at = run("x", [], 1).completedAt;
    const collection: ActivityRun = { completedAt: at, source: { kind: "collection", collectionId: "c1" } };
    const none: ActivityRun = { completedAt: at, source: null };
    const runs = [run("languages", ["french"], 1), run("languages", ["french"], 2), run("history", [], 1), run("history", [], 2), collection, collection, none, none];
    expect(suggestTopics(runs, ["languages"], [], now).map((s) => s.path)).toEqual(["history"]);
    expect(suggestTopics(runs, [], ["history", "languages/french"], now)).toEqual([]);
  });

  it("stores suppressions", () => {
    addSuppression("history");
    addSuppression("history");
    expect(readSuppressions()).toEqual(["history"]);
  });
});
