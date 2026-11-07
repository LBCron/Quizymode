import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { taxonomyApi } from "@/api/taxonomy";
import { useAuth } from "@/contexts/AuthContext";
import { TAXONOMY_QUERY_ROOT } from "@/features/topics/topicQueryKeys";
import { MAX_INTERESTS } from "@/features/learningLoop/localLearningState";
import { topicLabel, topicsOverlap } from "./topicPaths";

/** Optional progressive disclosure: choose a category, then an L1, then an L2. Never infer a parent selection. */
export function TopicRefinements({ selected, onAdd }: { selected: string[]; onAdd: (path: string) => void }) {
  const { userId } = useAuth();
  const [category, setCategory] = useState("");
  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");
  const taxonomy = useQuery({ queryKey: [TAXONOMY_QUERY_ROOT, userId ?? "anon"], queryFn: taxonomyApi.getAll, staleTime: 5 * 60 * 1000, retry: false });
  const groups = taxonomy.data?.categories.find(entry => entry.slug === category)?.groups ?? [];
  const leaves = groups.find(group => group.slug === l1)?.keywords ?? [];
  const path = [category, l1, l2].filter(Boolean).join("/");
  const blocked = !category || taxonomy.isPending || taxonomy.isError ||
    (selected.length >= MAX_INTERESTS && !selected.some(existing => topicsOverlap(existing, path)));
  const selectClass = "mt-1 min-h-[44px] w-full rounded-md border border-slate-500 bg-panel-raised px-3 text-sm text-on-panel";
  return (
    <details className="mt-3 rounded-lg border border-on-panel/20 p-3">
      <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">Refine a topic</summary>
      <p className="mb-3 text-xs text-on-panel-muted">Choose a category, then optionally a topic and subtopic. Adding it replaces overlapping selections.</p>
      {taxonomy.isPending ? <p role="status" className="text-sm">Loading topic refinements…</p> : taxonomy.isError ? (
        <p className="text-sm">Topic refinements could not be loaded. <button type="button" className="min-h-[44px] underline" onClick={() => void taxonomy.refetch()} disabled={taxonomy.isFetching}>Retry refinements</button></p>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="interest-category" className="block text-xs">Category</label>
            <select id="interest-category" className={selectClass} value={category} onChange={event => { setCategory(event.target.value); setL1(""); setL2(""); }}>
              <option value="">Choose a category</option>
              {taxonomy.data.categories.map(entry => <option key={entry.slug} value={entry.slug}>{entry.name}</option>)}
            </select>
          </div>
          {category && <div>
            <label htmlFor="interest-topic" className="block text-xs">Topic (optional)</label>
            <select id="interest-topic" className={selectClass} value={l1} onChange={event => { setL1(event.target.value); setL2(""); }}>
              <option value="">All topics in this category</option>
              {groups.map(group => <option key={group.slug} value={group.slug}>{topicLabel(group.slug)}</option>)}
            </select>
          </div>}
          {l1 && <div>
            <label htmlFor="interest-subtopic" className="block text-xs">Subtopic (optional)</label>
            <select id="interest-subtopic" className={selectClass} value={l2} onChange={event => setL2(event.target.value)}>
              <option value="">All subtopics in this topic</option>
              {leaves.map(leaf => <option key={leaf.slug} value={leaf.slug}>{topicLabel(leaf.slug)}</option>)}
            </select>
          </div>}
          <button type="button" disabled={blocked} onClick={() => onAdd(path)} className="min-h-[44px] rounded-full border border-sky-300 px-4 text-sm font-semibold disabled:opacity-50">Add topic</button>
        </div>
      )}
    </details>
  );
}
