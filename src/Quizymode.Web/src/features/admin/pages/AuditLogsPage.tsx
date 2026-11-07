import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/api/admin';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import LoadingSpinner from '@/components/LoadingSpinner';
import ErrorMessage from '@/components/ErrorMessage';

// Audit action types matching the backend enum
const AUDIT_ACTIONS = [
  'UserCreated',
  'LoginSuccess',
  'LoginFailed',
  'Logout',
  'CommentCreated',
  'CommentDeleted',
  'ItemCreated',
  'ItemUpdated',
  'ItemDeleted',
  'IdeaCreated',
  'IdeaUpdated',
  'IdeaDeleted',
  'IdeaApproved',
  'IdeaRejected',
  'IdeaStatusChanged',
  'IdeaProfanityRejected',
  'IdeaCommentCreated',
  'IdeaCommentUpdated',
  'IdeaCommentDeleted',
  'UserInternalFlagChanged',
] as const;

type AuditAction = typeof AUDIT_ACTIONS[number];

const AuditLogsPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  // By default, all event types are selected
  const [selectedActions, setSelectedActions] = useState<AuditAction[]>([...AUDIT_ACTIONS]);
  const [filterMode, setFilterMode] = useState<"all" | "none" | "specific">("all");
  const [userEmailInput, setUserEmailInput] = useState('');
  const [userEmailFilter, setUserEmailFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Helper function to convert action value (number or string) to readable text
  const getActionText = (action: string | number): string => {
    // If it's already a string, return it
    if (typeof action === 'string') {
      return action;
    }
    
    // If it's a number, map it to the action name
    const actionMap: Record<number, string> = {
      0: 'UserCreated',
      1: 'LoginSuccess',
      2: 'LoginFailed',
      3: 'Logout',
      4: 'CommentCreated',
      5: 'CommentDeleted',
      6: 'ItemCreated',
      7: 'ItemUpdated',
      8: 'ItemDeleted',
      9: 'IdeaCreated',
      10: 'IdeaUpdated',
      11: 'IdeaDeleted',
      12: 'IdeaApproved',
      13: 'IdeaRejected',
      14: 'IdeaStatusChanged',
      15: 'IdeaProfanityRejected',
      16: 'IdeaCommentCreated',
      17: 'IdeaCommentUpdated',
      18: 'IdeaCommentDeleted',
      19: 'UserInternalFlagChanged',
    };
    
    return actionMap[action] || `Unknown (${action})`;
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['auditLogs', filterMode, selectedActions, userEmailFilter, page],
    queryFn: () => adminApi.getAuditLogs(
      filterMode === "none" ? [] : (filterMode === "all" ? undefined : (selectedActions.length > 0 ? selectedActions : undefined)),
      userEmailFilter || undefined,
      page,
      pageSize
    ),
    enabled: isAuthenticated && isAdmin,
  });

  const handleFilterModeChange = (mode: "all" | "none" | "specific") => {
    if (mode === "all") {
      // Select all event types when "All" is chosen
      setSelectedActions([...AUDIT_ACTIONS]);
      setFilterMode("specific"); // Switch to specific mode so checkboxes are visible
    } else if (mode === "none") {
      // Deselect all when "None" is chosen
      setSelectedActions([]);
      setFilterMode("none");
    } else {
      // "specific" mode - keep current selection
      setFilterMode("specific");
    }
    setPage(1);
  };

  const handleActionToggle = (action: AuditAction) => {
    setSelectedActions(prev => {
      const newSelection = prev.includes(action)
        ? prev.filter(a => a !== action)
        : [...prev, action];
      // Update filter mode based on selection
      if (newSelection.length === 0) {
        setFilterMode("none");
      } else {
        setFilterMode("specific");
      }
      return newSelection;
    });
    setPage(1); // Reset to first page when filter changes
  };

  const applyUserEmailFilter = () => {
    setUserEmailFilter(userEmailInput.trim());
    setPage(1);
  };

  const clearUserEmailFilter = () => {
    setUserEmailInput('');
    setUserEmailFilter('');
    setPage(1);
  };

  const clearFilters = () => {
    setSelectedActions([...AUDIT_ACTIONS]); // Reset to all selected
    setFilterMode("specific"); // Keep in specific mode so checkboxes remain visible
    setPage(1);
  };

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load audit logs" onRetry={() => refetch()} />;

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="px-4 py-6 sm:px-0">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Audit Logs</h1>
      <p className="text-gray-600 text-sm mb-6">
        View system audit logs with detailed information about user actions, item operations, idea moderation, and system events. Filter by event type and browse paginated results.
      </p>

      {/* Filters */}
      <div className="bg-surface shadow rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Filters</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              User Email
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="email"
                value={userEmailInput}
                onChange={(e) => setUserEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyUserEmailFilter()}
                placeholder="Filter by user email..."
                className="w-full sm:w-80 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <button
                onClick={applyUserEmailFilter}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Apply
              </button>
              {userEmailFilter && (
                <button
                  onClick={clearUserEmailFilter}
                  className="text-sm text-indigo-ink hover:text-indigo-ink underline"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Excluded by default: test-user@quizymode.com, janskymail@gmail.com
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Event Types
            </label>
            <select
              value={
                selectedActions.length === AUDIT_ACTIONS.length ? "all" :
                selectedActions.length === 0 ? "none" :
                "specific"
              }
              onChange={(e) => handleFilterModeChange(e.target.value as "all" | "none" | "specific")}
              className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="all">All Event Types</option>
              <option value="none">None</option>
              <option value="specific">Specific Types...</option>
            </select>
          </div>
          <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Event Types (Select multiple)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {AUDIT_ACTIONS.map((action) => (
                  <label
                    key={action}
                    className="flex items-center space-x-2 cursor-pointer p-2 rounded hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedActions.includes(action)}
                      onChange={() => handleActionToggle(action)}
                      className="rounded border-gray-300 text-indigo-ink focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">{action}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex items-center space-x-2">
                <span className="text-sm text-gray-600">
                  {selectedActions.length} of {AUDIT_ACTIONS.length} type{selectedActions.length !== 1 ? 's' : ''} selected
                </span>
              </div>
            </div>
          {selectedActions.length !== AUDIT_ACTIONS.length && (
            <div className="flex items-center space-x-2">
              <button
                onClick={clearFilters}
                className="text-sm text-indigo-ink hover:text-indigo-ink underline"
              >
                Reset to all filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="bg-surface shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">
              Audit Logs
              {data && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({data.totalCount} total)
                </span>
              )}
            </h2>
          </div>
        </div>

        {data && data.logs.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date/Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      IP / Country
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Entity ID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-gray-200">
                  {data.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(log.createdUtc)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {log.userEmail || <span className="text-gray-400">N/A</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-indigo-100 text-indigo-ink">
                          {getActionText(log.action)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>{log.ipAddress}</div>
                        {log.country && (
                          <div className="text-xs font-medium text-indigo-ink">{log.country}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                        {log.entityId || <span className="text-gray-400">N/A</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-sm text-gray-700">
                  Showing page {data.page} of {data.totalPages} ({data.totalCount} total entries)
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={data.page <= 1}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                    disabled={data.page >= data.totalPages}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500">No audit logs found.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogsPage;

