/**
 * Persistent indicator for the user's active collection on study screens.
 * Shows "Active: <name>" with Switch (open modal), Clear, and Manage (link to /collections).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { FolderIcon, XMarkIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { useActiveCollection } from "@/hooks/useActiveCollection";
import ItemCollectionsModal from "./ItemCollectionsModal";

export function ActiveCollectionBadge() {
  const { activeCollection, activeCollectionId, setActiveCollectionId } =
    useActiveCollection();
  const [showModal, setShowModal] = useState(false);

  if (!activeCollectionId || !activeCollection) {
    return (
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
        title="Set active collection for quick add/remove"
      >
        <FolderIcon className="h-4 w-4" />
        <span>No active collection</span>
      </button>
    );
  }

  return (
    <>
      <div className="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium bg-indigo-50 text-indigo-ink rounded-md border border-indigo-100">
        <span className="font-medium">Active:</span>
        <span className="truncate max-w-[120px] sm:max-w-[180px]" title={activeCollection.name}>
          {activeCollection.name}
        </span>
        <div className="flex items-center gap-0.5 border-l border-indigo-200 pl-2 ml-0.5">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="p-0.5 rounded hover:bg-indigo-100 text-indigo-ink"
            title="Switch active collection"
          >
            <Cog6ToothIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveCollectionId(null)}
            className="p-0.5 rounded hover:bg-indigo-100 text-indigo-ink"
            title="Clear active collection"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
          <Link
            to="/collections"
            className="p-0.5 rounded hover:bg-indigo-100 text-indigo-ink"
            title="Manage collections"
          >
            <FolderIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <ItemCollectionsModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}
