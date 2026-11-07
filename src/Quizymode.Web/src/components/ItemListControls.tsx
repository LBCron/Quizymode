interface ItemListControlsProps {
  page: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  isPrevDisabled: boolean;
  isNextDisabled: boolean;
}

const ItemListControls = ({
  page,
  totalPages,
  onPrevPage,
  onNextPage,
  isPrevDisabled,
  isNextDisabled,
}: ItemListControlsProps) => {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="mb-4 bg-surface rounded-lg shadow p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <button
            onClick={onPrevPage}
            disabled={isPrevDisabled}
            className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Previous page"
          >
            ‹
          </button>
          <span className="text-sm text-gray-700">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={onNextPage}
            disabled={isNextDisabled}
            className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
};

export default ItemListControls;
