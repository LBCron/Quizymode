import { topicLabel } from "@/features/interests/topicPaths";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { usersApi } from "@/api/users";
import { studySessionsApi } from "@/api/studySessions";
import { STUDY_SUMMARY_QUERY_KEY } from "@/features/progress/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { homeCategoryCards } from "@/features/home/homePageData";
import { useInterests } from "@/features/interests/useInterests";
import { useTopicEditor } from "@/features/interests/topicEditorContext";
import { usePageSize, PAGE_SIZE_OPTIONS } from "@/hooks/usePageSize";
import type { UserResponse } from "@/types/api";
import { ThemePicker } from "@/theme/ThemePicker";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const UserProfileModal = ({ isOpen, onClose }: UserProfileModalProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const { isAuthenticated, userId } = useAuth();
  const { pageSize, updatePageSize, isUpdating } = usePageSize();
  const topicEditor = useTopicEditor();
  const { interests, status: interestsStatus } = useInterests({ enabled: isOpen });
  const topicNames = interests.map((slug) => topicLabel(slug, new Map(homeCategoryCards.map(card => [card.slug, card.name]))));

  // Private study totals (issue #259); a failure only hides this block, never the rest of the profile.
  const summaryQuery = useQuery({
    queryKey: [...STUDY_SUMMARY_QUERY_KEY, userId],
    queryFn: () => studySessionsApi.getSummary(),
    enabled: isOpen && isAuthenticated,
    retry: false,
    staleTime: 30000,
  });
  const studySummary = summaryQuery.data;

  // Try to get cached data first - check this outside the query
  const cachedUser = queryClient.getQueryData<UserResponse>(["currentUser"]);

  // Only fetch if we don't have cached data AND modal is open AND user is authenticated
  const shouldFetch = isOpen && isAuthenticated && !cachedUser;

  const {
    data: user,
    isLoading,
    isError,
    error,
    status,
  } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        const result = await usersApi.getCurrent();
        return result;
      } catch (err) {
        console.error("Failed to fetch user:", err);
        throw err;
      }
    },
    enabled: shouldFetch, // Only fetch if modal is open, authenticated, and no cached data
    retry: false, // Don't retry on errors
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnMount: false, // Don't refetch if we have cached data
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Use cached data first, then fetched data - this ensures we show cached data immediately
  const displayUser = cachedUser || user;

  // Debug logging (remove in production)
  useEffect(() => {
    if (isOpen) {
      console.log("UserProfileModal state:", {
        isOpen,
        isAuthenticated,
        cachedUser: !!cachedUser,
        user: !!user,
        displayUser: !!displayUser,
        isLoading,
        isError,
        status,
        shouldFetch,
      });
    }
  }, [
    isOpen,
    isAuthenticated,
    cachedUser,
    user,
    displayUser,
    isLoading,
    isError,
    status,
    shouldFetch,
  ]);

  // Initialize name when user data loads
  useEffect(() => {
    if (displayUser && !isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(displayUser.name || "");
    }
  }, [displayUser, isEditing]);

  const updateNameMutation = useMutation({
    mutationFn: (newName: string) => usersApi.updateName({ name: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      setIsEditing(false);
    },
  });

  const handleSave = () => {
    if (name.trim()) {
      updateNameMutation.mutate(name.trim());
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    if (displayUser) {
      setName(displayUser.name || "");
    }
  };

  // Handle ESC key to cancel editing
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditing) {
          handleCancel();
        }
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, isEditing, displayUser]);

  if (!isOpen) return null;

  if (!isAuthenticated) {
    return (
      <div
        className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="User Profile"
          className="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-md bg-surface"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">User Profile</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          <div className="text-sm text-gray-600 mb-4">
            Please sign in to view your profile.
          </div>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // If we have cached or fetched user data, show it immediately (don't wait for loading)
  if (displayUser) {
    const role = displayUser.isAdmin ? "Admin" : "User";

    return (
      <div
        className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="User Profile"
          className="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-md bg-surface"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">User Profile</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono min-w-[400px]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        handleCancel();
                      }
                    }}
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={handleCancel}
                      disabled={updateNameMutation.isPending}
                      className="px-3 py-1 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={updateNameMutation.isPending || !name.trim()}
                      className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {updateNameMutation.isPending ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900 font-mono min-w-[400px]">
                    {displayUser.name || "Not set"}
                  </div>
                  <button
                    onClick={() => {
                      setName(displayUser.name || "");
                      setIsEditing(true);
                    }}
                    className="ml-2 px-3 py-1 text-xs font-medium text-indigo-ink bg-surface border border-indigo-600 rounded-md hover:bg-indigo-50"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                {displayUser.email || "Not set"}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                {role}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Created At
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                {new Date(displayUser.createdAt).toLocaleDateString()}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Login
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                {new Date(displayUser.lastLogin).toLocaleDateString()}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                My topics
              </label>
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1 px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                  {interestsStatus === "loading"
                    ? "Loading..."
                    : interestsStatus === "error"
                      ? "Not available right now"
                      : topicNames.length > 0
                        ? topicNames.join(", ")
                        : "None"}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    topicEditor.open();
                  }}
                  className="ml-2 min-h-[44px] px-3 py-1 text-xs font-medium text-indigo-ink bg-surface border border-indigo-600 rounded-md hover:bg-indigo-50"
                >
                  Change topics
                </button>
              </div>
            </div>

            <section aria-labelledby="profile-progress-heading">
              <h4 id="profile-progress-heading" className="block text-sm font-medium text-gray-700 mb-1">
                Study progress
              </h4>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm text-gray-900">
                {studySummary ? (
                  <dl className="grid grid-cols-3 gap-2 text-center" data-testid="profile-study-summary">
                    <div>
                      <dd className="font-semibold">{studySummary.totalSessions}</dd>
                      <dt className="text-xs text-gray-500">{studySummary.totalSessions === 1 ? "session" : "sessions"}</dt>
                    </div>
                    <div>
                      <dd className="font-semibold">{studySummary.totalQuestions}</dd>
                      <dt className="text-xs text-gray-500">{studySummary.totalQuestions === 1 ? "question" : "questions"}</dt>
                    </div>
                    <div>
                      <dd className="font-semibold">
                        {studySummary.accuracyPercent === null ? "None yet" : `${studySummary.accuracyPercent}%`}
                      </dd>
                      <dt className="text-xs text-gray-500">accuracy</dt>
                    </div>
                  </dl>
                ) : summaryQuery.isLoading ? (
                  <span className="text-gray-500">Loading...</span>
                ) : (
                  <span className="text-gray-500">Study totals are not available right now.</span>
                )}
              </div>
              <Link
                to="/progress"
                onClick={onClose}
                className="mt-1 inline-block text-xs font-medium text-indigo-ink hover:text-indigo-ink underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                View my progress
              </Link>
            </section>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Page Size
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Number of items displayed per page
              </p>
              <select
                value={pageSize}
                onChange={(e) => updatePageSize(parseInt(e.target.value, 10))}
                disabled={isUpdating}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 bg-surface disabled:opacity-50"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} items per page</option>
                ))}
              </select>
            </div>

            <ThemePicker />


            {updateNameMutation.isError && (
              <div className="mt-2 text-sm text-red-600">
                Failed to update name. Please try again.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show error if query failed
  if (isError) {
    return (
      <div
        className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Error"
          className="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-md bg-surface"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Error</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          <div className="text-sm text-red-600 mb-4">
            {error instanceof Error
              ? error.message
              : "Failed to load user profile. Please try again."}
          </div>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Only show loading if we don't have any user data AND query is actually loading (not just refetching)
  // Check status === 'pending' instead of isLoading to avoid showing loading when we have cached data
  if (!displayUser && (isLoading || status === "pending")) {
    return (
      <div className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50">
        <div role="dialog" aria-modal="true" aria-label="User Profile" className="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-md bg-surface">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  // Fallback: no user data available
  return (
    <div
      className="fixed inset-0 bg-black/50 overflow-y-auto h-full w-full z-50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="User Profile"
        className="relative top-20 mx-auto p-5 border w-full max-w-lg shadow-lg rounded-md bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">User Profile</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="text-sm text-gray-600 mb-4">
          User data not available. Please try again later.
        </div>
        <button
          onClick={onClose}
          className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default UserProfileModal;
