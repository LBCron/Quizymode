import { Link } from "react-router-dom";

interface GamesEmptyStateProps {
  quizPath: string;
  /** Defaults to the generic short-questions heading. */
  heading?: string;
  /** Optional line under the heading. */
  message?: string;
  /** Picture questions in scope that no game can use (#403); when above 0 the empty state explains them. */
  excludedPictures?: number;
  /** True when the pool is empty; otherwise picture questions are only added as a line under the generic reason. */
  poolEmpty?: boolean;
}

/** "N picture questions here aren't playable as games. Practise them in Quiz." (singular for 1). */
function excludedPicturesMessage(count: number): string {
  return count === 1
    ? "1 picture question here isn't playable as a game. Practise it in Quiz."
    : `${count} picture questions here aren't playable as games. Practise them in Quiz.`;
}

/** Shown when a scope has fewer than GAME_MIN_ITEMS short, playable items (AC 3.20.3, AC 3.20.34). */
export function GamesEmptyState({
  quizPath,
  heading = "Not enough short questions for games here",
  message,
  excludedPictures = 0,
  poolEmpty = true,
}: GamesEmptyStateProps) {
  const hasPictures = excludedPictures > 0;
  const onlyPictures = hasPictures && poolEmpty;
  return (
    <section
      role={onlyPictures ? "status" : undefined}
      className="mx-auto mt-4 max-w-4xl rounded-lg bg-surface p-6 text-center shadow"
    >
      <h2 className="text-xl font-bold text-gray-900">{onlyPictures ? "No games for this set" : heading}</h2>
      {onlyPictures ? (
        <p className="mt-2 text-sm text-gray-600">{excludedPicturesMessage(excludedPictures)}</p>
      ) : (
        <>
          {message && <p className="mt-2 text-sm text-gray-600">{message}</p>}
          {hasPictures && <p className="mt-2 text-sm text-gray-600">{excludedPicturesMessage(excludedPictures)}</p>}
        </>
      )}
      <Link
        to={quizPath}
        className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto"
      >
        Open Quiz
      </Link>
    </section>
  );
}
