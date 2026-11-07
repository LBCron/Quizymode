import {
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import {
  ideasApi,
  type IdeaModerationState,
  type IdeaSummaryResponse,
  type IdeaStatus,
} from "@/api/ideas";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/utils/apiError";
import { getIdeaErrorMessage } from "@/features/ideas/ideaErrors";
import IdeaCard from "@/features/ideas/components/IdeaCard";
import IdeaPager from "@/features/ideas/components/IdeaPager";
import IdeaFormModal, {
  type IdeaFormValues,
} from "@/features/ideas/components/IdeaFormModal";
import {
  formatModerationLabel,
  matchesIdeaSearch,
  sortIdeas,
} from "@/features/ideas/ideaBoard";

type AdminIdeaFilter = IdeaModerationState | "all";

const FILTERS: AdminIdeaFilter[] = [
  "PendingReview",
  "Published",
  "Rejected",
  "all",
];

function formatFilterLabel(filter: AdminIdeaFilter): string {
  return filter === "all" ? "All" : formatModerationLabel(filter);
}

const AdminIdeasPage = () => {
  const { isAdmin, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] =
    useState<AdminIdeaFilter>("PendingReview");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [expandedIdeaIds, setExpandedIdeaIds] = useState<string[]>([]);
  const [editingIdea, setEditingIdea] = useState<IdeaSummaryResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusUpdatingIdeaId, setStatusUpdatingIdeaId] = useState<string | null>(
    null
  );

  const ideasQuery = useQuery({
    queryKey: ["ideas", "admin", activeFilter, page],
    queryFn: () => ideasApi.getAdminIdeas(activeFilter, page),
    enabled: isAuthenticated && isAdmin,
    placeholderData: keepPreviousData,
  });

  const invalidateIdeaQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["ideas", "board"] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "mine"] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "admin"] });
  };

  const updateMutation = useMutation({
    mutationFn: (values: IdeaFormValues) => {
      if (!editingIdea) {
        throw new Error("No idea is selected for editing.");
      }

      return ideasApi.update(editingIdea.id, {
        title: values.title.trim(),
        problem: values.problem.trim(),
        proposedChange: values.proposedChange.trim(),
        tradeOffs: values.tradeOffs.trim() || null,
      });
    },
    onSuccess: () => {
      setActionError(null);
      setFormError(null);
      setEditingIdea(null);
      invalidateIdeaQueries();
    },
    onError: (error) => {
      setFormError(getIdeaErrorMessage(error));
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({
      ideaId,
      moderationNotes,
    }: {
      ideaId: string;
      moderationNotes: string;
    }) =>
      ideasApi.approve(
        ideaId,
        moderationNotes ? { moderationNotes } : undefined
      ),
    onSuccess: () => {
      setActionError(null);
      invalidateIdeaQueries();
    },
    onError: (error) => {
      setActionError(getIdeaErrorMessage(error));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      ideaId,
      moderationNotes,
    }: {
      ideaId: string;
      moderationNotes: string;
    }) => ideasApi.reject(ideaId, { moderationNotes }),
    onSuccess: () => {
      setActionError(null);
      invalidateIdeaQueries();
    },
    onError: (error) => {
      setActionError(getIdeaErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ideaId: string) => ideasApi.delete(ideaId),
    onSuccess: () => {
      setActionError(null);
      invalidateIdeaQueries();
    },
    onError: (error) => {
      setActionError(getIdeaErrorMessage(error));
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ ideaId, status }: { ideaId: string; status: IdeaStatus }) =>
      ideasApi.updateStatus(ideaId, { status }),
    onMutate: ({ ideaId }) => {
      setStatusUpdatingIdeaId(ideaId);
    },
    onSuccess: () => {
      setActionError(null);
      invalidateIdeaQueries();
    },
    onError: (error) => {
      setActionError(getIdeaErrorMessage(error));
    },
    onSettled: () => {
      setStatusUpdatingIdeaId(null);
    },
  });

  const filteredIdeas = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return sortIdeas(
      (ideasQuery.data?.ideas ?? []).filter((idea) =>
        matchesIdeaSearch(idea, normalizedSearch)
      ),
      "recent"
    );
  }, [ideasQuery.data?.ideas, search]);

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <div className="px-4 py-6 sm:px-0">
        <div className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_48%,#fefce8_100%)] p-6 shadow-lg shadow-amber-950/5">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Ideas moderation
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            Review queued ideas, publish the good ones, reject the noisy ones,
            and update roadmap status without leaving the moderation queue.
          </p>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    setActiveFilter(filter);
                    setPage(1);
                  }}
                  aria-pressed={activeFilter === filter}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeFilter === filter
                      ? "bg-panel text-on-panel"
                      : "border border-slate-300 bg-surface text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {formatFilterLabel(filter)}
                </button>
              ))}
            </div>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, problem, change, or notes"
              className="w-full rounded-full border border-slate-300 bg-surface px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-amber-500 lg:w-96"
            />
          </div>
        </div>

        {actionError && (
          <div className="mt-6">
            <ErrorMessage
              message="Idea moderation action failed"
              errorDetail={actionError}
              onRetry={() => {
                setActionError(null);
                ideasQuery.refetch();
              }}
            />
          </div>
        )}

        {ideasQuery.isLoading ? (
          <div className="mt-6">
            <LoadingSpinner />
          </div>
        ) : ideasQuery.error ? (
          <div className="mt-6">
            <ErrorMessage
              message="Failed to load ideas moderation queue"
              errorDetail={getApiErrorMessage(ideasQuery.error)}
              onRetry={() => ideasQuery.refetch()}
            />
          </div>
        ) : filteredIdeas.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-surface px-4 py-8 text-center text-sm text-slate-500">
            No ideas match this moderation filter right now.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {filteredIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                expanded={expandedIdeaIds.includes(idea.id)}
                sectionStyle="admin"
                statusUpdatePending={statusUpdatingIdeaId === idea.id}
                onToggleExpand={() => toggleExpandedId(idea.id, setExpandedIdeaIds)}
                onEdit={() => {
                  setFormError(null);
                  setEditingIdea(idea);
                }}
                onDelete={() => {
                  if (window.confirm("Delete this idea?")) {
                    deleteMutation.mutate(idea.id);
                  }
                }}
                onStatusChange={(status) =>
                  statusMutation.mutate({ ideaId: idea.id, status })
                }
                extraActions={
                  <ModerationPanel
                    idea={idea}
                    isApproving={approveMutation.isPending}
                    isRejecting={rejectMutation.isPending}
                    onApprove={(moderationNotes) =>
                      approveMutation.mutate({ ideaId: idea.id, moderationNotes })
                    }
                    onReject={(moderationNotes) =>
                      rejectMutation.mutate({ ideaId: idea.id, moderationNotes })
                    }
                  />
                }
              />
            ))}
          </div>
        )}
        <IdeaPager
          page={page}
          pageSize={ideasQuery.data?.pageSize ?? 50}
          totalCount={ideasQuery.data?.totalCount ?? 0}
          onPageChange={setPage}
          tone="light"
          label="Moderation queue pagination"
        />
      </div>

      <IdeaFormModal
        isOpen={editingIdea !== null}
        title="Edit idea submission"
        submitLabel="Save changes"
        initialValues={
          editingIdea
            ? {
                title: editingIdea.title,
                problem: editingIdea.problem,
                proposedChange: editingIdea.proposedChange,
                tradeOffs: editingIdea.tradeOffs ?? "",
              }
            : undefined
        }
        isPending={updateMutation.isPending}
        errorMessage={formError}
        helperText="Admin edits are saved immediately and keep the current moderation state unless the content itself is changed again later."
        onClose={() => {
          if (updateMutation.isPending) {
            return;
          }

          setEditingIdea(null);
          setFormError(null);
        }}
        onSubmit={(values) => updateMutation.mutate(values)}
      />
    </>
  );
};

function ModerationPanel({
  idea,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
}: {
  idea: IdeaSummaryResponse;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: (moderationNotes: string) => void;
  onReject: (moderationNotes: string) => void;
}) {
  const [note, setNote] = useState(idea.moderationNotes ?? "");

  return (
    <div className="rounded-2xl border border-amber-200 bg-surface px-4 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex-1">
          <label
            htmlFor={`idea-reject-note-${idea.id}`}
            className="block text-sm font-medium text-slate-900"
          >
            Moderation note
            <span className="font-normal text-slate-500">
              {" "}
              (required to reject, optional when approving)
            </span>
          </label>
          <textarea
            id={`idea-reject-note-${idea.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Explain why this idea should stay private or what needs improvement."
            className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-500"
          />
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          {idea.moderationState !== "Published" && (
            <button
              type="button"
              onClick={() => onApprove(note.trim())}
              disabled={isApproving || isRejecting}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {isApproving ? "Publishing..." : "Approve and publish"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onReject(note.trim())}
            disabled={!note.trim() || isApproving || isRejecting}
            className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {isRejecting ? "Rejecting..." : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toggleExpandedId(
  id: string,
  setExpandedIdeaIds: Dispatch<SetStateAction<string[]>>
) {
  setExpandedIdeaIds((current) =>
    current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]
  );
}

export default AdminIdeasPage;
