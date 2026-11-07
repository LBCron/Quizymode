import { Link } from "react-router-dom";
import { FolderOpenIcon } from "@heroicons/react/24/outline";
import { useActiveCollection } from "@/hooks/useActiveCollection";

/**
 * Shows an informational banner about the user's active collection on item creation pages.
 * Warns that newly created items will be added to this collection and notes the public visibility risk.
 */
export function ActiveCollectionNotice() {
  const { activeCollection } = useActiveCollection();

  if (!activeCollection) return null;

  const isPublic = activeCollection.isPublic === true;

  return (
    <div className="mb-6 flex gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-ink">
      <FolderOpenIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
      <p>
        New items will be added to your active collection{" "}
        <Link
          to="/collections"
          className="font-semibold underline underline-offset-2 hover:text-indigo-ink"
        >
          {activeCollection.name}
        </Link>
        .{" "}
        {isPublic ? (
          <span className="font-medium text-amber-700">
            This collection is public — items will be accessible via its shareable link immediately.
          </span>
        ) : (
          <span>
            If this collection is made public in the future, items will be accessible via its
            shareable link.
          </span>
        )}
      </p>
    </div>
  );
}
