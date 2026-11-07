/**
 * Reusable grid of bucket cards (category or keyword sets). Click opens the bucket.
 * Mode switching is handled at page level via ModeSwitcher.
 */
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";

export interface BucketItem {
  id: string;
  label: string;
  itemCount: number;
  description?: string | null;
  averageRating?: number | null;
  /** Show "Private" (purple) badge when true (e.g. category/collection). */
  isPrivate?: boolean;
  /** Show "Private" (yellow) badge when > 0 (e.g. keyword set has private items). */
  privateItemCount?: number;
  backgroundImage?: string;
  eyebrow?: string;
}

export interface BucketGridViewProps {
  buckets: BucketItem[];
  onOpenBucket: (bucket: BucketItem) => void;
  className?: string;
  columnsClassName?: string;
  compact?: boolean;
}

export function BucketGridView({
  buckets,
  onOpenBucket,
  className = "",
  columnsClassName = "grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3",
  compact = false,
}: BucketGridViewProps) {
  return (
    <div
      className={`grid ${columnsClassName} ${className}`}
    >
      {buckets.map((bucket) => (
        <div
          key={bucket.id}
          role="button"
          tabIndex={0}
          title={bucket.description ?? undefined}
          onClick={() => onOpenBucket(bucket)}
          onKeyDown={(e) => e.key === "Enter" && onOpenBucket(bucket)}
          className={
            bucket.backgroundImage
              ? "group relative isolate overflow-hidden rounded-[24px] border border-white/10 bg-panel text-left shadow-lg shadow-slate-950/20 transition duration-200 hover:-translate-y-1 hover:shadow-xl cursor-pointer"
              : "bg-surface overflow-hidden shadow rounded-lg hover:shadow-lg transition-shadow p-4 text-left cursor-pointer"
          }
        >
          {bucket.backgroundImage ? (
            <>
              <img
                src={bucket.backgroundImage}
                alt=""
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.08)_0%,rgba(2,6,23,0.34)_42%,rgba(2,6,23,0.92)_100%)]" />
              <div
                className={`relative flex flex-col justify-between text-white ${
                  compact ? "min-h-[68px] p-2.5" : "min-h-[160px] p-4"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {bucket.eyebrow ? (
                      <span className="rounded-full border border-white/16 bg-slate-950/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200 backdrop-blur">
                        {bucket.eyebrow}
                      </span>
                    ) : null}
                    {bucket.isPrivate === true && (
                      <span className="rounded-full bg-purple-500/20 px-3 py-1 text-[11px] font-semibold text-purple-200 backdrop-blur">
                        Private
                      </span>
                    )}
                    {bucket.privateItemCount != null && bucket.privateItemCount > 0 && (
                      <span className="rounded-full bg-amber-400/20 px-3 py-1 text-[11px] font-semibold text-amber-50 backdrop-blur">
                        Private
                      </span>
                    )}
                  </div>
                  <div className="rounded-full border border-white/20 bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                    {bucket.itemCount} items
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold tracking-tight text-white ${compact ? "text-sm" : "text-xl"}`}>
                      {bucket.label}
                    </h3>
                  </div>
                  {bucket.description ? (
                    <p className={`max-w-lg text-[#e2e8f0] line-clamp-1 ${compact ? "text-[10px] leading-4" : "text-sm leading-6"}`}>
                      {bucket.description}
                    </p>
                  ) : null}
                  {bucket.averageRating != null && (
                    <div className="flex items-center gap-1.5 text-sm text-[#f1f5f9]">
                      <StarIconSolid className="h-4 w-4 text-yellow-300" />
                      <span className="font-medium">
                        {bucket.averageRating.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-medium text-gray-900">{bucket.label}</h3>
                  {bucket.isPrivate === true && (
                    <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 text-purple-800">
                      Private
                    </span>
                  )}
                  {bucket.privateItemCount != null && bucket.privateItemCount > 0 && (
                    <span className="px-2 py-1 text-xs font-medium rounded bg-amber-100 text-amber-800">
                      Private
                    </span>
                  )}
                </div>
                {bucket.description ? (
                  <p className="mt-1 text-sm text-gray-600 line-clamp-1">
                    {bucket.description}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0 text-sm text-gray-500">
                <span>{bucket.itemCount} items</span>
                {bucket.averageRating != null && (
                  <div className="flex items-center gap-1 text-gray-600">
                    <StarIconSolid className="h-4 w-4 text-yellow-400" />
                    <span className="font-medium">
                      {bucket.averageRating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
