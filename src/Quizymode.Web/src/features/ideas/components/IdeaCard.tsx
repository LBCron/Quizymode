import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import {
  ideasApi,
  type IdeaStatus,
  type IdeaSummaryResponse,
} from "@/api/ideas";
import { useAuth } from "@/contexts/AuthContext";
import { getIdeaErrorMessage } from "../ideaErrors";
import {
  buildIdeaExcerpt,
  formatIdeaTimestamp,
  formatModerationLabel,
  formatStatusLabel,
  getAllowedStatusTransitions,
  getModerationBadgeClass,
  getStatusBadgeClass,
  STATUS_ORDER,
} from "../ideaBoard";
import IdeaDiscussionPanel from "./IdeaDiscussionPanel";

type SectionStyle = "public" | "private" | "admin";

interface IdeaCardProps {
  idea: IdeaSummaryResponse;
  expanded: boolean;
  sectionStyle?: SectionStyle;
  statusUpdatePending?: boolean;
  extraActions?: ReactNode;
  onToggleExpand: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onStatusChange?: (status: IdeaStatus) => void;
}

const SECTION_CLASS_MAP: Record<SectionStyle, string> = {
  public: "border-slate-200 bg-surface",
  private: "border-slate-200 bg-surface",
  admin: "border-amber-200/80 bg-amber-50/40",
};

const IdeaCard = ({
  idea,
  expanded,
  sectionStyle = "public",
  statusUpdatePending = false,
  extraActions,
  onToggleExpand,
  onEdit,
  onDelete,
  onStatusChange,
}: IdeaCardProps) => {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [optimisticRating, setOptimisticRating] = useState<number | null | undefined>(
    undefined
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimisticRating(undefined);
  }, [idea.id, idea.myRating]);

  const ratingMutation = useMutation({
    mutationFn: (stars: number | null) => ideasApi.setRating(idea.id, { stars }),
    onSuccess: (response) => {
      setRatingError(null);
      setOptimisticRating(response.stars ?? null);
      queryClient.invalidateQueries({ queryKey: ["ideas", "board"] });
      queryClient.invalidateQueries({ queryKey: ["ideas", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["ideas", "admin"] });
    },
    onError: (error) => {
      setOptimisticRating(undefined);
      setRatingError(getIdeaErrorMessage(error));
    },
  });

  const canRate = isAuthenticated && idea.moderationState === "Published";
  const currentRating = optimisticRating ?? idea.myRating ?? null;
  const statusBadgeClass = getStatusBadgeClass(idea.status);
  const moderationBadgeClass = getModerationBadgeClass(idea.moderationState);

  return (
    <article
      className={`overflow-hidden rounded-[26px] border p-5 shadow-lg shadow-slate-950/5 ${SECTION_CLASS_MAP[sectionStyle]}`}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusBadgeClass}`}
              >
                {formatStatusLabel(idea.status)}
              </span>
              {(sectionStyle !== "public" || idea.moderationState !== "Published") && (
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${moderationBadgeClass}`}
                >
                  {formatModerationLabel(idea.moderationState)}
                </span>
              )}
            </div>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
              {idea.title}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
              <span>{idea.authorName}</span>
              <span>{formatIdeaTimestamp(idea.createdAt, idea.updatedAt)}</span>
              {idea.reviewedAt && idea.reviewedByName && (
                <span>
                  Reviewed by {idea.reviewedByName} on{" "}
                  {new Date(idea.reviewedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {idea.canEdit && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <PencilIcon className="h-4 w-4" aria-hidden />
                Edit
              </button>
            )}
            {idea.canDelete && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-2 rounded-full border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
              >
                <TrashIcon className="h-4 w-4" aria-hidden />
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onToggleExpand}
              className="inline-flex items-center gap-2 rounded-full bg-panel px-4 py-2 text-sm font-medium text-on-panel transition hover:bg-panel-raised"
            >
              {expanded ? "Collapse" : "Open"}
              {expanded ? (
                <ChevronUpIcon className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronDownIcon className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <IdeaField
            label="Problem"
            text={expanded ? idea.problem : buildIdeaExcerpt(idea.problem, 170)}
          />
          <IdeaField
            label="Proposed change"
            text={
              expanded
                ? idea.proposedChange
                : buildIdeaExcerpt(idea.proposedChange, 170)
            }
          />
          <IdeaField
            label="Trade-offs"
            text={
              idea.tradeOffs
                ? expanded
                  ? idea.tradeOffs
                  : buildIdeaExcerpt(idea.tradeOffs, 170)
                : "None noted yet."
            }
            muted={!idea.tradeOffs}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
          <IdeaRatingControl
            averageStars={idea.averageStars}
            ratingCount={idea.ratingCount}
            currentRating={currentRating}
            canRate={canRate}
            isPending={ratingMutation.isPending}
            onRate={(stars) => {
              const nextRating = currentRating === stars ? null : stars;
              setOptimisticRating(nextRating);
              ratingMutation.mutate(nextRating);
            }}
          />
          <div className="inline-flex items-center gap-2 text-sm text-slate-600">
            <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden />
            <span>
              {idea.commentCount} comment{idea.commentCount === 1 ? "" : "s"}
            </span>
          </div>
          {ratingError && (
            <div className="text-sm text-rose-700" role="alert">
              {ratingError}
            </div>
          )}
        </div>

        {expanded && (
          <div className="space-y-4 border-t border-slate-200 pt-4">
            {idea.moderationNotes && (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  idea.moderationState === "Rejected"
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <div className="font-semibold">
                  {idea.moderationState === "Rejected"
                    ? "Rejection note"
                    : "Moderation note"}
                </div>
                <p className="mt-1 whitespace-pre-wrap">{idea.moderationNotes}</p>
              </div>
            )}

            {idea.canChangeStatus && onStatusChange && (
              <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Lifecycle status
                  </div>
                  <div className="text-sm text-slate-600">
                    Update where this idea sits on the roadmap.
                  </div>
                </div>
                <select
                  value={idea.status}
                  onChange={(event) =>
                    onStatusChange(event.target.value as IdeaStatus)
                  }
                  disabled={
                    statusUpdatePending || idea.moderationState !== "Published"
                  }
                  title={
                    idea.moderationState !== "Published"
                      ? "Only published ideas can change lifecycle status."
                      : undefined
                  }
                  className="rounded-full border border-slate-300 bg-surface px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-emerald-500"
                >
                  {STATUS_ORDER.filter(
                    (status) =>
                      status === idea.status ||
                      getAllowedStatusTransitions(idea.status).includes(status)
                  ).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {extraActions}

            {idea.moderationState === "Published" ? (
              <IdeaDiscussionPanel
                ideaId={idea.id}
                canPost={isAuthenticated}
                postingDisabledMessage="Sign in to add context, trade-offs, or edge cases."
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600">
                Comments and ratings only open after an idea is published.
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

function IdeaField({
  label,
  text,
  muted = false,
}: {
  label: string;
  text: string;
  muted?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-surface/80 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </h4>
      <p
        className={`mt-3 whitespace-pre-wrap text-sm leading-7 ${
          muted ? "text-slate-500" : "text-slate-700"
        }`}
      >
        {text}
      </p>
    </section>
  );
}

function IdeaRatingControl({
  averageStars,
  ratingCount,
  currentRating,
  canRate,
  isPending,
  onRate,
}: {
  averageStars?: number | null;
  ratingCount: number;
  currentRating: number | null;
  canRate: boolean;
  isPending: boolean;
  onRate: (stars: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((star) => {
          const isFilled = currentRating !== null && star <= currentRating;
          const iconClass = "h-5 w-5";

          if (!canRate) {
            return isFilled ? (
              <StarIconSolid key={star} className={`${iconClass} text-amber-400`} />
            ) : (
              <StarIconOutline
                key={star}
                className={`${iconClass} text-on-panel-muted`}
              />
            );
          }

          return (
            <button
              key={star}
              type="button"
              disabled={isPending}
              onClick={() => onRate(star)}
              className="rounded-full text-amber-400 transition hover:scale-[1.04] disabled:opacity-50"
              aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
            >
              {isFilled ? (
                <StarIconSolid className={iconClass} />
              ) : (
                <StarIconOutline className={iconClass} />
              )}
            </button>
          );
        })}
      </div>
      <div className="text-sm text-slate-600">
        {averageStars != null ? averageStars.toFixed(1) : "No ratings yet"}
        <span className="ml-1 text-slate-500">
          ({ratingCount} rating{ratingCount === 1 ? "" : "s"})
        </span>
      </div>
    </div>
  );
}

export default IdeaCard;
