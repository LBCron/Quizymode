import type { ReactNode } from "react";
import type { ItemResponse } from "@/types/api";
import ItemListControls from "@/components/ItemListControls";
import ItemListCard from "@/components/ItemListCard";

interface ItemListSectionProps {
  items: ItemResponse[];
  totalCount: number;
  page: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  renderActions?: (item: ItemResponse) => ReactNode;
  onKeywordClick?: (keywordName: string, item?: import("@/types/api").ItemResponse) => void;
  selectedKeywords?: string[];
  showRatingsAndComments?: boolean;
  returnUrl?: string;
  collectionId?: string;
  /** See ItemListCard.showAnswer. When false all answers are hidden; when true shown with green highlight. */
  showAnswers?: boolean;
}

const ItemListSection = ({
  items,
  totalCount: _totalCount, // eslint-disable-line @typescript-eslint/no-unused-vars
  page,
  totalPages,
  onPrevPage,
  onNextPage,
  renderActions,
  onKeywordClick,
  selectedKeywords,
  showRatingsAndComments,
  returnUrl,
  collectionId,
  showAnswers,
}: ItemListSectionProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <ItemListControls
        page={page}
        totalPages={totalPages}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        isPrevDisabled={page === 1}
        isNextDisabled={page === totalPages}
      />

      <div className="space-y-4 mb-6">
        {items.map((item) => (
          <ItemListCard
            key={item.id}
            item={item}
            onKeywordClick={onKeywordClick ? (kw) => onKeywordClick(kw, item) : undefined}
            selectedKeywords={selectedKeywords}
            actions={renderActions ? renderActions(item) : undefined}
            showRatingsAndComments={showRatingsAndComments}
            returnUrl={returnUrl}
            collectionId={collectionId}
            showAnswer={showAnswers}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mb-6 rounded-lg bg-white p-4 shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onPrevPage}
              disabled={page === 1}
              className="rounded-md bg-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={onNextPage}
              disabled={page === totalPages}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemListSection;
