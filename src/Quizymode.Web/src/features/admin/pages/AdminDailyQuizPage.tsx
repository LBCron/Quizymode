import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyQuizApi } from "@/api/learningLoop";
import LoadingSpinner from "@/components/LoadingSpinner";
import { QuestionImage } from "@/components/study/QuestionImage";
import { utcToday } from "@/features/learningLoop/localLearningState";

const DAYS_AHEAD = 7;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Admin moderation for the daily quiz (#119): view today's or an upcoming (up to 7 days) set and remove an unsuitable
 * question. The slot is refilled with the next eligible item in seed order; completions already recorded keep credit.
 */
const AdminDailyQuizPage = () => {
  const today = utcToday();
  const dates = React.useMemo(() => Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => addDays(today, i)), [today]);
  const [date, setDate] = React.useState(today);
  const queryClient = useQueryClient();
  const queryKey = ["admin", "daily-quiz", date];

  const query = useQuery({ queryKey, queryFn: () => dailyQuizApi.adminGet(date), retry: false });
  const exclude = useMutation({
    mutationFn: (itemId: string) => dailyQuizApi.adminExclude(date, itemId),
    onSuccess: (day) => {
      queryClient.setQueryData(queryKey, day);
      void queryClient.invalidateQueries({ queryKey: ["daily-quiz"] });
    },
  });

  const active = query.data?.items.filter((item) => !item.excluded) ?? [];
  const excluded = query.data?.items.filter((item) => item.excluded) ?? [];

  return (
    <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6">
      <Link to="/admin" className="text-sm font-semibold text-indigo-700 hover:underline">
        ← Admin
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Daily quiz</h1>
      <p className="mt-1 text-sm text-gray-600">
        One global set of five public questions per UTC day, chosen from the date seed. Items flagged by the question quality
        report and items used within 30 days are skipped. Removing a question fills its slot with the next eligible one.
      </p>

      <label htmlFor="daily-date" className="mt-4 block text-sm font-medium text-gray-800">
        Day (UTC)
      </label>
      <select
        id="daily-date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      >
        {dates.map((value) => (
          <option key={value} value={value}>
            {value}
            {value === today ? " (today)" : ""}
          </option>
        ))}
      </select>

      {query.isLoading && <LoadingSpinner />}
      {query.isError && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          The daily set could not be loaded.
        </p>
      )}
      {exclude.isError && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          That question could not be removed. Reload and try again.
        </p>
      )}

      {query.data && (
        <>
          {active.length === 0 ? (
            <p className="mt-4 text-sm text-gray-700">No eligible questions for this day.</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {active.map((item) => (
                <li key={item.itemId} className="flex items-start justify-between gap-3 rounded-lg bg-white p-3 shadow">
                  <div className="flex min-w-0 items-start gap-3">
                    <QuestionImage itemId={item.itemId} image={item.questionImage} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase text-gray-500">
                        #{item.position + 1} · {item.category ?? "No category"}
                      </p>
                      <p className="mt-1 text-sm text-gray-900">{item.question}</p>
                      <Link to={`/items/${item.itemId}`} className="mt-1 inline-block text-xs font-semibold text-indigo-700 hover:underline">
                        Open item
                      </Link>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => exclude.mutate(item.itemId)}
                    disabled={exclude.isPending}
                    className="shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    aria-label={`Remove from daily set: ${item.question}${item.questionImage ? ` (picture: ${item.questionImage.altText})` : ""}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          {excluded.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-gray-800">Removed for this day</h2>
              <ul className="mt-2 space-y-1 text-sm text-gray-600">
                {excluded.map((item) => (
                  <li key={item.itemId} className="flex items-center gap-2">
                    <QuestionImage itemId={item.itemId} image={item.questionImage} size="xs" />
                    <span className="line-through">{item.question}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default AdminDailyQuizPage;
