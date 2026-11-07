import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, Link } from "react-router-dom";
import {
  adminApi,
  type CategoryKeywordAdminResponse,
  type UpdateCategoryKeywordRequest,
  type CreateCategoryKeywordRequest,
  type KeywordOption,
} from "@/api/admin";
import { categoriesApi } from "@/api/categories";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

// --- Combobox ---

interface KeywordComboboxProps {
  options: KeywordOption[];
  value: KeywordOption | null;
  onChange: (value: KeywordOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

function KeywordCombobox({
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  disabled = false,
}: KeywordComboboxProps) {
  const [inputText, setInputText] = React.useState(value?.name ?? "");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setInputText(value?.name ?? "");
  }, [value?.id, value?.name]);

  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(inputText.trim().toLowerCase())
  );
  const exactMatch = options.some(
    (o) => o.name.toLowerCase() === inputText.trim().toLowerCase()
  );
  const trimmedInput = inputText.trim();
  const canCreateNew = trimmedInput.length > 0 && !exactMatch;

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (option: KeywordOption) => {
    onChange(option);
    setInputText(option.name);
    setOpen(false);
  };

  const handleCreateNew = () => {
    // id='' signals "new keyword to be created"
    onChange({ id: "", name: trimmedInput });
    setOpen(false);
  };

  const handleInputChange = (text: string) => {
    setInputText(text);
    onChange(text.trim() ? { id: "", name: text.trim() } : null);
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (filtered.length === 1) { handleSelect(filtered[0]); }
      else if (canCreateNew) { handleCreateNew(); }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={inputText}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="rounded border border-gray-300 text-sm px-2 py-1 w-52"
      />
      {open && (filtered.length > 0 || canCreateNew) && (
        <ul className="absolute z-20 top-full left-0 mt-1 w-60 bg-surface border border-gray-200 rounded shadow-lg max-h-52 overflow-auto text-sm">
          {filtered.map((o) => (
            <li
              key={o.id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(o); }}
              className="px-3 py-1.5 hover:bg-indigo-50 cursor-pointer"
            >
              {o.name}
            </li>
          ))}
          {canCreateNew && (
            <li
              onMouseDown={(e) => { e.preventDefault(); handleCreateNew(); }}
              className="px-3 py-1.5 hover:bg-green-50 cursor-pointer text-green-700 border-t border-gray-100"
            >
              Create &ldquo;{trimmedInput}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// --- Page ---

const AdminKeywordsPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [selectedCategory, setSelectedCategory] = React.useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string>("");
  const [selectedL1, setSelectedL1] = React.useState<CategoryKeywordAdminResponse | null>(null);

  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: !!isAuthenticated && !!isAdmin,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "category-keywords", selectedCategory || null, null],
    queryFn: () => adminApi.getCategoryKeywords(selectedCategory || undefined, undefined),
    enabled: !!isAuthenticated && !!isAdmin && !!selectedCategory,
  });

  const { data: availableKeywordsData } = useQuery({
    queryKey: ["admin", "keywords-available", selectedCategoryId],
    queryFn: () => adminApi.getAvailableKeywordsForCategory(selectedCategoryId),
    enabled: !!isAuthenticated && !!isAdmin && !!selectedCategoryId,
  });
  const availableKeywords = availableKeywordsData?.keywords ?? [];

  const updateCategoryKeywordMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCategoryKeywordRequest }) =>
      adminApi.updateCategoryKeyword(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "category-keywords"] });
    },
  });

  const createCategoryKeywordMutation = useMutation({
    mutationFn: (body: CreateCategoryKeywordRequest) => adminApi.createCategoryKeyword(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "category-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "keywords-available", selectedCategoryId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteCategoryKeyword(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "category-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "keywords-available"] });
    },
  });

  const createKeywordMutation = useMutation({
    mutationFn: (name: string) => adminApi.createKeyword(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "keywords-available"] });
    },
  });

  const updateKeywordMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      adminApi.updateKeyword(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "category-keywords"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "keywords-available"] });
    },
  });

  const [addL1Keyword, setAddL1Keyword] = React.useState<KeywordOption | null>(null);
  const [addL1SortRank, setAddL1SortRank] = React.useState<number>(0);
  const [addL1Description, setAddL1Description] = React.useState<string>("");
  const [addL1Error, setAddL1Error] = React.useState<string | null>(null);

  const [addL2Keyword, setAddL2Keyword] = React.useState<KeywordOption | null>(null);
  const [addL2SortRank, setAddL2SortRank] = React.useState<number>(0);
  const [addL2Description, setAddL2Description] = React.useState<string>("");
  const [addL2Error, setAddL2Error] = React.useState<string | null>(null);

  if (!isAuthenticated || !isAdmin) return <Navigate to="/" replace />;

  const keywords = data?.keywords ?? [];
  const categories = categoriesData?.categories ?? [];

  const l1Keywords = keywords
    .filter((kw) => kw.navigationRank === 1)
    .sort((a, b) => a.sortRank - b.sortRank || a.keywordName.localeCompare(b.keywordName));

  const l2Keywords = selectedL1
    ? keywords
        .filter((kw) => kw.navigationRank === 2 && kw.parentName === selectedL1.keywordName)
        .sort((a, b) => a.sortRank - b.sortRank || a.keywordName.localeCompare(b.keywordName))
    : [];

  const handleCategoryChange = (catName: string) => {
    const cat = categories.find((c) => c.category === catName);
    setSelectedCategory(catName);
    setSelectedCategoryId(cat?.id ?? "");
    setSelectedL1(null);
    setAddL1Keyword(null);
    setAddL2Keyword(null);
    setAddL1Error(null);
    setAddL2Error(null);
  };

  const resolveKeywordId = async (kw: KeywordOption): Promise<string | null> => {
    if (kw.id) return kw.id;
    try {
      const created = await createKeywordMutation.mutateAsync(kw.name);
      return created.id;
    } catch {
      return null;
    }
  };

  const handleAddL1 = async () => {
    setAddL1Error(null);
    if (!selectedCategoryId || !addL1Keyword) return;
    const keywordId = await resolveKeywordId(addL1Keyword);
    if (!keywordId) {
      setAddL1Error(
        createKeywordMutation.error instanceof Error
          ? createKeywordMutation.error.message
          : "Failed to create keyword"
      );
      return;
    }
    createCategoryKeywordMutation.mutate(
      {
        categoryId: selectedCategoryId,
        childKeywordId: keywordId,
        parentKeywordId: null,
        sortRank: addL1SortRank,
        description: addL1Description.trim() || null,
      },
      {
        onSuccess: () => {
          setAddL1Keyword(null);
          setAddL1SortRank(0);
          setAddL1Description("");
        },
        onError: (e) => {
          setAddL1Error(e instanceof Error ? e.message : "Failed to add keyword");
        },
      }
    );
  };

  const handleAddL2 = async () => {
    setAddL2Error(null);
    if (!selectedCategoryId || !addL2Keyword || !selectedL1) return;
    const keywordId = await resolveKeywordId(addL2Keyword);
    if (!keywordId) {
      setAddL2Error(
        createKeywordMutation.error instanceof Error
          ? createKeywordMutation.error.message
          : "Failed to create keyword"
      );
      return;
    }
    createCategoryKeywordMutation.mutate(
      {
        categoryId: selectedCategoryId,
        childKeywordId: keywordId,
        parentKeywordId: selectedL1.keywordId,
        sortRank: addL2SortRank,
        description: addL2Description.trim() || null,
      },
      {
        onSuccess: () => {
          setAddL2Keyword(null);
          setAddL2SortRank(0);
          setAddL2Description("");
        },
        onError: (e) => {
          setAddL2Error(e instanceof Error ? e.message : "Failed to add keyword");
        },
      }
    );
  };

  const isBusy =
    createCategoryKeywordMutation.isPending || createKeywordMutation.isPending;

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6 flex items-center gap-4">
        <Link to="/admin" className="text-indigo-ink hover:text-indigo-ink text-sm font-medium">
          ← Admin Dashboard
        </Link>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Manage Keywords</h1>
      <p className="text-gray-500 text-sm mb-6">
        Assign navigation keywords to categories. Rank 1 = top-level, Rank 2 = under a parent
        keyword. Type to search existing keywords or enter a new name to create one on the fly.
      </p>

      <div className="mb-8">
        <label className="text-sm font-medium text-gray-700">
          Category
          <select
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="ml-2 rounded border-gray-300 text-sm"
          >
            <option value="">Select a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.category}>
                {c.category}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedCategory && (
        <p className="text-gray-400 text-sm">Select a category to manage keywords.</p>
      )}

      {selectedCategory && isLoading && <LoadingSpinner />}
      {selectedCategory && error && (
        <ErrorMessage message="Failed to load keywords" onRetry={() => refetch()} />
      )}

      {selectedCategory && !isLoading && !error && (
        <>
          {/* L1 section */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              L1 Navigation Keywords — {selectedCategory}
            </h2>

            {l1Keywords.length === 0 ? (
              <p className="text-gray-400 text-sm mb-4">No L1 keywords yet.</p>
            ) : (
              <div className="bg-surface shadow rounded-lg overflow-hidden mb-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Keyword
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Description
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                        Sort
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-surface divide-y divide-gray-200">
                    {l1Keywords.map((kw) => (
                      <KeywordRow
                        key={kw.id}
                        keyword={kw}
                        isSelected={selectedL1?.id === kw.id}
                        onSelect={() => {
                          setSelectedL1(kw);
                          setAddL2Keyword(null);
                          setAddL2Error(null);
                        }}
                        onSave={(body) =>
                          updateCategoryKeywordMutation.mutate({ id: kw.id, body })
                        }
                        isSaving={updateCategoryKeywordMutation.isPending}
                        onRename={(name) =>
                          updateKeywordMutation.mutate({ id: kw.keywordId, name })
                        }
                        isRenaming={updateKeywordMutation.isPending}
                        onDelete={() => {
                          if (
                            window.confirm(
                              `Remove "${kw.keywordName}" from navigation in ${kw.categoryName}? Items classified under this keyword will fall into "Other". The keyword itself won't be deleted.`
                            )
                          ) {
                            if (selectedL1?.id === kw.id) setSelectedL1(null);
                            deleteMutation.mutate(kw.id);
                          }
                        }}
                        isDeleting={deleteMutation.isPending}
                        hideDelete={selectedL1?.id === kw.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Add L1 keyword</h3>
              <div className="flex flex-wrap items-end gap-3">
                <KeywordCombobox
                  options={availableKeywords}
                  value={addL1Keyword}
                  onChange={setAddL1Keyword}
                  placeholder="Search or create…"
                  disabled={isBusy}
                />
                <label className="text-sm font-medium text-gray-700">
                  Sort
                  <input
                    type="number"
                    min={0}
                    value={addL1SortRank}
                    onChange={(e) => setAddL1SortRank(parseInt(e.target.value, 10) || 0)}
                    className="ml-2 w-16 rounded border border-gray-300 text-sm"
                  />
                </label>
                <input
                  type="text"
                  value={addL1Description}
                  onChange={(e) => setAddL1Description(e.target.value)}
                  placeholder="Description (optional)"
                  className="rounded border border-gray-300 text-sm px-2 py-1 w-44"
                />
                <button
                  type="button"
                  onClick={() => void handleAddL1()}
                  disabled={!addL1Keyword || isBusy}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isBusy ? "Adding…" : "Add"}
                </button>
              </div>
              {addL1Error && (
                <p className="mt-2 text-sm text-red-600">{addL1Error}</p>
              )}
            </div>
          </div>

          {!selectedL1 && l1Keywords.length > 0 && (
            <p className="text-gray-400 text-sm">
              Click <strong>Select</strong> on an L1 keyword above to manage its L2 sub-keywords.
            </p>
          )}

          {/* L2 section */}
          {selectedL1 && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-lg font-semibold text-gray-800">L2 Keywords under</h2>
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-sm font-medium text-indigo-ink">
                  {selectedL1.keywordName}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedL1(null)}
                  className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                  title="Clear selection"
                >
                  ×
                </button>
              </div>

              {l2Keywords.length === 0 ? (
                <p className="text-gray-400 text-sm mb-4">
                  No L2 keywords under {selectedL1.keywordName} yet.
                </p>
              ) : (
                <div className="bg-surface shadow rounded-lg overflow-hidden mb-4">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Keyword
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Description
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          Sort
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-surface divide-y divide-gray-200">
                      {l2Keywords.map((kw) => (
                        <KeywordRow
                          key={kw.id}
                          keyword={kw}
                          isSelected={false}
                          onSelect={undefined}
                          onSave={(body) =>
                            updateCategoryKeywordMutation.mutate({ id: kw.id, body })
                          }
                          isSaving={updateCategoryKeywordMutation.isPending}
                          onRename={(name) =>
                            updateKeywordMutation.mutate({ id: kw.keywordId, name })
                          }
                          isRenaming={updateKeywordMutation.isPending}
                          onDelete={() => {
                            if (
                              window.confirm(
                                `Remove "${kw.keywordName}" from navigation? Items classified under this keyword will lose their L2 placement. The keyword itself won't be deleted.`
                              )
                            ) {
                              deleteMutation.mutate(kw.id);
                            }
                          }}
                          isDeleting={deleteMutation.isPending}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  Add L2 keyword under {selectedL1.keywordName}
                </h3>
                <div className="flex flex-wrap items-end gap-3">
                  <KeywordCombobox
                    options={availableKeywords}
                    value={addL2Keyword}
                    onChange={setAddL2Keyword}
                    placeholder="Search or create…"
                    disabled={isBusy}
                  />
                  <label className="text-sm font-medium text-gray-700">
                    Sort
                    <input
                      type="number"
                      min={0}
                      value={addL2SortRank}
                      onChange={(e) => setAddL2SortRank(parseInt(e.target.value, 10) || 0)}
                      className="ml-2 w-16 rounded border border-gray-300 text-sm"
                    />
                  </label>
                  <input
                    type="text"
                    value={addL2Description}
                    onChange={(e) => setAddL2Description(e.target.value)}
                    placeholder="Description (optional)"
                    className="rounded border border-gray-300 text-sm px-2 py-1 w-44"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddL2()}
                    disabled={!addL2Keyword || isBusy}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {isBusy ? "Adding…" : "Add"}
                  </button>
                </div>
                {addL2Error && (
                  <p className="mt-2 text-sm text-red-600">{addL2Error}</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// --- KeywordRow ---

function KeywordRow({
  keyword,
  isSelected,
  onSelect,
  onSave,
  isSaving,
  onRename,
  isRenaming,
  onDelete,
  isDeleting,
  hideDelete = false,
}: {
  keyword: CategoryKeywordAdminResponse;
  isSelected: boolean;
  onSelect: (() => void) | undefined;
  onSave: (body: UpdateCategoryKeywordRequest) => void;
  isSaving: boolean;
  onRename: (name: string) => void;
  isRenaming: boolean;
  onDelete: () => void;
  isDeleting: boolean;
  hideDelete?: boolean;
}) {
  const [sortRank, setSortRank] = React.useState<number | "">(keyword.sortRank);
  const [descValue, setDescValue] = React.useState(keyword.description ?? "");
  const [dirty, setDirty] = React.useState(false);

  const [renaming, setRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState(keyword.keywordName);

  React.useEffect(() => {
    setSortRank(keyword.sortRank);
    setDescValue(keyword.description ?? "");
    setDirty(false);
    setRenameValue(keyword.keywordName);
    setRenaming(false);
  }, [keyword.id, keyword.sortRank, keyword.description, keyword.keywordName]);

  const handleSave = () => {
    const body: UpdateCategoryKeywordRequest = {};
    if (keyword.sortRank !== (sortRank === "" ? keyword.sortRank : sortRank))
      body.sortRank = sortRank === "" ? undefined : (sortRank as number);
    if ((keyword.description ?? "") !== descValue.trim())
      body.description = descValue.trim() || null;
    if (Object.keys(body).length === 0) return;
    onSave(body);
    setDirty(false);
  };

  const handleRenameConfirm = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === keyword.keywordName) {
      setRenaming(false);
      setRenameValue(keyword.keywordName);
      return;
    }
    onRename(trimmed);
    setRenaming(false);
  };

  return (
    <tr className={isSelected ? "bg-indigo-50" : "hover:bg-gray-50"}>
      <td className="px-4 py-2 text-sm font-medium text-gray-900 min-w-[140px]">
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameConfirm();
                if (e.key === "Escape") { setRenaming(false); setRenameValue(keyword.keywordName); }
              }}
              autoFocus
              className="rounded border border-indigo-400 text-sm px-1 py-0.5 w-32"
            />
            <button
              type="button"
              onClick={handleRenameConfirm}
              disabled={isRenaming}
              className="text-xs text-indigo-ink hover:text-indigo-ink font-medium disabled:opacity-50"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => { setRenaming(false); setRenameValue(keyword.keywordName); }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 group">
            <span>{keyword.keywordName}</span>
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-ink text-xs transition-opacity"
              title="Rename keyword"
            >
              ✎
            </button>
          </div>
        )}
      </td>
      <td className="px-4 py-2 max-w-[220px]">
        <input
          type="text"
          value={descValue}
          onChange={(e) => { setDescValue(e.target.value); setDirty(true); }}
          placeholder="Optional description"
          className="w-full rounded border-gray-300 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={0}
          value={sortRank === "" ? "" : sortRank}
          onChange={(e) => {
            setSortRank(e.target.value === "" ? "" : parseInt(e.target.value, 10));
            setDirty(true);
          }}
          className="w-16 rounded border-gray-300 text-sm"
        />
      </td>
      <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="text-sm font-medium text-indigo-ink hover:text-indigo-ink disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        )}
        {onSelect && (
          <button
            type="button"
            onClick={onSelect}
            className={`text-sm font-medium ${
              isSelected
                ? "text-indigo-ink font-semibold"
                : "text-indigo-500 hover:text-indigo-ink"
            }`}
          >
            {isSelected ? "Selected" : "Select"}
          </button>
        )}
        {!hideDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            {isDeleting ? "…" : "Delete"}
          </button>
        )}
      </td>
    </tr>
  );
}

export default AdminKeywordsPage;
