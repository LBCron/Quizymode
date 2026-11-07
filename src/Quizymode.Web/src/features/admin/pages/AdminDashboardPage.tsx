import { useAuth } from '@/contexts/AuthContext';
import { Navigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/api/admin';
import AdminOverviewPanel from '../components/AdminOverviewPanel';

const AdminDashboardPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const feedbackSummary = useQuery({
    queryKey: ['admin', 'feedback-new-count'],
    queryFn: () => adminApi.getAdminFeedback({ page: 1, pageSize: 1, status: 'New' }),
    enabled: isAuthenticated && isAdmin,
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
      <p className="text-gray-600 text-sm mb-6">
        Administrative tools for managing the application. Access review board, database monitoring, and audit logs.
      </p>
      <AdminOverviewPanel />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/admin/review-board"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Review Board</h3>
          <p className="text-sm text-gray-500">Review items pending approval</p>
        </Link>
        <Link
          to="/admin/database-size"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Database Size</h3>
          <p className="text-sm text-gray-500">Monitor database size and usage</p>
        </Link>
        <Link
          to="/admin/audit-logs"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Audit Logs</h3>
          <p className="text-sm text-gray-500">View system audit logs with filters</p>
        </Link>
        <Link
          to="/admin/keywords"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Manage Keywords</h3>
          <p className="text-sm text-gray-500">Assign keywords to parents and set rank</p>
        </Link>
        <Link
          to="/admin/keyword-review"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Review Private Keywords
          </h3>
          <p className="text-sm text-gray-500">
            Approve or reject new private keywords
          </p>
        </Link>
        <Link
          to="/admin/categories"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Manage Categories</h3>
          <p className="text-sm text-gray-500">Rename categories</p>
        </Link>
        <Link
          to="/admin/user-settings"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Users &amp; Activity</h3>
          <p className="text-sm text-gray-500">
            Browse registered users, inspect URL history, and update study guide limits and plans
          </p>
        </Link>
        <Link
          to="/admin/daily-quiz"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Daily Quiz</h3>
          <p className="text-sm text-gray-500">
            Check today's and upcoming daily sets and remove unsuitable questions
          </p>
        </Link>
        <Link
          to="/admin/ai-providers"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">AI Providers</h3>
          <p className="text-sm text-gray-500">
            Models, vendor fallback order, monthly budget, and recent generation attempts
          </p>
        </Link>
        <Link
          to="/admin/import"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Import</h3>
          <p className="text-sm text-gray-500">
            Bulk-import questions from JSON or pasted text into a new collection
          </p>
        </Link>
        <Link
          to="/admin/featured"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Featured</h3>
          <p className="text-sm text-gray-500">Curate featured sets and collections on the public page</p>
        </Link>
        <Link
          to="/admin/seed-sync"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Seed Sync</h3>
          <p className="text-sm text-gray-500">
            Preview and apply repo-managed GitHub syncs
          </p>
        </Link>
        <Link
          to="/admin/page-views"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Usage Analytics</h3>
          <p className="text-sm text-gray-500">
            See top pages, visitor mix, sessions, and recent URL hits
          </p>
        </Link>
        <Link
          to="/admin/client-errors"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Client Errors</h3>
          <p className="text-sm text-gray-500">
            Front-end crashes grouped by fingerprint, page, browser, and release
          </p>
        </Link>
        <Link
          to="/admin/feedback"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Feedback
            {feedbackSummary.data && (
              <span
                className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                aria-label={`${feedbackSummary.data.newCount} new feedback submissions`}
              >
                {feedbackSummary.data.newCount} new
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-500">Read and triage bug reports and requests</p>
        </Link>
        <Link
          to="/admin/ideas"
          className="bg-surface shadow rounded-lg p-6 hover:shadow-lg transition-shadow cursor-pointer"
        >
          <h3 className="text-lg font-medium text-gray-900 mb-2">Ideas Moderation</h3>
          <p className="text-sm text-gray-500">
            Review submissions, publish strong ideas, and manage roadmap status
          </p>
        </Link>
      </div>
    </div>
  );
};

export default AdminDashboardPage;

