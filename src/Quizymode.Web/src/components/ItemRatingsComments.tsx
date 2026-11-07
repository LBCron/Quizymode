import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ratingsApi } from "@/api/ratings";
import { commentsApi } from "@/api/comments";
import { useAuth } from "@/contexts/AuthContext";
import { StarIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";

interface ItemRatingsCommentsProps {
  itemId: string;
  navigationContext?: {
    mode: "explore" | "quiz";
    category?: string;
    collectionId?: string;
    currentIndex: number;
    itemIds: string[];
  };
  /** When navigating from list view, pass the URL to return to */
  returnUrl?: string;
  /** When in study flow (Explore/Quiz), open comments in drawer instead of navigating */
  onOpenComments?: (itemId: string) => void;
  presentation?: "default" | "list-card";
}

const ItemRatingsComments = ({
  itemId,
  navigationContext,
  returnUrl,
  onOpenComments,
  presentation = "default",
}: ItemRatingsCommentsProps) => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [userRating, setUserRating] = useState<number | null>(null);
  const hideAggregateSummary = presentation === "list-card";

  const { data: ratingStats } = useQuery({
    queryKey: ["ratingStats", itemId],
    queryFn: () => ratingsApi.getStats(itemId),
    enabled: true,
  });

  const { data: userRatingData } = useQuery({
    queryKey: ["userRating", itemId],
    queryFn: () => ratingsApi.getUserRating(itemId),
    enabled: isAuthenticated,
  });

  const { data: commentsData } = useQuery({
    queryKey: ["comments", itemId],
    queryFn: () => commentsApi.getByItemId(itemId),
    enabled: true,
  });

  // Reset rating state when itemId changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserRating(null);
  }, [itemId]);

  // Initialize user rating from API response
  useEffect(() => {
    if (userRatingData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserRating(userRatingData.stars);
    } else if (userRatingData === null) {
      // Explicitly null means no rating exists
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserRating(null);
    }
  }, [userRatingData]);

  const ratingMutation = useMutation({
    mutationFn: (stars: number | null) =>
      ratingsApi.createOrUpdate({ itemId, stars }),
    onSuccess: (response) => {
      setUserRating(response.stars);
      // Invalidate individual item rating stats
      queryClient.invalidateQueries({ queryKey: ["ratingStats", itemId] });
      // Invalidate all bulk rating stats queries (used for filtering in list view)
      queryClient.invalidateQueries({ queryKey: ["ratingStats", "bulk"] });
      queryClient.invalidateQueries({ queryKey: ["userRating", itemId] });
      // Invalidate categories (ratings affect category average display)
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  const handleStarClick = (stars: number) => {
    if (!isAuthenticated) return;
    const newRating = userRating === stars ? null : stars;
    ratingMutation.mutate(newRating);
  };

  const commentsCount = commentsData?.comments.length || 0;
  const averageStars = ratingStats?.averageStars;
  const ratingCount = ratingStats?.count || 0;
  const showStarControls = isAuthenticated;
  const showAggregateSummary =
    !hideAggregateSummary &&
    averageStars !== null &&
    averageStars !== undefined;
  const hasLeadingContent = showStarControls || showAggregateSummary;

  return (
    <div
      className={`mt-4 flex items-center gap-4 border-t pt-4 ${
        hasLeadingContent ? "justify-between" : "justify-end"
      }`}
    >
      {/* Star Rating */}
      {showStarControls && (
        <div className="flex items-center space-x-1">
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled = userRating !== null && star <= userRating;
            return (
              <button
                key={star}
                onClick={() => handleStarClick(star)}
                disabled={ratingMutation.isPending}
                className="text-yellow-400 hover:text-yellow-500 disabled:opacity-50"
                title={`Rate ${star} star${star > 1 ? "s" : ""}`}
              >
                {isFilled ? (
                  <StarIconSolid className="h-5 w-5" />
                ) : (
                  <StarIcon className="h-5 w-5" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Average Rating */}
      {showAggregateSummary && (
        <div className="flex items-center space-x-1 text-sm text-gray-600">
          <StarIconSolid className="h-4 w-4 text-yellow-400" />
          <span className="font-medium">{averageStars.toFixed(1)}</span>
          <span className="text-gray-500">({ratingCount})</span>
        </div>
      )}

      {/* Comments Link */}
      <button
        onClick={() => {
          if (onOpenComments) {
            onOpenComments(itemId);
          } else {
            const params = new URLSearchParams();
            if (returnUrl) {
              params.set("return", returnUrl);
            } else if (navigationContext) {
              params.set("mode", navigationContext.mode);
              if (navigationContext.category) {
                params.set("category", navigationContext.category);
              }
              if (navigationContext.collectionId) {
                params.set("collectionId", navigationContext.collectionId);
              }
              params.set(
                "currentIndex",
                navigationContext.currentIndex.toString()
              );
              params.set("itemIds", navigationContext.itemIds.join(","));
            }
            const queryString = params.toString();
            navigate(
              `/items/${itemId}/comments${queryString ? `?${queryString}` : ""}`
            );
          }
        }}
        className="whitespace-nowrap text-sm font-medium text-indigo-ink hover:text-indigo-ink"
      >
        Comments ({commentsCount})
      </button>
    </div>
  );
};

export default ItemRatingsComments;
