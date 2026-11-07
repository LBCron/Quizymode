import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import { ideasApi, type IdeaCommentResponse } from "@/api/ideas";
import { useAuth } from "@/contexts/AuthContext";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { getIdeaErrorMessage } from "../ideaErrors";
import { IDEA_COMMENT_MAX, getIdeaCommentError } from "../ideaValidation";

interface IdeaDiscussionPanelProps {
  ideaId: string;
  canPost: boolean;
  postingDisabledMessage?: string | null;
}

const IdeaDiscussionPanel = ({
  ideaId,
  canPost,
  postingDisabledMessage,
}: IdeaDiscussionPanelProps) => {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [newCommentText, setNewCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ideaComments", ideaId],
    queryFn: () => ideasApi.getComments(ideaId),
  });

  const invalidateIdeaQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["ideaComments", ideaId] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "board"] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "mine"] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "admin"] });
  };

  const createMutation = useMutation({
    mutationFn: (text: string) => ideasApi.createComment(ideaId, { text }),
    onSuccess: () => {
      setMutationError(null);
      setNewCommentText("");
      invalidateIdeaQueries();
    },
    onError: (mutationError) => {
      setMutationError(getIdeaErrorMessage(mutationError));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ commentId, text }: { commentId: string; text: string }) =>
      ideasApi.updateComment(ideaId, commentId, { text }),
    onSuccess: () => {
      setMutationError(null);
      setEditingCommentId(null);
      setEditingText("");
      invalidateIdeaQueries();
    },
    onError: (mutationError) => {
      setMutationError(getIdeaErrorMessage(mutationError));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => ideasApi.deleteComment(ideaId, commentId),
    onSuccess: () => {
      setMutationError(null);
      invalidateIdeaQueries();
    },
    onError: (mutationError) => {
      setMutationError(getIdeaErrorMessage(mutationError));
    },
  });

  const comments = data?.comments ?? [];
  // Only surface the inline error once the user has typed something; an empty
  // composer just keeps the Post button disabled.
  const newCommentError = newCommentText.trim()
    ? getIdeaCommentError(newCommentText)
    : null;

  return (
    <div className="space-y-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-700">
            Discussion
          </h4>
          <p className="mt-1 text-sm text-slate-600">
            Ratings are lightweight. Comments are where the trade-offs get sharper.
          </p>
        </div>
      </div>

      {mutationError && (
        <ErrorMessage
          message="Idea discussion update failed"
          errorDetail={mutationError}
          onRetry={() => {
            setMutationError(null);
            refetch();
          }}
        />
      )}

      {isAuthenticated && canPost ? (
        <div className="rounded-2xl border border-slate-200 bg-surface p-4">
          <label htmlFor={`idea-comment-${ideaId}`} className="sr-only">
            New comment
          </label>
          <textarea
            id={`idea-comment-${ideaId}`}
            value={newCommentText}
            onChange={(event) => setNewCommentText(event.target.value)}
            rows={3}
            maxLength={IDEA_COMMENT_MAX + 10}
            aria-invalid={!!newCommentError}
            aria-describedby={`idea-comment-${ideaId}-hint`}
            placeholder="Add context, concerns, or edge cases."
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
          />
          <div
            id={`idea-comment-${ideaId}-hint`}
            className="mt-1.5 flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="text-rose-600">{newCommentError ?? ""}</span>
            <span className="text-slate-400">
              {newCommentText.trim().length}/{IDEA_COMMENT_MAX}
            </span>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (getIdeaCommentError(newCommentText) === null) {
                  createMutation.mutate(newCommentText.trim());
                }
              }}
              disabled={
                getIdeaCommentError(newCommentText) !== null || createMutation.isPending
              }
              className="rounded-full bg-panel px-4 py-2 text-sm font-medium text-on-panel transition hover:bg-panel-raised disabled:opacity-50"
            >
              {createMutation.isPending ? "Posting..." : "Post comment"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-surface px-4 py-3 text-sm text-slate-600">
          {postingDisabledMessage ??
            (isAuthenticated
              ? "Comments are only open on published ideas."
              : "Sign in to join the discussion.")}
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message="Failed to load comments" onRetry={() => refetch()} />
      ) : comments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No comments yet.
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => {
            const isEditing = editingCommentId === comment.id;
            return (
              <CommentCard
                key={comment.id}
                comment={comment}
                isEditing={isEditing}
                editingText={editingText}
                onEdit={() => {
                  setEditingCommentId(comment.id);
                  setEditingText(comment.text);
                }}
                onEditingTextChange={setEditingText}
                onCancelEdit={() => {
                  setEditingCommentId(null);
                  setEditingText("");
                }}
                onSaveEdit={() =>
                  updateMutation.mutate({
                    commentId: comment.id,
                    text: editingText.trim(),
                  })
                }
                onDelete={() => {
                  if (window.confirm("Delete this comment?")) {
                    deleteMutation.mutate(comment.id);
                  }
                }}
                isSaving={updateMutation.isPending}
                isDeleting={deleteMutation.isPending}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

function CommentCard({
  comment,
  isEditing,
  editingText,
  onEdit,
  onEditingTextChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  isSaving,
  isDeleting,
}: {
  comment: IdeaCommentResponse;
  isEditing: boolean;
  editingText: string;
  onEdit: () => void;
  onEditingTextChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}) {
  const editingError = editingText.trim() ? getIdeaCommentError(editingText) : null;

  return (
    <article className="rounded-2xl border border-slate-200 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{comment.authorName}</div>
          <div className="mt-1 text-xs text-slate-500">
            {new Date(comment.createdAt).toLocaleString()}
            {comment.updatedAt && comment.updatedAt !== comment.createdAt && " · edited"}
          </div>
        </div>
        {(comment.canEdit || comment.canDelete) && !isEditing && (
          <div className="flex items-center gap-1">
            {comment.canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Edit comment"
              >
                <PencilIcon className="h-4 w-4" aria-hidden />
              </button>
            )}
            {comment.canDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                className="rounded-full p-2 text-rose-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                aria-label="Delete comment"
              >
                <TrashIcon className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="mt-3 space-y-3">
          <div>
            <textarea
              value={editingText}
              onChange={(event) => onEditingTextChange(event.target.value)}
              rows={3}
              maxLength={IDEA_COMMENT_MAX + 10}
              aria-label="Edit comment text"
              aria-invalid={!!editingError}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            />
            <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-rose-600">{editingError ?? ""}</span>
              <span className="text-slate-400">
                {editingText.trim().length}/{IDEA_COMMENT_MAX}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={getIdeaCommentError(editingText) !== null || isSaving}
              className="rounded-full bg-panel px-4 py-2 text-sm font-medium text-on-panel transition hover:bg-panel-raised disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{comment.text}</p>
      )}
    </article>
  );
}

export default IdeaDiscussionPanel;
