import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/api/admin';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import LoadingSpinner from '@/components/LoadingSpinner';
import ErrorMessage from '@/components/ErrorMessage';

const DatabaseSizePage = () => {
  const { isAuthenticated, isAdmin } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['databaseSize'],
    queryFn: () => adminApi.getDatabaseSize(),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 5 * 60_000, // Refetch every 5 minutes while the tab is visible
    refetchIntervalInBackground: false,
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load database size" onRetry={() => refetch()} />;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getUsageColor = (percentage: number): string => {
    if (percentage >= 90) return 'text-red-600';
    if (percentage >= 75) return 'text-orange-600';
    return 'text-green-600';
  };

  const getProgressBarColor = (percentage: number): string => {
    if (percentage >= 90) return 'bg-red-600';
    if (percentage >= 75) return 'bg-orange-600';
    return 'bg-green-600';
  };

  if (!data) return null;

  const remainingMegabytes = Math.max(data.freeTierLimitMegabytes - data.sizeMegabytes, 0);

  return (
    <div className="px-4 py-6 sm:px-0">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Database Size</h1>
      <p className="text-gray-600 text-sm mb-6">
        Monitor database size and usage statistics. View total database size, item and keyword totals, and the top 5 largest tables. Data refreshes automatically every minute.
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-6">
        <div className="bg-surface shadow rounded-lg p-5">
          <p className="text-sm font-medium text-gray-500">Database Size</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{formatBytes(data.sizeBytes)}</p>
          <p className="mt-1 text-sm text-gray-500">{data.sizeMegabytes.toFixed(2)} MB total</p>
        </div>
        <div className="bg-surface shadow rounded-lg p-5">
          <p className="text-sm font-medium text-gray-500">Usage</p>
          <p className={`mt-2 text-2xl font-semibold ${getUsageColor(data.usagePercentage)}`}>
            {data.usagePercentage.toFixed(2)}%
          </p>
          <p className="mt-1 text-sm text-gray-500">{remainingMegabytes.toFixed(2)} MB remaining</p>
        </div>
        <div className="bg-surface shadow rounded-lg p-5">
          <p className="text-sm font-medium text-gray-500">Items</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{data.itemCount.toLocaleString()}</p>
          <p className="mt-1 text-sm text-gray-500">Total records in Items</p>
        </div>
        <div className="bg-surface shadow rounded-lg p-5">
          <p className="text-sm font-medium text-gray-500">Keywords</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{data.keywordCount.toLocaleString()}</p>
          <p className="mt-1 text-sm text-gray-500">Total records in Keywords</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="bg-surface shadow rounded-lg p-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-gray-900 mb-4">Current Usage</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Database Size:</span>
                  <span className="font-medium">{formatBytes(data.sizeBytes)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Free Tier Limit:</span>
                  <span className="font-medium">{data.freeTierLimitMegabytes} MB</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Usage:</span>
                  <span className={`font-medium ${getUsageColor(data.usagePercentage)}`}>
                    {data.usagePercentage.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Progress</span>
                <span className={`font-medium ${getUsageColor(data.usagePercentage)}`}>
                  {data.sizeMegabytes.toFixed(2)} MB / {data.freeTierLimitMegabytes} MB
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div
                  className={`h-4 rounded-full ${getProgressBarColor(data.usagePercentage)} transition-all duration-300`}
                  style={{ width: `${Math.min(data.usagePercentage, 100)}%` }}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Details</h3>
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-gray-600">Size in Bytes:</span>
                  <span className="ml-2 font-mono">{data.sizeBytes.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-600">Size in MB:</span>
                  <span className="ml-2 font-mono">{data.sizeMegabytes.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-gray-600">Size in GB:</span>
                  <span className="ml-2 font-mono">{data.sizeGigabytes.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-gray-600">Remaining:</span>
                  <span className={`ml-2 font-mono ${getUsageColor(data.usagePercentage)}`}>
                    {remainingMegabytes.toFixed(2)} MB
                  </span>
                </div>
              </div>
            </div>
          </div>
          {data.usagePercentage >= 90 && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Warning: Database size is approaching the free tier limit
                  </h3>
                  <p className="mt-2 text-sm text-red-700">
                    You are using {data.usagePercentage.toFixed(2)}% of your 500MB free tier limit.
                    Consider cleaning up old data or upgrading your plan.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-surface shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Top 5 Largest Tables</h2>
              <p className="text-sm text-gray-500">Ordered by total PostgreSQL relation size.</p>
            </div>
          </div>

          {data.topTables.length === 0 ? (
            <p className="text-sm text-gray-500">No table size data available.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Table</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Size</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-surface">
                  {data.topTables.map((table) => {
                    const sharePercentage = data.sizeBytes > 0
                      ? (table.sizeBytes / data.sizeBytes) * 100
                      : 0;

                    return (
                      <tr key={table.tableName}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{table.tableName}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatBytes(table.sizeBytes)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{sharePercentage.toFixed(2)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DatabaseSizePage;

