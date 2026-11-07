import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminFeedbackItem, type FeedbackStatus } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<string, string> = {
  reportIssue: "Report an issue",
  requestItems: "Request items",
  generalFeedback: "General feedback",
};

const STATUSES: FeedbackStatus[] = ["New", "Reviewed", "Archived"];

const STATUS_CLASSES: Record<FeedbackStatus, string> = {
  New: "bg-amber-100 text-amber-800",
  Reviewed: "bg-emerald-100 text-emerald-800",
  Archived: "bg-slate-200 text-slate-700",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

const AdminFeedbackPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("New");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["admin", "feedback", { type, status, from, to, search, page }],
    queryFn: () =>
      adminApi.getAdminFeedback({ page, pageSize: PAGE_SIZE, type, status, from, to, search }),
    enabled: isAuthenticated && isAdmin,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: FeedbackStatus }) =>
      adminApi.updateFeedbackStatus(id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "feedback"] }),
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / data.pageSize)) : 1;

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold text-gray-900">Feedback</h1>
        <Link to="/admin" className="text-sm font-medium text-indigo-ink hover:text-indigo-ink">
          Back to dashboard
        </Link>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Reports and requests from the feedback form, newest first.
        {data ? ` ${data.newCount} new.` : ""}
      </p>

      <form
        onSubmit={onSearch}
        className="mb-6 grid grid-cols-1 gap-3 rounded-lg bg-surface p-4 shadow sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="text-sm text-gray-700">
          Type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5"
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-700">
          From
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm text-gray-700">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5"
          />
        </label>
        <label className="text-sm text-gray-700">
          Search
          <div className="mt-1 flex gap-2">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Details, URL, email"
              className="block w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Search
            </button>
          </div>
        </label>
      </form>

      {query.isLoading && <LoadingSpinner />}
      {query.error && (
        <ErrorMessage message="Failed to load feedback." onRetry={() => void query.refetch()} />
      )}
      {statusMutation.error && <ErrorMessage message="Failed to update the status." />}

      {data && data.items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No feedback matches these filters.
        </div>
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="space-y-4">
            {data.items.map((item) => (
              <FeedbackCard
                key={item.id}
                item={item}
                busy={statusMutation.isPending && statusMutation.variables?.id === item.id}
                onStatus={(next) => statusMutation.mutate({ id: item.id, next })}
              />
            ))}
          </ul>
          <div className="mt-6 flex items-center justify-between text-sm text-gray-700">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages} ({data.totalCount} total)
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
};

interface FeedbackCardProps {
  item: AdminFeedbackItem;
  busy: boolean;
  onStatus: (status: FeedbackStatus) => void;
}

const FeedbackCard = ({ item, busy, onStatus }: FeedbackCardProps) => {
  const [showJourney, setShowJourney] = useState(false);
  const journey = useQuery({
    queryKey: ["admin", "feedback-journey", item.sessionId],
    // Internal sessions are hidden unless requested; an admin reading a report may be the reporter.
    queryFn: () => adminApi.getPageViewSessionDetail(item.sessionId as string, true),
    enabled: showJourney && !!item.sessionId,
  });

  const contact = [item.userEmail, item.contactEmail]
    .filter((value, index, all): value is string => !!value && all.indexOf(value) === index)
    .join(" / ");

  return (
    <li className="rounded-lg bg-surface p-4 shadow" data-testid="feedback-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-ink">
          {TYPE_LABELS[item.type] ?? item.type}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[item.status]}`}
        >
          {item.status}
        </span>
        <span className="text-xs text-gray-500">{formatDateTime(item.createdAt)}</span>
      </div>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-900">{item.details}</p>
      {item.additionalKeywords && (
        <p className="mt-1 text-xs text-gray-600">Keywords: {item.additionalKeywords}</p>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="inline font-medium">Page: </dt>
          <dd className="inline break-all">{item.pageUrl}</dd>
        </div>
        <div className="min-w-0">
          <dt className="inline font-medium">Contact: </dt>
          <dd className="inline break-all">{contact || "anonymous"}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="inline font-medium">User agent: </dt>
          <dd className="inline break-all">{item.userAgent ?? "unknown"}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUSES.filter((status) => status !== item.status).map((status) => (
          <button
            key={status}
            type="button"
            disabled={busy}
            onClick={() => onStatus(status)}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Mark {status.toLowerCase()}
          </button>
        ))}
        {item.sessionId && (
          <button
            type="button"
            aria-expanded={showJourney}
            onClick={() => setShowJourney((current) => !current)}
            className="text-xs font-medium text-indigo-ink hover:text-indigo-ink"
          >
            {showJourney ? "Hide" : "Show"} session journey
          </button>
        )}
      </div>

      {showJourney && item.sessionId && (
        <div className="mt-2">
          {journey.isLoading && <p className="text-xs text-gray-500">Loading journey…</p>}
          {journey.error && (
            <p className="text-xs text-gray-500">No page hits were recorded for this session.</p>
          )}
          {journey.data && (
            <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-700">
              {journey.data.steps.map((step) => (
                <li key={step.stepNumber}>
                  <span className="break-all">{step.path}</span>{" "}
                  <span className="text-gray-500">{formatDateTime(step.createdUtc)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
};

export default AdminFeedbackPage;
