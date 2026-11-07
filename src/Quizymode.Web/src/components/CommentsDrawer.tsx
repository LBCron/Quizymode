/**
 * Drawer/sheet for viewing and adding comments without leaving the study flow.
 * Desktop: right-side drawer; mobile: full-screen overlay.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { commentsApi, type CommentResponse } from "@/api/comments";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { XMarkIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import LoadingSpinner from "./LoadingSpinner";
import ErrorMessage from "./ErrorMessage";

export interface CommentsDrawerProps {
  itemId: string | null;
  onClose: () => void;
  /** Optional: when in study flow, pass item list and index for prev/next in drawer */
  onNavigateToItem?: (itemId: string) => void;
  previousItemId?: string | null;
  nextItemId?: string | null;
}

export function CommentsDrawer({
  itemId,
  onClose,
  onNavigateToItem,
  previousItemId,
  nextItemId,
}: CommentsDrawerProps) {
  const { isAuthenticated } = useAuth();
  const currentUserId = useCurrentUserId();
  const queryClient = useQueryClient();
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newCommentText, setNewCommentText] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["comments", itemId],
    queryFn: () => commentsApi.getByItemId(itemId!),
    enabled: !!itemId,
  });

  const createMutation = useMutation({
    mutationFn: (text: string) =>
      commentsApi.create({ itemId: itemId!, text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", itemId] });
      setNewCommentText("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      commentsApi.update(id, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", itemId] });
      setEditingCommentId(null);
      setEditText("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => commentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["comments", itemId] });
    },
  });

  const handleEdit = (comment: CommentResponse) => {
    setEditingCommentId(comment.id);
    setEditText(comment.text);
  };

  const handleSaveEdit = () => {
    if (editingCommentId && editText.trim()) {
      updateMutation.mutate({ id: editingCommentId, text: editText.trim() });
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditText("");
  };

  if (!itemId) return null;

  const isOpen = !!itemId;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        style={{ opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? "auto" : "none" }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div
        className="fixed top-0 right-0 h-full w-full sm:max-w-md bg-surface shadow-xl z-50 flex flex-col transition-transform duration-200 ease-out"
        style={{
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
        }}
        role="dialog"
        aria-label="Comments"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Comments</h2>
          <div className="flex items-center gap-2">
            {onNavigateToItem && (previousItemId || nextItemId) && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    previousItemId && onNavigateToItem(previousItemId)
                  }
                  disabled={!previousItemId}
                  className="p-2 text-gray-600 hover:bg-gray-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Previous item"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() =>
                    nextItemId && onNavigateToItem(nextItemId)
                  }
                  disabled={!nextItemId}
                  className="p-2 text-gray-600 hover:bg-gray-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Next item"
                >
                  →
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-500 hover:bg-gray-200 rounded-md"
              aria-label="Close"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage
              message="Failed to load comments"
              onRetry={() => refetch()}
            />
          ) : (
            <>
              {isAuthenticated && (
                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <textarea
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    placeholder="Write your comment..."
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-3"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newCommentText.trim()) {
                        createMutation.mutate(newCommentText.trim());
                      }
                    }}
                    disabled={
                      !newCommentText.trim() || createMutation.isPending
                    }
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {createMutation.isPending ? "Posting..." : "Post Comment"}
                  </button>
                </div>
              )}

              <div className="space-y-3">
                {(data?.comments || []).length > 0 ? (
                  (data?.comments || []).map((comment) => {
                    const isOwner = !!currentUserId && comment.createdBy === currentUserId;
                    const isEditing = editingCommentId === comment.id;

                    return (
                      <div
                        key={comment.id}
                        className="bg-surface border border-gray-200 rounded-lg p-4"
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={3}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                disabled={
                                  !editText.trim() || updateMutation.isPending
                                }
                                className="px-3 py-1 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                              >
                                {updateMutation.isPending ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between items-start gap-2 mb-1">
                              <span className="text-sm font-medium text-gray-900">
                                {comment.createdByName || comment.createdBy}
                              </span>
                              <span className="text-xs text-gray-500 shrink-0">
                                {new Date(
                                  comment.createdAt
                                ).toLocaleDateString()}
                                {comment.updatedAt &&
                                  comment.updatedAt !== comment.createdAt && (
                                  <span className="ml-1">(edited)</span>
                                )}
                              </span>
                            </div>
                            <div className="flex justify-between items-start gap-2">
                              <p className="text-sm text-gray-700 flex-1">
                                {comment.text}
                              </p>
                              {isOwner && (
                                <div className="flex gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleEdit(comment)}
                                    className="p-1 text-indigo-ink hover:bg-indigo-50 rounded"
                                    title="Edit"
                                  >
                                    <PencilIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "Delete this comment?"
                                        )
                                      ) {
                                        deleteMutation.mutate(comment.id);
                                      }
                                    }}
                                    disabled={deleteMutation.isPending}
                                    className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                                    title="Delete"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-gray-500 text-center py-6">
                    No comments yet. Be the first to comment!
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
