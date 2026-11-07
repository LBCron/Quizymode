import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { featuredApi } from "@/api/featured";
import type { AdminFeaturedItemDto } from "@/api/featured";
import { collectionsApi } from "@/api/collections";
import { useTaxonomy } from "@/features/topics/useTaxonomy";
import type { CollectionDiscoverItem } from "@/types/api";
import {
  TrashIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";

type Tab = "set" | "collection";

interface SetCombo {
  key: string;
  cat: string;
  n1: string;
  n2: string | null;
  label: string;
  itemCount: number;
}

const slugToTitle = (s: string) =>
  s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const setComboKey = (cat: string, n1: string, n2?: string | null) =>
  `${cat}|${n1}|${n2 ?? ""}`;

const AdminFeaturedPage = () => {
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("set");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["adminFeatured"],
    queryFn: () => featuredApi.adminList(),
  });

  const { data: taxonomyData } = useTaxonomy(tab === "set");

  const { data: collectionsData } = useQuery({
    queryKey: ["collections", "discover", search],
    queryFn: () => collectionsApi.discover({ q: search || undefined, pageSize: 30 }),
    enabled: tab === "collection",
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { displayName?: string; sortOrder?: number } }) =>
      featuredApi.adminUpdate(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminFeatured"] });
      queryClient.invalidateQueries({ queryKey: ["featured"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: featuredApi.adminDelete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminFeatured"] });
      queryClient.invalidateQueries({ queryKey: ["featured"] });
    },
  });

  const items = data?.items ?? [];

  const featuredSets = useMemo(
    () => [...items.filter((i) => i.type === "Set")].sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );
  const featuredCollections = useMemo(
    () => [...items.filter((i) => i.type === "Collection")].sort((a, b) => a.sortOrder - b.sortOrder),
    [items]
  );

  const featuredSetKeys = useMemo(
    () => new Set(featuredSets.map((i) => setComboKey(i.categorySlug ?? "", i.navKeyword1 ?? "", i.navKeyword2))),
    [featuredSets]
  );
  const featuredCollectionIds = useMemo(
    () => new Set(featuredCollections.map((i) => i.collectionId ?? "")),
    [featuredCollections]
  );

  const allSetCombos = useMemo<SetCombo[]>(() => {
    if (!taxonomyData) return [];
    const result: SetCombo[] = [];
    for (const cat of taxonomyData.categories) {
      for (const l1 of cat.groups) {
        result.push({
          key: setComboKey(cat.slug, l1.slug),
          cat: cat.slug,
          n1: l1.slug,
          n2: null,
          label: `${cat.name} › ${slugToTitle(l1.slug)}`,
          itemCount: l1.itemCount,
        });
        for (const l2 of l1.keywords) {
          result.push({
            key: setComboKey(cat.slug, l1.slug, l2.slug),
            cat: cat.slug,
            n1: l1.slug,
            n2: l2.slug,
            label: `${cat.name} › ${slugToTitle(l1.slug)} › ${slugToTitle(l2.slug)}`,
            itemCount: l2.itemCount,
          });
        }
      }
    }
    return result;
  }, [taxonomyData]);

  const filteredCombos = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return allSetCombos;
    return allSetCombos.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.cat.includes(q) ||
        c.n1.includes(q) ||
        (c.n2?.includes(q) ?? false)
    );
  }, [allSetCombos, search]);

  const filteredCollections: CollectionDiscoverItem[] = collectionsData?.items ?? [];

  const selectedCount = [...checked].filter((k) =>
    tab === "set" ? !featuredSetKeys.has(k) : !featuredCollectionIds.has(k)
  ).length;

  const currentItems = tab === "set" ? featuredSets : featuredCollections;

  const handleTabChange = (next: Tab) => {
    setTab(next);
    setSearch("");
    setChecked(new Set());
    setAddError(null);
  };

  const toggleCheck = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (selectedCount === 0) return;
    setIsAdding(true);
    setAddError(null);
    try {
      let failed = 0;
      if (tab === "set") {
        const toAdd = allSetCombos.filter((c) => checked.has(c.key) && !featuredSetKeys.has(c.key));
        const results = await Promise.allSettled(
          toAdd.map((c) =>
            featuredApi.adminAdd({
              type: "Set",
              displayName: c.label,
              categorySlug: c.cat,
              navKeyword1: c.n1,
              navKeyword2: c.n2 ?? undefined,
            })
          )
        );
        failed = results.filter((r) => r.status === "rejected").length;
      } else {
        const colMap = new Map(filteredCollections.map((c) => [c.id, c]));
        const toAdd = [...checked]
          .filter((id) => !featuredCollectionIds.has(id))
          .map((id) => colMap.get(id))
          .filter((c): c is CollectionDiscoverItem => c !== undefined);
        const results = await Promise.allSettled(
          toAdd.map((c) =>
            featuredApi.adminAdd({
              type: "Collection",
              displayName: c.name,
              collectionId: c.id,
            })
          )
        );
        failed = results.filter((r) => r.status === "rejected").length;
      }
      queryClient.invalidateQueries({ queryKey: ["adminFeatured"] });
      queryClient.invalidateQueries({ queryKey: ["featured"] });
      setChecked(new Set());
      if (failed > 0) setAddError(`${failed} item(s) failed to add.`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleMove = async (orderedItems: AdminFeaturedItemDto[], fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= orderedItems.length) return;
    const reordered = [...orderedItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const updates = reordered
      .map((item, newOrder) => ({ item, newOrder }))
      .filter(({ item, newOrder }) => item.sortOrder !== newOrder);
    if (updates.length === 0) return;
    setIsMoving(true);
    try {
      await Promise.all(
        updates.map(({ item, newOrder }) => featuredApi.adminUpdate(item.id, { sortOrder: newOrder }))
      );
      queryClient.invalidateQueries({ queryKey: ["adminFeatured"] });
      queryClient.invalidateQueries({ queryKey: ["featured"] });
    } finally {
      setIsMoving(false);
    }
  };

  const handleStartEdit = (item: AdminFeaturedItemDto) => {
    setEditingId(item.id);
    setEditDisplayName(item.displayName);
  };

  const handleSaveEdit = (id: string) => {
    updateMutation.mutate({ id, patch: { displayName: editDisplayName.trim() } });
  };

  const handleDelete = (item: AdminFeaturedItemDto) => {
    if (window.confirm(`Remove "${item.displayName}" from Featured?`)) {
      deleteMutation.mutate(item.id);
    }
  };

  if (isLoading) return <div className="p-6 text-gray-600">Loading...</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load featured items.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Featured</h1>
        <p className="mt-1 text-sm text-gray-500">
          Curate the sets and collections shown on the public Featured page.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex w-fit gap-1 rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => handleTabChange("set")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "set"
              ? "bg-surface text-indigo-ink shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Sets
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("collection")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "collection"
              ? "bg-surface text-amber-700 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Collections
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: search & add */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {tab === "set" ? "Add Sets" : "Add Collections"}
          </h2>

          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setChecked(new Set());
            }}
            placeholder={
              tab === "set" ? "Filter by category or topic..." : "Search collections..."
            }
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <div className="max-h-80 overflow-y-auto rounded-md border border-gray-200 bg-surface">
            {tab === "set" ? (
              filteredCombos.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">
                  {taxonomyData ? "No matching sets." : "Loading taxonomy..."}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {filteredCombos.map((combo) => {
                    const already = featuredSetKeys.has(combo.key);
                    return (
                      <li key={combo.key}>
                        <label
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 ${
                            already ? "cursor-not-allowed opacity-40" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(combo.key)}
                            disabled={already}
                            onChange={() => toggleCheck(combo.key)}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-ink focus:ring-indigo-500"
                          />
                          <span className="flex-1 text-gray-800">{combo.label}</span>
                          <span className="text-xs text-gray-400">{combo.itemCount}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : filteredCollections.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                {search ? "No matching collections." : "Type to search collections."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredCollections.map((col) => {
                  const already = featuredCollectionIds.has(col.id);
                  return (
                    <li key={col.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 ${
                          already ? "cursor-not-allowed opacity-40" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(col.id)}
                          disabled={already}
                          onChange={() => toggleCheck(col.id)}
                          className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                        />
                        <span className="flex-1 text-gray-800">{col.name}</span>
                        <span className="text-xs text-gray-400">{col.itemCount} items</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={selectedCount === 0 || isAdding}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                tab === "set"
                  ? "bg-indigo-600 hover:bg-indigo-700"
                  : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {isAdding
                ? "Adding..."
                : selectedCount > 0
                ? `Add ${selectedCount} selected`
                : "Select items to add"}
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Clear selection
              </button>
            )}
          </div>
          {addError && <p className="text-sm text-red-600">{addError}</p>}
        </div>

        {/* Right: current featured list */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Featured {tab === "set" ? "Sets" : "Collections"}
            <span className="ml-2 font-normal text-gray-400">({currentItems.length})</span>
          </h2>

          {currentItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400">
              No featured {tab === "set" ? "sets" : "collections"} yet.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-surface">
              {currentItems.map((item, index) => (
                <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => handleMove(currentItems, index, index - 1)}
                      disabled={index === 0 || isMoving}
                      className="rounded p-0.5 text-gray-300 hover:text-gray-600 disabled:invisible"
                      title="Move up"
                    >
                      <ChevronUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(currentItems, index, index + 1)}
                      disabled={index === currentItems.length - 1 || isMoving}
                      className="rounded p-0.5 text-gray-300 hover:text-gray-600 disabled:invisible"
                      title="Move down"
                    >
                      <ChevronDownIcon className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    {editingId === item.id ? (
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        autoFocus
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      <p className="truncate text-sm font-medium text-gray-900">{item.displayName}</p>
                    )}
                    <p className="truncate text-xs text-gray-400">
                      {item.type === "Set"
                        ? [item.categorySlug, item.navKeyword1, item.navKeyword2]
                            .filter(Boolean)
                            .join(" › ")
                        : (item.collectionName ?? item.collectionId ?? "—")}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    {editingId === item.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(item.id)}
                          disabled={updateMutation.isPending}
                          className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
                          title="Save"
                        >
                          <CheckIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100"
                          title="Cancel"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(item)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-ink"
                          title="Rename"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          disabled={deleteMutation.isPending}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Remove"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminFeaturedPage;
