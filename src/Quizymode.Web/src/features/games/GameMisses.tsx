import { CheckIcon } from "@heroicons/react/24/outline";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";
import { describeAddResult, useAddMissesToReview } from "./useAddMissesToReview";

export interface GameMiss {
  id: string;
  question: string;
  answer: string;
}

interface GameMissesProps {
  runId: string;
  misses: readonly GameMiss[];
}

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/** The items missed in a run (first-miss order) and, for signed-in players, an explicit Add misses to Review button. */
export function GameMisses({ runId, misses }: GameMissesProps) {
  const ids: string[] = misses.map((miss) => miss.id);
  const review = useAddMissesToReview(runId, ids);
  if (misses.length === 0) return null;

  const done: boolean = review.attempted && review.failed === 0;
  let label = "Add misses to Review";
  if (review.isPending) label = "Adding...";
  else if (review.failed > 0) label = "Try again";
  else if (done && review.added > 0) label = "Added";
  else if (done) label = "Can't add";

  const status: string = review.attempted && !review.isPending ? describeAddResult(review.added, review.unavailable, review.failed) : "";
  const isError: boolean = review.failed > 0 || (review.attempted && review.added === 0);
  const disabled: boolean = review.isPending || done;

  return (
    <div className="mt-8 border-t border-gray-200 pt-4 text-left">
      <h3 className="text-base font-semibold text-gray-900">Misses</h3>
      <div role="region" aria-label="Misses" tabIndex={0} className={`mt-2 max-h-64 overflow-y-auto sm:max-h-80 ${RING}`}>
        <ul className="divide-y divide-gray-200">
          {misses.map((miss) => (
            <li key={miss.id} className="py-2">
              <p className="text-sm text-gray-600 [overflow-wrap:anywhere]">
                <ForeignPhraseText text={miss.question} />
              </p>
              <p className="text-base font-semibold text-gray-900 [overflow-wrap:anywhere]">
                <ForeignPhraseText text={miss.answer} />
              </p>
            </li>
          ))}
        </ul>
      </div>
      {review.canAdd && (
        <div className="mt-4">
          <button
            type="button"
            aria-disabled={disabled}
            aria-busy={review.isPending || undefined}
            onClick={() => {
              if (!disabled) void review.addAll();
            }}
            className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-indigo-600 px-4 py-2 font-semibold text-indigo-ink hover:bg-indigo-50 sm:w-auto ${
              disabled ? "cursor-not-allowed opacity-60" : ""
            } ${RING}`}
          >
            {done && review.added > 0 && <CheckIcon className="h-5 w-5" aria-hidden="true" />}
            {label}
          </button>
          <p role="status" className={`mt-2 text-sm ${isError ? "text-red-700" : "text-green-800"}`}>
            {status}
          </p>
        </div>
      )}
    </div>
  );
}
