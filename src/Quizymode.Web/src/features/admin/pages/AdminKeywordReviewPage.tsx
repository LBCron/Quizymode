import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { adminApi, type PendingKeywordResponse } from "@/api/admin";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { getApiErrorMessage } from "@/utils/apiError";

const AdminKeywordReviewPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [mutationError, setMutationError] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "pending-keywords"],
    queryFn: () => adminApi.getPendingKeywords(),
    enabled: !!isAuthenticated && !!isAdmin,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminApi.approveKeyword(id),
    onSuccess: (_response, id) => {
      setMutationError(null);
      queryClient.setQueryData(
        ["admin", "pending-keywords"],
        (current: { keywords?: PendingKeywordResponse[] } | undefined) =>
          current
            ? {
                ...current,
                keywords: (current.keywords ?? []).filter((keyword) => keyword.id !== id),
              }
            : current
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "pending-keywords"] });
    },
    onError: (error) => {
      setMutationError(getApiErrorMessage(error));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => adminApi.rejectKeyword(id),
    onSuccess: (_response, id) => {
      setMutationError(null);
      queryClient.setQueryData(
        ["admin", "pending-keywords"],
        (current: { keywords?: PendingKeywordResponse[] } | undefined) =>
          current
            ? {
                ...current,
                keywords: (current.keywords ?? []).filter((keyword) => keyword.id !== id),
              }
            : current
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "pending-keywords"] });
    },
    onError: (error) => {
      setMutationError(getApiErrorMessage(error));
    },
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isLoading) return <LoadingSpinner />;
  if (error)
    return (
      <ErrorMessage
        message="Failed to load pending keywords"
        onRetry={() => refetch()}
      />
    );

  const keywords: PendingKeywordResponse[] = data?.keywords ?? [];

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
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Review Private Keywords
      </h1>
      <p className="text-gray-600 text-sm mb-6">
        Approve to make a keyword public. Reject to keep it private and remove it
        from this review list.
      </p>
      {mutationError && (
        <div className="mb-6">
          <ErrorMessage
            message="Failed to update keyword review status"
            errorDetail={mutationError}
            onRetry={() => {
              setMutationError(null);
              refetch();
            }}
          />
        </div>
      )}

      {keywords.length === 0 ? (
        <p className="text-gray-500 text-sm">No keywords are pending review.</p>
      ) : (
        <div className="bg-surface shadow rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Name
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Slug
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Created By
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Created At
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Usage
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-gray-200">
                {keywords.map((kw) => (
                  <tr key={kw.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm font-medium text-gray-900">
                      {kw.name}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {kw.slug ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {kw.createdBy}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {new Date(kw.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-700 text-right">
                      {kw.usageCount}
                    </td>
                    <td className="px-4 py-2 text-sm text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => approveMutation.mutate(kw.id)}
                        disabled={
                          approveMutation.isPending || rejectMutation.isPending
                        }
                        className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {approveMutation.isPending ? "Approving…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectMutation.mutate(kw.id)}
                        disabled={
                          approveMutation.isPending || rejectMutation.isPending
                        }
                        className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                      >
                        {rejectMutation.isPending ? "Rejecting…" : "Reject"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminKeywordReviewPage;

