import { useState, useRef } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  adminApi,
  type LocalSeedSyncRequest,
  type SeedSyncApplyResponse,
  type SeedSyncHistoryResponse,
  type SeedSyncPreviewResponse,
  type SeedSyncRequest,
} from "@/api/admin";

type SyncSource = "github" | "local";

interface SyncMeta {
  wallMs: number;
  isIncremental: boolean;
  sinceCommitSha?: string | null;
  totalBatches: number;
}

function extractErrorMessage(error: unknown): string {
  const fallback = "The request failed. Check the repository settings and try again.";

  if (!error || typeof error !== "object") {
    return fallback;
  }

  const candidate = error as {
    response?: { data?: unknown };
    message?: string;
  };

  const data = candidate.response?.data;
  if (Array.isArray(data) && data.length > 0) {
    const messages = data
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const item = entry as { errorMessage?: string };
        return item.errorMessage ?? null;
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  return (
    (typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    ("detail" in data || "description" in data || "title" in data)
      ? (((data as { detail?: string }).detail ||
          (data as { description?: string }).description ||
          (data as { title?: string }).title) ??
        null)
      : null) ||
    candidate.message ||
    fallback
  );
}

function formatUtcDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-green-200 bg-green-50 text-green-900"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-gray-200 bg-surface text-gray-900";

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function ChangeTable({
  changes,
  emptyMessage,
}: {
  changes: {
    itemId: string;
    action: string;
    category: string;
    navigationKeyword1: string;
    navigationKeyword2: string;
    question: string;
    changedFields: string[];
  }[];
  emptyMessage: string;
}) {
  if (changes.length === 0) {
    return <p className="mt-3 text-sm text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
              Action
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
              Scope
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
              Question
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
              Changed fields
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-surface">
          {changes.map((change) => (
            <tr key={change.itemId}>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                {change.action}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                <div>{change.category}</div>
                <div className="text-xs text-gray-500">
                  {change.navigationKeyword1} / {change.navigationKeyword2}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-700">
                <div className="max-w-xl">{change.question}</div>
                <div className="mt-1 font-mono text-xs text-gray-400">
                  {change.itemId}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {change.changedFields.length > 0
                  ? change.changedFields.join(", ")
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildSyncProse(
  response: SeedSyncPreviewResponse | SeedSyncApplyResponse,
  meta: SyncMeta,
): string {
  const facts: string[] = [];

  if (meta.isIncremental && meta.sinceCommitSha) {
    facts.push(`incremental from commit ${meta.sinceCommitSha.slice(0, 12)}`);
  } else if (!meta.isIncremental && meta.totalBatches > 1) {
    facts.push(`full sync · ${meta.totalBatches} batches of ${FILE_BATCH_SIZE} sequential`);
  } else {
    facts.push("full sync");
  }

  const filesPart = response.totalFiles > 0
    ? `${response.processedFiles.toLocaleString()} source ${response.processedFiles === 1 ? "file" : "files"} of ${response.totalFiles.toLocaleString()} in index`
    : `${response.processedFiles.toLocaleString()} source ${response.processedFiles === 1 ? "file" : "files"}`;
  facts.push(filesPart);

  if (response.totalItemsInPayload > 0) {
    facts.push(`${response.totalItemsInPayload.toLocaleString()} items in scope`);
  }

  const changes: string[] = [];
  if (response.createdCount > 0) changes.push(`${response.createdCount.toLocaleString()} created`);
  if (response.updatedCount > 0) changes.push(`${response.updatedCount.toLocaleString()} updated`);
  if (response.unchangedCount > 0) changes.push(`${response.unchangedCount.toLocaleString()} unchanged`);
  if (changes.length > 0) facts.push(changes.join(" · "));

  if (response.durationMs > 0) {
    facts.push(`backend ${(response.durationMs / 1000).toFixed(1)} s`);
  }
  facts.push(`total ${(meta.wallMs / 1000).toFixed(1)} s`);

  return facts.join("; ");
}

function ResultsPanel({
  title,
  response,
  meta,
}: {
  title: string;
  response: SeedSyncPreviewResponse | SeedSyncApplyResponse;
  meta: SyncMeta;
}) {
  const hasRecordedHistory =
    "historyRunId" in response &&
    Boolean(response.historyRunId) &&
    Boolean(response.historyRecordedUtc);

  return (
    <div className="bg-surface shadow rounded-lg p-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900">{title}</h2>
          <p className="text-sm text-gray-600">
            {response.repositoryOwner}/{response.repositoryName}
            {" · "}
            Ref <span className="font-mono">{response.gitRef}</span>
            {" · "}
            Commit <span className="font-mono">{response.resolvedCommitSha.slice(0, 12)}</span>
          </p>
          <p className="text-sm text-gray-400">{buildSyncProse(response, meta)}</p>
          {hasRecordedHistory && (
            <p className="text-sm text-emerald-700">
              History recorded{" "}
              <span className="font-mono">
                {("historyRunId" in response && response.historyRunId) || ""}
              </span>
              {" | "}
              {formatUtcDateTime(
                ("historyRecordedUtc" in response && response.historyRecordedUtc) || ""
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryCard
          label="Affected"
          value={response.affectedItemCount}
          tone="warning"
        />
        <SummaryCard label="Created" value={response.createdCount} tone="success" />
        <SummaryCard label="Updated" value={response.updatedCount} tone="success" />
        <SummaryCard label="Deleted" value={response.deletedCount} tone="warning" />
        <SummaryCard label="Unchanged" value={response.unchangedCount} />
        <SummaryCard label="Existing" value={response.existingItemCount} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryCard
          label="Collections affected"
          value={response.affectedCollectionCount}
          tone="warning"
        />
        <SummaryCard
          label="Collections created"
          value={response.collectionCreatedCount}
          tone="success"
        />
        <SummaryCard
          label="Collections updated"
          value={response.collectionUpdatedCount}
          tone="success"
        />
        <SummaryCard
          label="Collections deleted"
          value={response.collectionDeletedCount}
          tone="warning"
        />
        <SummaryCard
          label="Collections unchanged"
          value={response.collectionUnchangedCount}
        />
        <SummaryCard
          label="Collections existing"
          value={response.existingCollectionCount}
        />
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-medium text-gray-900">Delta</h3>
          {response.hasMoreChanges && (
            <span className="text-xs text-gray-500">
              Only the first returned changes are shown.
            </span>
          )}
        </div>

        <ChangeTable
          changes={response.changes}
          emptyMessage="No delta rows were returned for this response."
        />
      </div>
    </div>
  );
}

function HistoryPanel({ history }: { history: SeedSyncHistoryResponse }) {
  return (
    <div className="bg-surface shadow rounded-lg p-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900">Recent sync history</h2>
        <p className="text-sm text-gray-500">
          Each apply run stores one sync record plus one per-item history row for
          affected items.
        </p>
      </div>

      {history.runs.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          No seed sync history has been recorded yet.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {history.runs.map((run) => (
            <div key={run.runId} className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {run.repositoryOwner}/{run.repositoryName}
                  </div>
                  <div className="text-sm text-gray-500">
                    {formatUtcDateTime(run.createdUtc)}
                    {" | "}
                    Triggered by {run.triggeredByUserId ?? "system"}
                  </div>
                  <div className="text-xs text-gray-500">
                    Ref <span className="font-mono">{run.gitRef}</span>
                    {" | "}
                    Commit{" "}
                    <span className="font-mono">
                      {run.resolvedCommitSha.slice(0, 12)}
                    </span>
                  </div>
                </div>
                <div className="text-xs font-mono text-gray-400">{run.runId}</div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
                <SummaryCard
                  label="Affected"
                  value={run.affectedItemCount}
                  tone="warning"
                />
                <SummaryCard label="Created" value={run.createdCount} tone="success" />
                <SummaryCard label="Updated" value={run.updatedCount} tone="success" />
                <SummaryCard label="Deleted" value={run.deletedCount} tone="warning" />
                <SummaryCard label="Unchanged" value={run.unchangedCount} />
                <SummaryCard label="Existing" value={run.existingItemCount} />
              </div>

              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-md font-medium text-gray-900">
                    Recorded item changes
                  </h3>
                  {run.hasMoreChanges && (
                    <span className="text-xs text-gray-500">
                      Only the first recorded changes are shown.
                    </span>
                  )}
                </div>

                <ChangeTable
                  changes={run.changes}
                  emptyMessage="No affected item rows were recorded for this run."
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FullSyncProgress {
  processedFiles: number;
  totalFiles: number;
  createdCount: number;
  updatedCount: number;
}

const FILE_BATCH_SIZE = 50;

const AdminSeedSyncPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [syncSource, setSyncSource] = useState<SyncSource>("github");
  const [repositoryOwner, setRepositoryOwner] = useState("yanis-kr");
  const [repositoryName, setRepositoryName] = useState("Quizymode");
  const [gitRef, setGitRef] = useState("main");
  const [deltaPreviewLimit, setDeltaPreviewLimit] = useState("200");
  const [useIncrementalSync, setUseIncrementalSync] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewResponse, setPreviewResponse] =
    useState<SeedSyncPreviewResponse | null>(null);
  const [applyResponse, setApplyResponse] =
    useState<SeedSyncApplyResponse | null>(null);
  const [previewMeta, setPreviewMeta] = useState<SyncMeta | null>(null);
  const [applyMeta, setApplyMeta] = useState<SyncMeta | null>(null);
  const [fullSyncProgress, setFullSyncProgress] =
    useState<FullSyncProgress | null>(null);
  const callStartRef = useRef<number>(0);

  const resetResults = () => {
    setLocalError(null);
    setPreviewResponse(null);
    setApplyResponse(null);
    setPreviewMeta(null);
    setApplyMeta(null);
    setFullSyncProgress(null);
  };

  const previewMutation = useMutation({
    mutationFn: (request: SeedSyncRequest) => {
      callStartRef.current = Date.now();
      return adminApi.previewSeedSync(request);
    },
    onSuccess: (response, variables) => {
      setLocalError(null);
      setApplyResponse(null);
      setApplyMeta(null);
      setPreviewResponse(response);
      setPreviewMeta({ wallMs: Date.now() - callStartRef.current, isIncremental: !!variables.sinceCommitSha, sinceCommitSha: variables.sinceCommitSha, totalBatches: 1 });
    },
    onError: (error) => {
      setPreviewResponse(null);
      setPreviewMeta(null);
      setApplyResponse(null);
      setLocalError(extractErrorMessage(error));
    },
  });

  const applyMutation = useMutation({
    mutationFn: (request: SeedSyncRequest) => {
      callStartRef.current = Date.now();
      return adminApi.applySeedSync(request);
    },
    onSuccess: (response, variables) => {
      setLocalError(null);
      setPreviewResponse(null);
      setPreviewMeta(null);
      setApplyResponse(response);
      setApplyMeta({ wallMs: Date.now() - callStartRef.current, isIncremental: !!variables.sinceCommitSha, sinceCommitSha: variables.sinceCommitSha, totalBatches: 1 });
      queryClient.invalidateQueries({ queryKey: ["admin", "seed-sync-history"] });
    },
    onError: (error) => {
      setApplyResponse(null);
      setApplyMeta(null);
      setLocalError(extractErrorMessage(error));
    },
  });

  const localPreviewMutation = useMutation({
    mutationFn: (request: LocalSeedSyncRequest) => {
      callStartRef.current = Date.now();
      return adminApi.previewLocalSeedSync(request);
    },
    onSuccess: (response) => {
      setLocalError(null);
      setApplyResponse(null);
      setApplyMeta(null);
      setPreviewResponse(response);
      setPreviewMeta({ wallMs: Date.now() - callStartRef.current, isIncremental: false, totalBatches: 1 });
    },
    onError: (error) => {
      setPreviewResponse(null);
      setPreviewMeta(null);
      setApplyResponse(null);
      setLocalError(extractErrorMessage(error));
    },
  });

  const localApplyMutation = useMutation({
    mutationFn: (request: LocalSeedSyncRequest) => {
      callStartRef.current = Date.now();
      return adminApi.applyLocalSeedSync(request);
    },
    onSuccess: (response) => {
      setLocalError(null);
      setPreviewResponse(null);
      setPreviewMeta(null);
      setApplyResponse(response);
      setApplyMeta({ wallMs: Date.now() - callStartRef.current, isIncremental: false, totalBatches: 1 });
      queryClient.invalidateQueries({ queryKey: ["admin", "seed-sync-history"] });
    },
    onError: (error) => {
      setApplyResponse(null);
      setApplyMeta(null);
      setLocalError(extractErrorMessage(error));
    },
  });

  const historyQuery = useQuery({
    queryKey: ["admin", "seed-sync-history"],
    queryFn: () => adminApi.getSeedSyncHistory(),
    enabled: isAuthenticated && isAdmin,
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const lastSyncCommitSha = historyQuery.data?.runs[0]?.resolvedCommitSha ?? null;
  const sinceCommitSha =
    syncSource === "github" && useIncrementalSync ? lastSyncCommitSha : null;

  const buildGitHubRequest = (overrides?: { fileOffset?: number }): SeedSyncRequest => {
    const owner = repositoryOwner.trim();
    const repo = repositoryName.trim();
    const ref = gitRef.trim();
    const limit = Number(deltaPreviewLimit.trim());

    if (!owner || !repo || !ref) {
      throw new Error("Repository owner, repository name, and git ref are required.");
    }

    if (!Number.isInteger(limit) || limit < 0 || limit > 500) {
      throw new Error("Delta preview limit must be an integer between 0 and 500.");
    }

    return {
      schemaVersion: 2,
      repositoryOwner: owner,
      repositoryName: repo,
      gitRef: ref,
      deltaPreviewLimit: limit,
      sinceCommitSha: sinceCommitSha,
      fileOffset: overrides?.fileOffset ?? 0,
      fileBatchSize: sinceCommitSha ? undefined : FILE_BATCH_SIZE,
    };
  };

  const buildLocalRequest = (): LocalSeedSyncRequest => {
    resetResults();

    const limit = Number(deltaPreviewLimit.trim());
    if (!Number.isInteger(limit) || limit < 0 || limit > 500) {
      throw new Error("Delta preview limit must be an integer between 0 and 500.");
    }

    return { deltaPreviewLimit: limit };
  };

  const runFullSync = async () => {
    resetResults();
    const wallStart = Date.now();
    let offset = 0;
    let isComplete = false;
    let totalFiles = 0;
    let totalItems = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let batchCount = 0;
    let lastResponse: SeedSyncApplyResponse | null = null;

    try {
      while (!isComplete) {
        const request = buildGitHubRequest({ fileOffset: offset });
        const response = await adminApi.applySeedSync(request);
        totalFiles = response.totalFiles;
        isComplete = response.isComplete;
        offset = response.isComplete ? response.totalFiles : response.nextFileOffset;
        totalItems += response.totalItemsInPayload;
        createdCount += response.createdCount;
        updatedCount += response.updatedCount;
        batchCount++;
        lastResponse = response;
        setFullSyncProgress({ processedFiles: offset, totalFiles, createdCount, updatedCount });
      }

      if (lastResponse) {
        setApplyResponse({ ...lastResponse, createdCount, updatedCount, totalItemsInPayload: totalItems });
        setApplyMeta({ wallMs: Date.now() - wallStart, isIncremental: false, totalBatches: batchCount });
      }
      queryClient.invalidateQueries({ queryKey: ["admin", "seed-sync-history"] });
    } catch (error) {
      setLocalError(extractErrorMessage(error));
    } finally {
      setFullSyncProgress(null);
    }
  };

  const handlePreview = () => {
    resetResults();
    try {
      if (syncSource === "local") {
        localPreviewMutation.mutate(buildLocalRequest());
      } else {
        previewMutation.mutate(buildGitHubRequest());
      }
    } catch (error) {
      setLocalError(extractErrorMessage(error));
    }
  };

  const handleApply = () => {
    resetResults();
    try {
      if (syncSource === "local") {
        localApplyMutation.mutate(buildLocalRequest());
      } else if (sinceCommitSha) {
        applyMutation.mutate(buildGitHubRequest());
      } else {
        void runFullSync();
      }
    } catch (error) {
      setLocalError(extractErrorMessage(error));
    }
  };

  const isWorking =
    previewMutation.isPending ||
    applyMutation.isPending ||
    localPreviewMutation.isPending ||
    localApplyMutation.isPending ||
    fullSyncProgress !== null;

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-6 flex items-center gap-4">
        <Link
          to="/admin"
          className="text-indigo-ink hover:text-indigo-ink text-sm font-medium"
        >
          {"<-"} Admin Dashboard
        </Link>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">Seed Sync</h1>
      <p className="text-gray-600 text-sm mb-6">
        Preview or apply repo-managed items directly from GitHub or from the
        server's local source registry. The API never infers deletes from missing
        rows.
      </p>

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => { setSyncSource("github"); resetResults(); }}
          className={`rounded-md px-4 py-2 text-sm font-medium border ${
            syncSource === "github"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-surface text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          GitHub
        </button>
        <button
          type="button"
          onClick={() => { setSyncSource("local"); resetResults(); }}
          className={`rounded-md px-4 py-2 text-sm font-medium border ${
            syncSource === "local"
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-surface text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Local filesystem
        </button>
      </div>

      {syncSource === "github" && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Use an immutable commit SHA for production whenever possible. Branch refs
          are convenient for testing, but commit-based syncs are easier to audit and
          roll back.
        </div>
      )}

      {syncSource === "github" && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-surface px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={useIncrementalSync}
              onChange={(e) => { setUseIncrementalSync(e.target.checked); resetResults(); }}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-ink"
            />
            <span className="text-sm">
              <span className="font-medium text-gray-900">Incremental sync</span>
              {" — "}
              {lastSyncCommitSha ? (
                <span className="text-gray-600">
                  sync only source files changed since commit{" "}
                  <span className="font-mono">{lastSyncCommitSha.slice(0, 12)}</span>
                </span>
              ) : (
                <span className="text-gray-400">no previous sync found — will run as full sync</span>
              )}
            </span>
          </label>
          {!useIncrementalSync && (
            <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 border border-amber-200">
              Full sync processes all source files in batches of {FILE_BATCH_SIZE}. Use only for initial setup or recovery.
            </p>
          )}
        </div>
      )}

      {syncSource === "local" && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Reads all items from the server's local{" "}
          <span className="font-mono">data/seed-source/items/</span> directory —
          the full source registry, no filtering. Useful for validating new seed
          files before pushing to GitHub. Only available in dev environments with
          the repository checked out.
        </div>
      )}

      <div className="bg-surface shadow rounded-lg p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {syncSource === "github" && (
              <>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    Repository owner
                  </span>
                  <input
                    value={repositoryOwner}
                    onChange={(event) => {
                      setRepositoryOwner(event.target.value);
                      resetResults();
                    }}
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Quizymode"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    Repository name
                  </span>
                  <input
                    value={repositoryName}
                    onChange={(event) => {
                      setRepositoryName(event.target.value);
                      resetResults();
                    }}
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="Quizymode"
                  />
                </label>

                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-gray-700">Git ref</span>
                  <input
                    value={gitRef}
                    onChange={(event) => {
                      setGitRef(event.target.value);
                      resetResults();
                    }}
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                    placeholder="main or a commit SHA"
                  />
                </label>
              </>
            )}

            {syncSource === "local" && (
              <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                Source:{" "}
                <span className="font-mono">data/seed-source/items/</span> —
                full local registry, all files loaded, no filtering.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 p-4">
              <label className="block text-sm font-medium text-gray-700">
                Delta preview limit
              </label>
              <input
                type="number"
                min={0}
                max={500}
                value={deltaPreviewLimit}
                onChange={(event) => {
                  setDeltaPreviewLimit(event.target.value);
                  resetResults();
                }}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-2 text-xs text-gray-500">
                Server-enforced range is 0 to 500.
              </p>
            </div>

            <button
              type="button"
              onClick={handlePreview}
              disabled={isWorking}
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {(previewMutation.isPending || localPreviewMutation.isPending) ? "Previewing..." : "Preview sync"}
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={isWorking}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {applyMutation.isPending || localApplyMutation.isPending || fullSyncProgress !== null
                ? "Applying..."
                : "Apply sync"}
            </button>
          </div>
        </div>

        {fullSyncProgress && (
          <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-indigo-ink">
                Full sync in progress — batch {Math.ceil(fullSyncProgress.processedFiles / FILE_BATCH_SIZE)} of {Math.ceil(fullSyncProgress.totalFiles / FILE_BATCH_SIZE)}
              </span>
              <span className="text-indigo-ink">
                {fullSyncProgress.processedFiles.toLocaleString()} / {fullSyncProgress.totalFiles.toLocaleString()} files
                {" · "}
                {(fullSyncProgress.createdCount + fullSyncProgress.updatedCount).toLocaleString()} items synced
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                style={{
                  width: fullSyncProgress.totalFiles > 0
                    ? `${Math.round((fullSyncProgress.processedFiles / fullSyncProgress.totalFiles) * 100)}%`
                    : "0%"
                }}
              />
            </div>
          </div>
        )}

        {localError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {localError}
          </div>
        )}
      </div>

      <div className="mt-6 space-y-6">
        {historyQuery.data && <HistoryPanel history={historyQuery.data} />}
        {historyQuery.isError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Recent sync history could not be loaded right now.
          </div>
        )}
        {previewResponse && previewMeta && (
          <ResultsPanel title="Preview results" response={previewResponse} meta={previewMeta} />
        )}
        {applyResponse && applyMeta && (
          <ResultsPanel title="Apply results" response={applyResponse} meta={applyMeta} />
        )}
      </div>
    </div>
  );
};

export default AdminSeedSyncPage;
