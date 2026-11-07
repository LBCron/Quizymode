import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, Link } from "react-router-dom";
import {
  adminApi,
  type UpdateCategoryRequest,
  type CreateCategoryRequest,
} from "@/api/admin";
import { categoriesApi } from "@/api/categories";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

const AdminCategoriesPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["categories"],
    queryFn: () => categoriesApi.getAll(),
    enabled: !!isAuthenticated && !!isAdmin,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCategoryRequest }) =>
      adminApi.updateCategory(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateCategoryRequest) => adminApi.createCategory(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isLoading) return <LoadingSpinner />;
  if (error)
    return (
      <ErrorMessage
        message="Failed to load categories"
        onRetry={() => refetch()}
      />
    );

  const categories = data?.categories ?? [];

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6 flex items-center gap-4">
        <Link
          to="/admin"
          className="text-indigo-ink hover:text-indigo-ink text-sm font-medium"
        >
          ← Admin Dashboard
        </Link>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Manage Categories</h1>
      <p className="text-gray-600 text-sm mb-6">
        Add, rename, or delete categories. Set description and short description.
        Changes affect navigation and item grouping. Delete only when a category
        has no items.
      </p>

      <AddCategoryForm
        onCreate={(body) => createMutation.mutate(body)}
        isCreating={createMutation.isPending}
        createError={createMutation.error}
      />

      <div className="mt-6 bg-surface shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Category name
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Description
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Short description
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Items
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-gray-200">
              {categories
                .sort((a, b) => a.category.localeCompare(b.category))
                .map((cat) => (
                  <CategoryRow
                    key={cat.id}
                    name={cat.category}
                    description={cat.description ?? ""}
                    shortDescription={cat.shortDescription ?? ""}
                    itemCount={cat.count}
                    onSave={(body) =>
                      updateMutation.mutate({ id: cat.id, body })
                    }
                    onDelete={() => deleteMutation.mutate(cat.id)}
                    isSaving={updateMutation.isPending}
                    isDeleting={deleteMutation.isPending}
                    saveError={updateMutation.error}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {categories.length === 0 && (
        <p className="text-gray-500 text-center py-8">No categories found.</p>
      )}
    </div>
  );
};

function AddCategoryForm({
  onCreate,
  isCreating,
  createError,
}: {
  onCreate: (body: CreateCategoryRequest) => void;
  isCreating: boolean;
  createError: unknown;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [shortDescription, setShortDescription] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onCreate({
      name: trimmedName,
      description: description.trim() || null,
      shortDescription: shortDescription.trim() || null,
    });
    setName("");
    setDescription("");
    setShortDescription("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface shadow rounded-lg p-4 flex flex-wrap items-end gap-4"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="rounded border border-gray-300 px-3 py-2 text-sm w-48"
          maxLength={100}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          className="rounded border border-gray-300 px-3 py-2 text-sm w-64"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">
          Short description (4–5 words)
        </span>
        <input
          type="text"
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          placeholder="e.g. Academic tests, exam prep"
          className="rounded border border-gray-300 px-3 py-2 text-sm w-56"
          maxLength={120}
        />
      </label>
      <button
        type="submit"
        disabled={isCreating || !name.trim()}
        className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
      >
        {isCreating ? "Adding…" : "Add category"}
      </button>
      {Boolean(createError) && (
        <p className="text-sm text-red-600">Failed to add category. Name may already exist.</p>
      )}
    </form>
  );
}

function CategoryRow({
  name,
  description,
  shortDescription,
  itemCount,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
  saveError,
}: {
  name: string;
  description: string;
  shortDescription: string;
  itemCount: number;
  onSave: (body: UpdateCategoryRequest) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
  saveError: unknown;
}) {
  const [editing, setEditing] = React.useState(false);
  const [nameValue, setNameValue] = React.useState(name);
  const [descValue, setDescValue] = React.useState(description);
  const [shortDescValue, setShortDescValue] = React.useState(shortDescription);

  React.useEffect(() => {
    setNameValue(name);
    setDescValue(description);
    setShortDescValue(shortDescription);
  }, [name, description, shortDescription]);

  const handleSave = () => {
    const trimmedName = nameValue.trim();
    const trimmedDesc = descValue.trim() || undefined;
    const trimmedShort = shortDescValue.trim() || undefined;
    const nameChanged = trimmedName !== name;
    const descChanged = (trimmedDesc ?? "") !== (description || "");
    const shortChanged = (trimmedShort ?? "") !== (shortDescription || "");
    if (trimmedName && (nameChanged || descChanged || shortChanged)) {
      onSave({
        name: trimmedName,
        description: trimmedDesc ?? null,
        shortDescription: trimmedShort ?? null,
      });
      setEditing(false);
    } else {
      setNameValue(name);
      setDescValue(description);
      setShortDescValue(shortDescription);
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setNameValue(name);
    setDescValue(description);
    setShortDescValue(shortDescription);
    setEditing(false);
  };

  const canDelete = itemCount === 0;

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2">
        {editing ? (
          <input
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            className="rounded border border-gray-300 text-sm w-full max-w-xs px-2 py-1"
            autoFocus
          />
        ) : (
          <span className="text-sm font-medium text-gray-900">{name}</span>
        )}
      </td>
      <td className="px-4 py-2 max-w-xs">
        {editing ? (
          <input
            type="text"
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            placeholder="Optional description"
            className="rounded border border-gray-300 text-sm w-full px-2 py-1"
          />
        ) : (
          <span className="text-sm text-gray-600">{description || "—"}</span>
        )}
      </td>
      <td className="px-4 py-2 max-w-[12rem]">
        {editing ? (
          <input
            type="text"
            value={shortDescValue}
            onChange={(e) => setShortDescValue(e.target.value)}
            placeholder="4–5 words"
            className="rounded border border-gray-300 text-sm w-full px-2 py-1"
            maxLength={120}
          />
        ) : (
          <span className="text-sm text-gray-600">{shortDescription || "—"}</span>
        )}
      </td>
      <td className="px-4 py-2 text-sm text-gray-600">{itemCount}</td>
      <td className="px-4 py-2 text-right">
        {editing ? (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !nameValue.trim()}
              className="text-sm font-medium text-indigo-ink hover:text-indigo-ink disabled:opacity-50 mr-2"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <span className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm font-medium text-indigo-ink hover:text-indigo-ink"
            >
              Edit
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </span>
        )}
        {Boolean(saveError) && (
          <p className="text-xs text-red-600 mt-1">Save failed. Try again.</p>
        )}
      </td>
    </tr>
  );
}

export default AdminCategoriesPage;
