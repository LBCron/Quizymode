import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { itemsApi } from "@/api/items";
import { categoryNameToSlug } from "@/utils/categorySlug";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { QuestionImage } from "@/components/study/QuestionImage";

const ItemsPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const category = searchParams.get("category") || undefined;
  const [mode, setMode] = useState<"explore" | "quiz" | null>(null);
  /** List mode (Random Items) loads all available items (backend max 1000) into memory */
  const LIST_MAX_ITEMS = 1000;
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["randomItems", category, LIST_MAX_ITEMS],
    queryFn: () => itemsApi.getRandom(category, LIST_MAX_ITEMS),
    enabled: mode !== null,
  });

  const handleStart = () => {
    if (!mode) return;
    const path = mode === "explore" ? "/explore" : "/quiz";
    if (category) {
      navigate(`${path}/${categoryNameToSlug(category)}`);
    } else {
      navigate(path);
    }
  };

  const handleItemClick = (itemId: string) => {
    if (!mode || !data?.items) return;
    const path = mode === "explore" ? "/explore" : "/quiz";

    // Store items in sessionStorage so Quiz/Explore mode can use them
    const storageKey =
      mode === "explore"
        ? "navigationContext_explore"
        : "navigationContext_quiz";
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        mode: mode,
        category: category,
        items: data.items,
        currentIndex: data.items.findIndex((item) => item.id === itemId),
      })
    );

    if (category) {
      navigate(`${path}/${categoryNameToSlug(category)}/item/${itemId}`);
    } else {
      navigate(`${path}/item/${itemId}`);
    }
  };

  // Reset to page 1 when mode or category changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [mode, category]);

  if (mode === null) {
    return (
      <div className="py-4 sm:py-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {category ? `Category: ${category}` : "Get Random Items"}
          </h1>
          <p className="text-gray-600 text-sm mb-6">
            Select a mode to interact with quiz items. Choose Flashcards Mode to study one question at a time (question first; click the card to reveal the answer and explanation), or Quiz Mode to test your knowledge with multiple-choice questions.
          </p>

          <p className="text-sm text-gray-600 mb-6">
            All available items in this category will be loaded (up to 1000).
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              onClick={() => setMode("explore")}
              className="bg-surface overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow p-6 text-left"
            >
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Flashcards Mode
              </h3>
              <p className="text-sm text-gray-500">
                Question face-up; click the card to reveal the answer and explanation
              </p>
            </button>
            <button
              onClick={() => setMode("quiz")}
              className="bg-surface overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow p-6 text-left"
            >
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Quiz Mode
              </h3>
              <p className="text-sm text-gray-500">
                Test yourself with multiple choice questions
              </p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) return <LoadingSpinner />;
  if (error)
    return (
      <ErrorMessage message="Failed to load items" onRetry={() => refetch()} />
    );

  return (
    <div className="py-4 sm:py-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {mode === "explore" ? "Flashcards Mode" : "Quiz Mode"}
        </h1>
        <p className="text-gray-600 text-sm mb-6">
          {mode === "explore" 
            ? "Review the selected items below. Click an item to open Flashcards mode: the question is shown first; click the card to reveal the answer and explanation."
            : "Test your knowledge with the selected items. Click on any item to start the quiz and track your score."}
        </p>

        {data?.items && data.items.length > 0 ? (
          <div className="space-y-4">
            {/* Show paginated items */}
            {data.items
              .slice((page - 1) * pageSize, page * pageSize)
              .map((item) => (
                <div
                  key={item.id}
                  className="bg-surface shadow rounded-lg p-6 cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => handleItemClick(item.id)}
                >
                  <div className="flex items-start gap-3">
                    <QuestionImage itemId={item.id} image={item.questionImage} size="sm" />
                    <div className="min-w-0">
                      <p className="text-gray-900 font-medium">
                        {item.question.length > 100
                          ? `${item.question.substring(0, 100)}...`
                          : item.question}
                      </p>
                      <p className="mt-2 text-sm text-gray-500">{item.category}</p>
                    </div>
                  </div>
                </div>
              ))}

            {/* Pagination controls */}
            {data.items.length > pageSize && (
              <div className="flex justify-center items-center space-x-2 mt-6">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={page === 1}
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {page} of {Math.ceil(data.items.length / pageSize)} (
                  {data.items.length} items)
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage((p) =>
                      Math.min(Math.ceil(data.items.length / pageSize), p + 1)
                    );
                  }}
                  disabled={page >= Math.ceil(data.items.length / pageSize)}
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}

            <div className="flex justify-center mt-6">
              <button
                onClick={handleStart}
                className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium"
              >
                Start {mode === "explore" ? "Exploring" : "Quiz"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500">No items found.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemsPage;
