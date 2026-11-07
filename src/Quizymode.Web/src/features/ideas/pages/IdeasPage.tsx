import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowUpRightIcon, LightBulbIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { ideasApi, type IdeaSummaryResponse, type IdeaStatus } from "@/api/ideas";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { SEO } from "@/components/SEO";
import { useAuth } from "@/contexts/AuthContext";
import { getApiErrorMessage } from "@/utils/apiError";
import { getIdeaErrorMessage } from "../ideaErrors";
import IdeaCard from "../components/IdeaCard";
import IdeaPager from "../components/IdeaPager";
import IdeaFormModal, { type IdeaFormValues } from "../components/IdeaFormModal";
import {
  type BoardSort,
  formatModerationLabel,
  groupIdeasByModeration,
  groupIdeasByStatus,
  matchesIdeaSearch,
  MODERATION_ORDER,
  sortIdeas,
  STATUS_ORDER,
} from "../ideaBoard";

const IdeasPage = () => {
  const { isAdmin, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<BoardSort>("recent");
  const [expandedIdeaIds, setExpandedIdeaIds] = useState<string[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState<IdeaSummaryResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusUpdatingIdeaId, setStatusUpdatingIdeaId] = useState<string | null>(
    null
  );

  const [boardPage, setBoardPage] = useState(1);
  const [minePage, setMinePage] = useState(1);

  const boardQuery = useQuery({
    queryKey: ["ideas", "board", boardPage],
    queryFn: () => ideasApi.getBoard(boardPage),
    placeholderData: keepPreviousData,
  });

  const mineQuery = useQuery({
    queryKey: ["ideas", "mine", minePage],
    queryFn: () => ideasApi.getMine(minePage),
    enabled: isAuthenticated,
    placeholderData: keepPreviousData,
  });

  const invalidateIdeaQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["ideas", "board"] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "mine"] });
    queryClient.invalidateQueries({ queryKey: ["ideas", "admin"] });
  };

  const createMutation = useMutation({
    mutationFn: (values: IdeaFormValues) =>
      ideasApi.create({
        title: values.title.trim(),
        problem: values.problem.trim(),
        proposedChange: values.proposedChange.trim(),
        tradeOffs: values.tradeOffs.trim() || null,
        turnstileToken: values.turnstileToken ?? "",
      }),
    onSuccess: () => {
      setActionError(null);
      setFormError(null);
      setCreateModalOpen(false);
      invalidateIdeaQueries();
    },
    onError: (error) => {
      setFormError(getIdeaErrorMessage(error));
    },
  });

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

  const boardIdeas = boardQuery.data?.ideas ?? [];
  const filteredBoardIdeas = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return sortIdeas(
      boardIdeas.filter((idea) => matchesIdeaSearch(idea, normalizedSearch)),
      sortBy
    );
  }, [boardIdeas, search, sortBy]);

  const groupedBoardIdeas = useMemo(
    () => groupIdeasByStatus(filteredBoardIdeas),
    [filteredBoardIdeas]
  );

  const myIdeas = mineQuery.data?.ideas ?? [];
  const groupedMyIdeas = useMemo(
    () => groupIdeasByModeration(sortIdeas(myIdeas, "recent")),
    [myIdeas]
  );

  const boardHasResults = filteredBoardIdeas.length > 0;
  const modalPending = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <SEO
        title="Ideas"
        description="Browse proposed, planned, in-progress, shipped, and archived Quizymode ideas. Signed-in users can submit new ideas, rate them, and join the discussion."
        canonical="https://www.quizymode.com/ideas"
      />

      <div className="bg-panel-deep text-on-panel">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[36px] border border-on-panel/10 bg-[linear-gradient(135deg,var(--color-panel)_0%,rgba(16,185,129,0.14)_50%,var(--color-panel-deep)_100%)] shadow-2xl shadow-slate-950/30">
            <div className="grid gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.9fr)] lg:px-8 lg:py-9">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-ink">
                  <LightBulbIcon className="h-4 w-4" aria-hidden />
                  Ideas board
                </div>
                <h1 className="mt-3 max-w-3xl text-xl font-semibold tracking-tight text-on-panel sm:text-2xl lg:text-[1.65rem] lg:leading-snug">
                  Product thinking, out in the open
                </h1>
                <p className="mt-1.5 max-w-2xl text-xs leading-5 text-on-panel-muted lg:text-sm">
                  Each idea stays intentionally simple: the problem, the proposed
                  change, the trade-offs, the current status, and the conversation
                  around whether it is worth building.
                </p>
              </div>

              <div className="rounded-[28px] border border-on-panel/10 bg-on-panel/5 p-5 shadow-lg">
                <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
                  How this board works
                </div>
                <ul className="mt-4 space-y-3 text-sm leading-7 text-on-panel-muted">
                  <li>Anyone can browse published ideas, ratings, and comments.</li>
                  <li>Signed-in users can submit ideas, rate, and join the discussion.</li>
                  <li>New submissions start in review before they go public.</li>
                </ul>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFormError(null);
                        setCreateModalOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
                    >
                      Share an idea
                      <ArrowUpRightIcon className="h-4 w-4" aria-hidden />
                    </button>
                  ) : (
                    <div className="rounded-2xl border border-panel-raised bg-panel-raised/60 px-4 py-3 text-sm text-on-panel-muted">
                      <Link to="/login" className="font-semibold text-emerald-400 hover:text-emerald-ink">
                        Sign in
                      </Link>{" "}
                      to submit ideas, rate, and comment.
                    </div>
                  )}

                  {isAdmin && (
                    <Link
                      to="/admin/ideas"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-5 py-2.5 text-sm font-medium text-on-panel-muted transition hover:bg-panel-raised"
                    >
                      Moderate ideas
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </section>

          {isAuthenticated && (
            <section className="mt-6 rounded-[28px] border border-on-panel/10 bg-panel/70 p-5 shadow-xl shadow-slate-950/25">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-on-panel">
                    My submissions
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Pending, published, and rejected ideas stay visible here even when
                    they are not public yet.
                  </p>
                </div>
              </div>

              {mineQuery.isLoading ? (
                <div className="mt-4">
                  <LoadingSpinner />
                </div>
              ) : mineQuery.error ? (
                <div className="mt-4">
                  <ErrorMessage
                    message="Failed to load your idea submissions"
                    errorDetail={getApiErrorMessage(mineQuery.error)}
                    onRetry={() => mineQuery.refetch()}
                  />
                </div>
              ) : myIdeas.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-panel-raised px-4 py-6 text-sm text-slate-500">
                  You have not submitted any ideas yet.
                </div>
              ) : (
                <div className="mt-4 grid gap-5 lg:grid-cols-3">
                  {MODERATION_ORDER.map((moderationState) => (
                    <div
                      key={moderationState}
                      className="rounded-[24px] border border-on-panel/10 bg-panel-raised/50 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold text-on-panel">
                          {formatModerationLabel(moderationState)}
                        </h3>
                        <span className="rounded-full bg-panel-raised px-2.5 py-1 text-xs font-semibold text-on-panel-muted">
                          {groupedMyIdeas[moderationState].length}
                        </span>
                      </div>

                      <div className="mt-4 space-y-4">
                        {groupedMyIdeas[moderationState].length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-panel-raised px-4 py-4 text-sm text-slate-500">
                            Nothing here right now.
                          </div>
                        ) : (
                          groupedMyIdeas[moderationState].map((idea) => (
                            <IdeaCard
                              key={`mine:${idea.id}`}
                              idea={idea}
                              expanded={expandedIdeaIds.includes(`mine:${idea.id}`)}
                              sectionStyle="private"
                              statusUpdatePending={statusUpdatingIdeaId === idea.id}
                              onToggleExpand={() =>
                                toggleExpandedId(`mine:${idea.id}`, setExpandedIdeaIds)
                              }
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
                            />
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <IdeaPager
                page={minePage}
                pageSize={mineQuery.data?.pageSize ?? 50}
                totalCount={mineQuery.data?.totalCount ?? 0}
                onPageChange={setMinePage}
                label="My submissions pagination"
              />
            </section>
          )}

          <section className="mt-6 rounded-[30px] border border-on-panel/10 bg-panel/70 p-5 shadow-xl shadow-slate-950/25">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-on-panel">
                  Public board
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Published ideas are grouped by lifecycle state and can be sorted by
                  recent activity or rating.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="min-w-0">
                  <span className="sr-only">Search ideas</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search titles, problems, changes, or trade-offs"
                    className="w-full rounded-full border border-panel-raised bg-panel-raised/80 px-4 py-2.5 text-sm text-on-panel outline-none transition focus:border-emerald-500 placeholder:text-slate-500 sm:w-80"
                  />
                </label>

                <label className="flex items-center gap-2 rounded-full border border-panel-raised bg-panel-raised/80 px-4 py-2.5 text-sm text-on-panel">
                  <span className="font-medium text-slate-400">Sort</span>
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as BoardSort)}
                    className="bg-transparent outline-none text-on-panel"
                  >
                    <option value="recent">Recently updated</option>
                    <option value="rating">Top rated</option>
                  </select>
                </label>
              </div>
            </div>

            {actionError && (
              <div className="mt-4">
                <ErrorMessage
                  message="Idea action failed"
                  errorDetail={actionError}
                  onRetry={() => {
                    setActionError(null);
                    boardQuery.refetch();
                    if (isAuthenticated) {
                      mineQuery.refetch();
                    }
                  }}
                />
              </div>
            )}

            {boardQuery.isLoading ? (
              <div className="mt-6">
                <LoadingSpinner />
              </div>
            ) : boardQuery.error ? (
              <div className="mt-6">
                <ErrorMessage
                  message="Failed to load the ideas board"
                  errorDetail={getApiErrorMessage(boardQuery.error)}
                  onRetry={() => boardQuery.refetch()}
                />
              </div>
            ) : !boardHasResults ? (
              <div className="mt-6 rounded-2xl border border-dashed border-panel-raised px-4 py-8 text-center text-sm text-slate-500">
                No ideas match that search yet.
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {STATUS_ORDER.map((status) => (
                  <div
                    key={status}
                    className="rounded-[26px] border border-on-panel/10 bg-panel-raised/50 p-4 sm:p-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-xl font-semibold text-on-panel">{status}</h3>
                      <span className="rounded-full bg-panel-raised px-2.5 py-1 text-xs font-semibold text-on-panel-muted">
                        {groupedBoardIdeas[status].length}
                      </span>
                    </div>

                    {groupedBoardIdeas[status].length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-panel-raised px-4 py-4 text-sm text-slate-500">
                        No ideas in this lane yet.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-4">
                        {groupedBoardIdeas[status].map((idea) => (
                          <IdeaCard
                            key={`board:${idea.id}`}
                            idea={idea}
                            expanded={expandedIdeaIds.includes(`board:${idea.id}`)}
                            statusUpdatePending={statusUpdatingIdeaId === idea.id}
                            onToggleExpand={() =>
                              toggleExpandedId(`board:${idea.id}`, setExpandedIdeaIds)
                            }
                            onEdit={() => {
                              setFormError(null);
                              setEditingIdea(idea);
                            }}
                            onDelete={() => {
                              if (window.confirm("Delete this idea?")) {
                                deleteMutation.mutate(idea.id);
                              }
                            }}
                            onStatusChange={(nextStatus) =>
                              statusMutation.mutate({
                                ideaId: idea.id,
                                status: nextStatus,
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <IdeaPager
              page={boardPage}
              pageSize={boardQuery.data?.pageSize ?? 50}
              totalCount={boardQuery.data?.totalCount ?? 0}
              onPageChange={setBoardPage}
              label="Public board pagination"
            />
          </section>
        </div>
      </div>

      <IdeaFormModal
        isOpen={createModalOpen || editingIdea !== null}
        title={editingIdea ? "Edit idea" : "Share an idea"}
        submitLabel={editingIdea ? "Save changes" : "Submit for review"}
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
        isPending={modalPending}
        errorMessage={formError}
        helperText={
          editingIdea
            ? "Editing a published or rejected idea sends it back through review."
            : "New ideas are screened for abuse, then held for moderation before they appear on the public board."
        }
        requireTurnstile={!editingIdea}
        onClose={() => {
          if (modalPending) {
            return;
          }

          setCreateModalOpen(false);
          setEditingIdea(null);
          setFormError(null);
        }}
        onSubmit={(values) => {
          if (editingIdea) {
            updateMutation.mutate(values);
            return;
          }

          createMutation.mutate(values);
        }}
      />
    </>
  );
};

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

export default IdeasPage;
