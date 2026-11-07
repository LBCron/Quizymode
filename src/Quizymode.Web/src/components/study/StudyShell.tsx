/**
 * Shared shell for Explore and Quiz modes: header, index/prev/next, body slot,
 * ratings/comments, collection controls.
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon } from "@heroicons/react/24/outline";
import type { ItemResponse } from "@/types/api";
import ItemRatingsComments from "@/components/ItemRatingsComments";
import { ItemCollectionControls } from "@/components/ItemCollectionControls";
import { StudyHotkeysHint } from "@/components/study/StudyHotkeysHint";

export interface StudyShellProps {
  /** Back link / breadcrumb above the card */
  backContent?: ReactNode;
  title?: string;
  description?: string;
  /** Optional control (e.g. quiz size) to show in header */
  headerExtra?: ReactNode;
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  /** Label of the Next button and the chevron title; defaults to "Next" (Flashcards uses "Finish" on the last card). */
  nextLabel?: string;
  /** Muted label beside the counter, for example the Flashcards "Still learning" round. Hidden below sm. */
  roundLabel?: string;
  isPrevDisabled: boolean;
  isNextDisabled: boolean;
  currentItem: ItemResponse | undefined;
  /** Body: ExploreRenderer or QuizRenderer output */
  children: ReactNode;
  navigationContext?: {
    mode: "explore" | "quiz";
    category?: string;
    collectionId?: string;
    currentIndex: number;
    itemIds: string[];
  };
  onOpenComments: (itemId: string) => void;
  onOpenManageCollections: (itemId: string) => void;
  /** Called after add/remove so parent can update item in cache (e.g. quiz mode). */
  onCollectionChange?: (
    itemId: string,
    updatedCollectionIds: Set<string>,
    payload: { added?: { id: string; name: string }; removedId?: string }
  ) => void;
  isAuthenticated: boolean;
  /** When false (e.g. quiz before answer), hide ratings and collection controls. Default true. */
  showRatingsAndCollections?: boolean;
  /** Hides the "View item details" link (Test: the details page would show the answer). */
  hideItemDetailsLink?: boolean;
  /** Opens the keyboard shortcuts dialog; shows the Shortcuts hint beside the details link. */
  onOpenShortcuts?: () => void;
  /** Footer (back to collection / categories) */
  footerContent?: ReactNode;
  /** Sign-up prompt when not authenticated */
  signUpPrompt?: ReactNode;
}

export function StudyShell({
  backContent,
  title,
  description,
  headerExtra,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  nextLabel = "Next",
  roundLabel,
  isPrevDisabled,
  isNextDisabled,
  currentItem,
  children,
  navigationContext,
  onOpenComments,
  onOpenManageCollections,
  onCollectionChange,
  isAuthenticated,
  showRatingsAndCollections = true,
  hideItemDetailsLink = false,
  footerContent,
  signUpPrompt,
  onOpenShortcuts,
}: StudyShellProps) {
  const location = useLocation();
  const itemDetailHref = currentItem
    ? (() => {
        const params = new URLSearchParams();
        params.set("return", `${location.pathname}${location.search}`);
        if (navigationContext?.mode) {
          params.set("returnMode", navigationContext.mode);
        }
        return `/items/${currentItem.id}?${params.toString()}`;
      })()
    : undefined;

  return (
    <div className="max-w-4xl mx-auto">
        {backContent}

        <div className="bg-surface shadow rounded-lg p-4 mb-4">
          {title && (
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
          )}
          {description && (
            <p className="text-xs text-gray-500 mb-2">{description}</p>
          )}

          {/* Compact stripe: [quiz size / left] [navigation / center] [eye icon / right] */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-3">
            <div className="flex-1 basis-auto min-[400px]:basis-0 flex items-center">
              {headerExtra ?? null}
            </div>
            <div className="flex items-center space-x-1 flex-shrink-0">
              <button
                type="button"
                onClick={onPrev}
                disabled={isPrevDisabled}
                className="p-1 text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
                title="Previous item"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <span
                className="text-sm text-gray-500 min-w-[72px] text-center"
                aria-label={roundLabel ? `${currentIndex + 1} of ${totalCount}, ${roundLabel} round` : undefined}
              >
                {currentIndex + 1} of {totalCount}
              </span>
              {roundLabel && (
                <span className="hidden text-xs font-medium text-indigo-ink sm:inline" aria-hidden="true">
                  {roundLabel}
                </span>
              )}
              <button
                type="button"
                onClick={onNext}
                disabled={isNextDisabled}
                className="p-1 text-gray-600 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
                title={nextLabel === "Next" ? "Next item" : nextLabel}
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 basis-auto min-[400px]:basis-0 flex items-center justify-end gap-1">
              {onOpenShortcuts && <StudyHotkeysHint onClick={onOpenShortcuts} />}
              {currentItem && !hideItemDetailsLink ? (
                <Link
                  to={itemDetailHref ?? `/items/${currentItem.id}`}
                  className="p-1.5 text-indigo-ink hover:bg-indigo-50 rounded-md"
                  title="View item details"
                >
                  <EyeIcon className="h-5 w-5" />
                </Link>
              ) : hideItemDetailsLink ? null : (
                <span className="w-8" />
              )}
            </div>
          </div>

          {currentItem && (
            <div className="space-y-3">
              {children}

              {showRatingsAndCollections && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ItemRatingsComments
                    itemId={currentItem.id}
                    navigationContext={navigationContext}
                    onOpenComments={onOpenComments}
                  />
                  {(isAuthenticated ||
                    (currentItem.collections && currentItem.collections.length > 0)) && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <ItemCollectionControls
                        itemId={currentItem.id}
                        itemCollectionIds={new Set(
                          (currentItem.collections ?? []).map((c) => c.id)
                        )}
                        onOpenManageCollections={() => onOpenManageCollections(currentItem.id)}
                        onSuccess={
                          onCollectionChange
                            ? (ids, payload) =>
                                onCollectionChange(currentItem.id, ids, payload)
                            : undefined
                        }
                      />
                      {currentItem.collections &&
                        currentItem.collections.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            {currentItem.collections.map((collection) => (
                              <Link
                                key={collection.id}
                                to={`/collections?selected=${collection.id}`}
                                className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
                                title={`Collection: ${collection.name}`}
                              >
                                {collection.name}
                              </Link>
                            ))}
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between mt-4">
            <button
              type="button"
              onClick={onPrev}
              disabled={isPrevDisabled}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={isNextDisabled}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {nextLabel}
            </button>
          </div>
        </div>

        {signUpPrompt}

        {footerContent && (
          <div className="text-center">{footerContent}</div>
        )}
    </div>
  );
}
