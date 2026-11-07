/**
 * Config-driven list view for items. Uses ItemListSection under the hood.
 * Use for category/keyword list and collection list.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { ItemResponse } from "@/types/api";
import ItemListSection from "@/components/ItemListSection";
import { ItemCollectionControls } from "@/components/ItemCollectionControls";
import {
  EyeIcon,
  AcademicCapIcon,
  PencilIcon,
  TrashIcon,
  MinusIcon,
} from "@heroicons/react/24/outline";

export interface ItemListViewConfig {
  /** Show star rating and comments link on each card */
  showRatingsAndComments?: boolean;
  /** Show Explore / Quiz / Edit / Delete (or subset) per item */
  showExplore?: boolean;
  showQuiz?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  /** Show remove-from-collection (for collection detail) */
  showRemoveFromCollection?: boolean;
  /** Show add/remove from active collection (+/-) on each card */
  showActiveCollectionButtons?: boolean;
  /** Optional return URL for comments link */
  returnUrl?: string;
}

export interface ItemListViewProps {
  items: ItemResponse[];
  totalCount: number;
  page: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  config: ItemListViewConfig;
  isAuthenticated?: boolean;
  onKeywordClick?: (keywordName: string, item?: ItemResponse) => void;
  selectedKeywords?: string[];
  /** Optional: custom actions override. If provided, config show* flags are ignored for actions. */
  renderActions?: (item: ItemResponse) => ReactNode;
  /** When showRemoveFromCollection, called with collection id and item id */
  onRemoveFromCollection?: (collectionId: string, itemId: string) => void;
  /** When showActiveCollectionButtons, called when user clicks manage collections (folder) */
  onOpenManageCollections?: (itemId: string) => void;
  collectionId?: string;
}

export function ItemListView({
  items,
  totalCount,
  page,
  totalPages,
  onPrevPage,
  onNextPage,
  config,
  isAuthenticated = true,
  onKeywordClick,
  selectedKeywords,
  renderActions: renderActionsOverride,
  onRemoveFromCollection,
  onOpenManageCollections,
  collectionId,
}: ItemListViewProps) {
  const navigate = useNavigate();

  const hasDefaultActions =
    config.showExplore ||
    config.showQuiz ||
    config.showEdit ||
    config.showDelete ||
    config.showRemoveFromCollection ||
    config.showActiveCollectionButtons;

  const renderActions =
    renderActionsOverride ??
    (hasDefaultActions
      ? (item: ItemResponse) => (
          <>
            {config.showExplore && (
              <button
                type="button"
                onClick={() =>
                  collectionId
                    ? navigate(`/explore/collections/${collectionId}/item/${item.id}`)
                    : navigate(`/explore/item/${item.id}?return=${encodeURIComponent(window.location.pathname)}`)
                }
                className="p-2 text-indigo-ink hover:bg-indigo-50 rounded-md"
                title="View item"
              >
                <EyeIcon className="h-5 w-5" />
              </button>
            )}
            {config.showQuiz && (
              <button
                type="button"
                onClick={() =>
                  collectionId
                    ? navigate(`/quiz/collections/${collectionId}/item/${item.id}`)
                    : navigate(`/quiz/item/${item.id}`)
                }
                className="p-2 text-purple-600 hover:bg-purple-50 rounded-md"
                title="Quiz mode"
              >
                <AcademicCapIcon className="h-5 w-5" />
              </button>
            )}
            {config.showEdit && (
              <button
                type="button"
                onClick={() => navigate(`/items/${item.id}/edit`)}
                className="p-2 text-gray-600 hover:bg-gray-50 rounded-md"
                title="Edit"
              >
                <PencilIcon className="h-5 w-5" />
              </button>
            )}
            {config.showDelete && (
              <button
                type="button"
                className="p-2 text-red-600 hover:bg-red-50 rounded-md opacity-50 cursor-not-allowed"
                title="Delete (use renderActions for custom delete)"
              >
                <TrashIcon className="h-5 w-5" />
              </button>
            )}
            {config.showRemoveFromCollection &&
              collectionId &&
              onRemoveFromCollection && (
                <button
                  type="button"
                  onClick={() => onRemoveFromCollection(collectionId, item.id)}
                  className="p-2 text-amber-600 hover:bg-amber-50 rounded-md"
                  title="Remove from collection"
                >
                  <MinusIcon className="h-5 w-5" />
                </button>
              )}
            {config.showActiveCollectionButtons && isAuthenticated && onOpenManageCollections && (
              <ItemCollectionControls
                itemId={item.id}
                itemCollectionIds={new Set((item.collections ?? []).map((c) => c.id))}
                onOpenManageCollections={() => onOpenManageCollections(item.id)}
              />
            )}
          </>
        )
      : undefined);

  return (
    <ItemListSection
      items={items}
      totalCount={totalCount}
      page={page}
      totalPages={totalPages}
      onPrevPage={onPrevPage}
      onNextPage={onNextPage}
      renderActions={renderActions}
      onKeywordClick={onKeywordClick}
      selectedKeywords={selectedKeywords}
      showRatingsAndComments={config.showRatingsAndComments}
      returnUrl={config.returnUrl}
    />
  );
}
