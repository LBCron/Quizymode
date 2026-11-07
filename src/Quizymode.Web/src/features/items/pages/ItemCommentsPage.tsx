import { useState } from "react";
import { sanitizeInAppPath } from "@/utils/safeInAppPath";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { commentsApi } from "@/api/comments";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { categoryNameToSlug } from "@/utils/categorySlug";
import { PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";

const ItemCommentsPage = () => {
  const { id: itemId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const currentUserId = useCurrentUserId();
  const queryClient = useQueryClient();
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newCommentText, setNewCommentText] = useState("");

  // Read navigation context from URL params
  const mode = searchParams.get("mode") as "explore" | "quiz" | null;
  const category = searchParams.get("category");
  const collectionId = searchParams.get("collectionId");
  const currentIndexParam = searchParams.get("currentIndex");
  const itemIdsParam = searchParams.get("itemIds");

  const currentIndex = currentIndexParam
    ? parseInt(currentIndexParam, 10)
    : null;
  const itemIds = itemIdsParam ? itemIdsParam.split(",") : [];
  const returnUrl = sanitizeInAppPath(searchParams.get("return"));
  const hasNavigation = mode && currentIndex !== null && itemIds.length > 0;

  const handleNavigateBack = () => {
    if (returnUrl) {
      navigate(returnUrl);
      return;
    }
    if (hasNavigation && mode && currentIndex !== null && itemId) {
      // Navigate back to the item in the list context
      // If we have category/collection, navigate with itemId (will load full list)
      // If no category/collection, navigate to list view but preserve itemIds in sessionStorage
      if (collectionId) {
        navigate(`/${mode}/collection/${collectionId}/item/${itemId}`);
      } else if (category) {
        navigate(`/${mode}/${categoryNameToSlug(category)}/item/${itemId}`);
      } else {
        // No category/collection - navigate to item view with itemId
        // This ensures the item is shown and items are restored from sessionStorage
        navigate(`/${mode}/item/${itemId}`);
      }
    } else {
      navigate(`/explore/item/${itemId}`);
    }
  };

  const handleNavigateToItem = (targetItemId: string) => {
    if (hasNavigation && mode) {
      const targetIndex = itemIds.indexOf(targetItemId);
      if (targetIndex !== -1) {
        if (collectionId) {
          navigate(`/${mode}/collection/${collectionId}/item/${targetItemId}`);
        } else if (category) {
          navigate(
            `/${mode}/${categoryNameToSlug(category)}/item/${targetItemId}`
          );
        } else {
          navigate(`/${mode}/item/${targetItemId}`);
        }
      }
    } else {
      navigate(`/explore/item/${targetItemId}`);
    }
  };

  const getPreviousItemId = (): string | null => {
    if (!hasNavigation || currentIndex === null) return null;
    const prevIndex = currentIndex - 1;
    return prevIndex >= 0 ? itemIds[prevIndex] : null;
  };

  const getNextItemId = (): string | null => {
    if (!hasNavigation || currentIndex === null) return null;
    const nextIndex = currentIndex + 1;
    return nextIndex < itemIds.length ? itemIds[nextIndex] : null;
  };

  const previousItemId = getPreviousItemId();
  const nextItemId = getNextItemId();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["comments", itemId],
    queryFn: () => commentsApi.getByItemId(itemId!),
    enabled: !!itemId,
  });

  const createMutation = useMutation({
    mutationFn: (text: string) => commentsApi.create({ itemId: itemId!, text }),
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

  const handleEdit = (comment: { id: string; text: string }) => {
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

  if (isLoading) return <LoadingSpinner />;
  if (error)
    return (
      <ErrorMessage
        message="Failed to load comments"
        onRetry={() => refetch()}
      />
    );

  const comments = data?.comments || [];

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <button
            onClick={handleNavigateBack}
            className="text-indigo-ink hover:text-indigo-ink text-sm font-medium"
          >
            ← Back to item
          </button>
          {hasNavigation && (
            <div className="flex space-x-2">
              <button
                onClick={() =>
                  previousItemId && handleNavigateToItem(previousItemId)
                }
                disabled={!previousItemId}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Previous
              </button>
              <button
                onClick={() => nextItemId && handleNavigateToItem(nextItemId)}
                disabled={!nextItemId}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Next
              </button>
            </div>
          )}
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Comments</h1>
        <p className="text-gray-600 text-sm mb-6">
          View and manage comments for this quiz item. Add your own comments, edit or delete your comments, and navigate to related items mentioned in comments.
        </p>

        {/* Add Comment Form */}
        {isAuthenticated && (
          <div className="bg-surface shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              Add a Comment
            </h2>
            <textarea
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Write your comment..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-4"
            />
            <div className="flex justify-end">
              <button
                onClick={() => {
                  if (newCommentText.trim()) {
                    createMutation.mutate(newCommentText.trim());
                  }
                }}
                disabled={!newCommentText.trim() || createMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {createMutation.isPending ? "Posting..." : "Post Comment"}
              </button>
            </div>
          </div>
        )}

        {/* Comments List */}
        <div className="space-y-4">
          {comments.length > 0 ? (
            comments.map((comment) => {
              const isOwner = !!currentUserId && comment.createdBy === currentUserId;
              const isEditing = editingCommentId === comment.id;

              return (
                <div
                  key={comment.id}
                  className="bg-surface shadow rounded-lg p-6"
                >
                  {isEditing ? (
                    <div className="space-y-4">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1 text-sm text-gray-700 hover:text-gray-900"
                        >
                          Cancel
                        </button>
                        <button
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
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-sm font-medium text-gray-900">
                            {comment.createdByName || comment.createdBy}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">
                            {new Date(comment.createdAt).toLocaleDateString()}
                            {comment.updatedAt &&
                              comment.updatedAt !== comment.createdAt && (
                                <span className="ml-1">(edited)</span>
                              )}
                          </span>
                        </div>
                        {isOwner && (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleEdit(comment)}
                              className="p-1 text-indigo-ink hover:text-indigo-ink"
                              title="Edit comment"
                            >
                              <PencilIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Are you sure you want to delete this comment?"
                                  )
                                ) {
                                  deleteMutation.mutate(comment.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="p-1 text-red-600 hover:text-red-700 disabled:opacity-50"
                              title="Delete comment"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-gray-700">{comment.text}</p>
                    </>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-center py-12 bg-surface shadow rounded-lg">
              <p className="text-gray-500">
                No comments yet. Be the first to comment!
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ItemCommentsPage;
