import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { studyGuideDocumentsApi } from "@/api/studyGuideDocuments";
import { useAuth } from "@/contexts/AuthContext";
import { SEO } from "@/components/SEO";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { formatDate } from "@/features/studyGuide/studyGuideSections";

const RECENT_GUIDE_COUNT = 3;

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";
const textLink = `font-medium text-on-panel-muted hover:text-on-panel-muted underline-offset-2 hover:underline rounded ${focusRing}`;

const EXAMPLE_OPTIONS = [
  { label: "Mitochondria", correct: true },
  { label: "Ribosome", correct: false },
  { label: "Golgi apparatus", correct: false },
];

const CreateHubPage = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["studyGuideDocuments", "list"],
    queryFn: () => studyGuideDocumentsApi.list(),
    enabled: isAuthenticated,
  });

  const recent = [...(data?.documents ?? [])]
    .sort((a, b) => new Date(b.lastActivityUtc).getTime() - new Date(a.lastActivityUtc).getTime())
    .slice(0, RECENT_GUIDE_COUNT);

  return (
    <div className="bg-panel-deep text-on-panel">
      <SEO title="Create" description="Turn your notes into quiz questions, or write your own." />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-2 text-3xl font-bold">Create</h1>
        <p className="mb-6 text-sm text-on-panel-muted">Turn your notes into quiz questions, or write your own.</p>

        {!isAuthenticated && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-on-panel/10 bg-panel-raised/50 px-4 py-3 text-sm text-on-panel"
          >
            Sign in to create quizzes and questions.{" "}
            <Link to="/login" className={textLink}>
              Sign In
            </Link>{" "}
            or{" "}
            <Link to="/signup" className={textLink}>
              Sign Up
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col rounded-lg border border-on-panel/10 bg-panel-raised/50 p-4 sm:p-5">
            <h2 className="mb-1 text-lg font-semibold">Turn notes into a quiz</h2>
            <p className="mb-4 text-sm text-on-panel-muted">
              Upload a study guide or paste your notes. Quizymode makes quiz questions and saves them to a private collection you can edit.
            </p>
            <div aria-hidden="true" className="mb-4 rounded-md border border-on-panel/10 bg-panel/60 p-3 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Example</p>
              <p className="mb-2 text-on-panel">Which organelle produces most of a cell&apos;s ATP?</p>
              <ul className="space-y-1">
                {EXAMPLE_OPTIONS.map((option) => (
                  <li
                    key={option.label}
                    className={`rounded px-2 py-1 ${
                      option.correct ? "bg-emerald-500/20 text-emerald-ink" : "bg-on-panel/5 text-on-panel-muted"
                    }`}
                  >
                    {option.label}
                  </li>
                ))}
              </ul>
            </div>
            <Link
              to="/create/notes"
              className={`mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 sm:w-auto sm:self-start ${focusRing}`}
            >
              Make a quiz
            </Link>
          </div>

          <div className="flex flex-col rounded-lg border border-on-panel/10 bg-panel-raised/50 p-4 sm:p-5">
            <h2 className="mb-1 text-lg font-semibold">Write a question</h2>
            <p className="mb-4 text-sm text-on-panel-muted">
              Add a single question with its correct answer, wrong options and an optional explanation.
            </p>
            <Link
              to={`/create/question${location.search}`}
              className={`mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-md border border-on-panel/30 px-4 py-2 text-sm font-medium text-on-panel hover:bg-on-panel/10 sm:w-auto sm:self-start ${focusRing}`}
            >
              Write a question
            </Link>
          </div>
        </div>

        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link to={`/create/import${location.search}`} className={textLink}>
            Import questions from text or a file
          </Link>
        </p>

        {isAuthenticated && (
          <section aria-labelledby="recent-study-guides-heading" className="mt-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="recent-study-guides-heading" className="text-lg font-semibold">
                Recent study guides
              </h2>
              {recent.length > 0 && (
                <Link to="/study-guides/documents" className={`text-sm ${textLink}`}>
                  My study guides
                </Link>
              )}
            </div>
            {isLoading ? (
              <LoadingSpinner />
            ) : error ? (
              <ErrorMessage message="Couldn't load your recent study guides." onRetry={() => void refetch()} />
            ) : recent.length === 0 ? (
              <div className="rounded-lg border border-dashed border-on-panel/20 p-6 text-center text-sm text-on-panel-muted">
                No study guides yet. Make your first quiz above.
              </div>
            ) : (
              <ul className="space-y-3">
                {recent.map((document) => (
                  <li
                    key={document.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-on-panel/10 bg-panel-raised/50 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{document.title}</p>
                      <p className="text-xs text-slate-400">
                        {document.acceptedCount} question{document.acceptedCount === 1 ? "" : "s"} saved · Last
                        activity {formatDate(document.lastActivityUtc)}
                      </p>
                    </div>
                    <Link
                      to={`/study-guides/documents/${encodeURIComponent(document.id)}`}
                      aria-label={`Continue ${document.title}`}
                      className={`rounded-md border border-on-panel/30 px-3 py-1.5 text-sm font-medium text-on-panel hover:bg-on-panel/10 ${focusRing}`}
                    >
                      Continue
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default CreateHubPage;
