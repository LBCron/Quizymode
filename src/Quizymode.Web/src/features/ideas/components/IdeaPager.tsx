import { getTotalPages } from "../ideaPaging";

interface IdeaPagerProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  tone?: "dark" | "light";
  label?: string;
}

/** Previous/Next pager; renders nothing when everything fits on the first page. */
const IdeaPager = ({
  page,
  pageSize,
  totalCount,
  onPageChange,
  tone = "dark",
  label = "Ideas pagination",
}: IdeaPagerProps) => {
  const totalPages = getTotalPages(totalCount, pageSize);
  if (totalPages <= 1 && page <= 1) {
    return null;
  }

  const buttonClass =
    tone === "dark"
      ? "rounded-full border border-on-panel/20 px-4 py-2 text-sm font-medium text-on-panel transition hover:bg-on-panel/10 disabled:opacity-40"
      : "rounded-full border border-slate-300 bg-surface px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40";
  const textClass = tone === "dark" ? "text-on-panel-muted" : "text-slate-600";

  return (
    <nav
      aria-label={label}
      className="mt-6 flex items-center justify-between gap-3"
    >
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className={buttonClass}
      >
        Previous
      </button>
      <span className={`text-sm ${textClass}`}>
        Page {page} of {Math.max(totalPages, page)} ({totalCount} ideas)
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className={buttonClass}
      >
        Next
      </button>
    </nav>
  );
};

export default IdeaPager;
