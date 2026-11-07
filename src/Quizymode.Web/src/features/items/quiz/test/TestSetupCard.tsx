import { useState } from "react";
import { TEST_MAX_QUESTIONS } from "../quizRun";
import { choiceFromLimit, resolveTimeLimit, type TimeLimitChoice } from "./testSetup";

interface TestSetupCardProps {
  /** Questions in this test. */
  count: number;
  /** Playable questions before the 500 cap. */
  availableCount: number;
  /** Requested quiz size, when the scope has one. */
  requestedSize: number | null;
  /** Limit kept from the previous run (Play again). */
  initialLimitSec: number | null;
  onStart: (limitSec: number | null) => void;
}

/** AC 3.18.2: nothing is shown or sent until Start test. */
export function TestSetupCard({ count, availableCount, requestedSize, initialLimitSec, onStart }: TestSetupCardProps) {
  const initial = choiceFromLimit(initialLimitSec, count);
  const [choice, setChoice] = useState<TimeLimitChoice>(initial.choice);
  const [customMinutes, setCustomMinutes] = useState(initial.customMinutes);
  const resolved = resolveTimeLimit(choice, customMinutes, count);

  return (
    <section aria-labelledby="test-setup-title" className="rounded-lg border border-gray-200 bg-surface p-4 sm:p-6">
      <h2 id="test-setup-title" className="text-xl font-bold text-gray-900">
        Test mode
      </h2>
      <p className="mt-1 text-sm text-gray-700">Learn, Test and Review are free.</p>
      <p className="mt-1 text-gray-800">
        {count} {count === 1 ? "question" : "questions"}
      </p>
      {availableCount > TEST_MAX_QUESTIONS && (
        <p className="mt-1 text-sm text-gray-600">
          Your test will use {TEST_MAX_QUESTIONS} of {availableCount}.
        </p>
      )}
      {requestedSize !== null && availableCount < requestedSize && (
        <p className="mt-1 text-sm text-gray-600">
          Only {availableCount} {availableCount === 1 ? "question" : "questions"} available. Your test will use {count}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-700">
        <label htmlFor="test-time-limit" className="font-medium">
          Time limit
        </label>
        <select
          id="test-time-limit"
          value={choice}
          onChange={(event) => setChoice(event.target.value as TimeLimitChoice)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="none">No limit</option>
          <option value="per-1">1 min per question</option>
          <option value="per-2">2 min per question</option>
          <option value="custom">Custom</option>
        </select>
        {choice === "custom" && (
          <div className="flex items-center gap-2">
            <input
              aria-label="Custom time limit in minutes"
              type="text"
              inputMode="numeric"
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
              aria-invalid={resolved.error !== null}
              aria-describedby={resolved.error ? "test-time-limit-error" : undefined}
              className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span aria-hidden="true">minutes</span>
          </div>
        )}
      </div>
      {resolved.error && (
        <p id="test-time-limit-error" className="mt-1 text-xs text-red-700">
          {resolved.error}
        </p>
      )}
      {resolved.capped && <p className="mt-1 text-xs text-gray-600">The time limit is capped at 600 minutes.</p>}

      <p className="mt-4 text-sm text-gray-600">Answers and explanations appear after you submit.</p>
      <button
        type="button"
        disabled={resolved.error !== null || count === 0}
        onClick={() => onStart(resolved.limitSec)}
        className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        Start test
      </button>
    </section>
  );
}
