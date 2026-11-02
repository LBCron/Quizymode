import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { QuestionImage } from "@/components/study/QuestionImage";

interface QuestionQualityTabProps {
  days: number;
  includeBots: boolean;
  includeInternal?: boolean;
}

const TH = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-4 py-3 text-sm text-slate-700";

const QuestionQualityTab = ({ days, includeBots, includeInternal = false }: QuestionQualityTabProps) => {
  const [minAnswers, setMinAnswers] = useState(10);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "question-quality", days, minAnswers, includeBots, includeInternal],
    queryFn: () => adminApi.getQuestionQualityReport(days, minAnswers, includeBots, includeInternal),
  });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Question quality</h2>
        <p className="mt-1 text-sm text-gray-600">
          First-attempt correct rate per question, since last edit, lowest first. Editing a question
          resets its statistics.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          Minimum answers
          <input
            type="number"
            min={1}
            max={10000}
            value={minAnswers}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 1 && value <= 10000) {
                setMinAnswers(Math.floor(value));
              }
            }}
            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        {data && data.botsExcluded && data.botSessions > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {data.botSessions} bot session{data.botSessions === 1 ? " was" : "s were"} excluded.
          </p>
        )}
        {data && data.internalExcluded && data.internalSessions > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {data.internalSessions} internal session{data.internalSessions === 1 ? " was" : "s were"}{" "}
            excluded.
          </p>
        )}
      </div>

      {isLoading && <LoadingSpinner />}

      {error && (
        <ErrorMessage message="Failed to load the question quality report" onRetry={() => refetch()} />
      )}

      {data && data.items.length === 0 && (
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          No questions have {minAnswers} or more first-attempt answers since their last edit in this
          window.
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Question</th>
                <th className={TH}>Correct answer</th>
                <th className={TH}>Category</th>
                <th className={TH}>Collections</th>
                <th className={TH}>Answers (since last edit)</th>
                <th className={TH}>Correct rate</th>
                <th className={TH}>Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {data.items.map((item) => (
                <tr key={item.itemId}>
                  <td className="max-w-xs px-4 py-3 text-sm font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <QuestionImage image={item.questionImage} size="xs" />
                      <span>{item.question}</span>
                    </div>
                  </td>
                  <td className={TD}>{item.correctAnswer}</td>
                  <td className={TD}>{item.category ?? "—"}</td>
                  <td className={TD}>{item.collections.length ? item.collections.join(", ") : "—"}</td>
                  <td className={TD}>{item.answers}</td>
                  <td className={TD}>
                    {item.correctRatePercent}%
                    {item.checkAnswerKey && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        Check answer key
                      </span>
                    )}
                    <div className="text-xs text-slate-500">
                      random guess {item.randomGuessPercent}%
                    </div>
                  </td>
                  <td className={TD}>
                    <Link
                      to={`/items/${item.itemId}/edit`}
                      className="font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default QuestionQualityTab;
