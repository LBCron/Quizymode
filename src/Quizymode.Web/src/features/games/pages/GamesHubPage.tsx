import { useMemo } from "react";
import { Link } from "react-router-dom";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { ScopeSecondaryBar } from "@/components/ScopeSecondaryBar";
import { GAME_MIN_ITEMS, getMatchRaceTargetPairs } from "../gameRoster";
import { BUCKET_DROP_ID, GAMES, MATCH_RACE_ID, SORT_IT_ID, SURVIVAL_ID, SWIPE_BLITZ_ID } from "../gameRegistry";
import { buildGamePath, gameScopeKey } from "../gameScope";
import { bucketDropBestKey, readGameBest, sortItBestKey, survivalBestKey, swipeBlitzBestKey } from "../gameBest";
import { useGameRoster } from "../useGameRoster";
import { GamesEmptyState } from "../GamesEmptyState";
import { readBestForScope } from "../matchRace/matchRaceBest";
import { formatGameTime } from "../matchRace/matchRaceRun";
import { hasSortableSet } from "../sortIt/sortItPool";

/** "Best 0:42.1" / "Best 23" / "Best streak 12"; null when the scope has no best for the game. */
function getBestLabel(gameId: string, scopeKey: string, targetPairs: number): string | null {
  if (gameId === MATCH_RACE_ID) {
    const ms: number | null = readBestForScope(scopeKey, targetPairs);
    return ms === null ? null : `Best ${formatGameTime(ms)}`;
  }
  if (gameId === SWIPE_BLITZ_ID) {
    const score: number | null = readGameBest(swipeBlitzBestKey(scopeKey));
    return score && score > 0 ? `Best ${score}` : null;
  }
  if (gameId === SURVIVAL_ID) {
    const streak: number | null = readGameBest(survivalBestKey(scopeKey));
    return streak && streak > 0 ? `Best streak ${streak}` : null;
  }
  if (gameId === BUCKET_DROP_ID) {
    const score: number | null = readGameBest(bucketDropBestKey(scopeKey));
    return score && score > 0 ? `Best ${score}` : null;
  }
  if (gameId === SORT_IT_ID) {
    const score: number | null = readGameBest(sortItBestKey(scopeKey));
    return score && score > 0 ? `Best ${score}` : null;
  }
  return null;
}

const GamesHubPage = () => {
  const { scope, topicBar, topicPrompt, pool, rawItems, isPending, error, refetch, availableModes, handleModeChange, quizPath, excludedPictures } = useGameRoster();

  const sortable: boolean = useMemo(() => hasSortableSet(rawItems), [rawItems]);

  const scopeBar = (
    <ScopeSecondaryBar
      scopeType={scope.kind === "collection" ? "collection" : "category"}
      activeMode="games"
      availableModes={availableModes}
      onModeChange={handleModeChange}
    />
  );

  let body;
  if (topicPrompt) {
    body = topicPrompt;
  } else if (error) {
    body = (
      <div role="alert" className="mx-auto mt-4 max-w-4xl">
        <ErrorMessage message="We couldn't load games." onRetry={refetch} />
      </div>
    );
  } else if (isPending) {
    body = <LoadingSpinner />;
  } else if (pool.length < GAME_MIN_ITEMS && !sortable) {
    body = <GamesEmptyState quizPath={quizPath} excludedPictures={excludedPictures} poolEmpty={pool.length === 0} />;
  } else {
    const scopeKey: string = gameScopeKey(scope);
    const targetPairs: number = getMatchRaceTargetPairs();
    body = (
      <>
        <h1 className="mx-auto mt-4 max-w-4xl text-lg font-semibold text-gray-900">Games</h1>
        {excludedPictures > 0 && (
          <p className="mx-auto mt-1 max-w-4xl text-xs text-gray-600">
            {excludedPictures === 1 ? "1 picture question is left out of games." : `${excludedPictures} picture questions are left out of games.`}
          </p>
        )}
        <div className="mx-auto mt-4 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.filter((game) =>
            game.id === SORT_IT_ID ? sortable : pool.length >= GAME_MIN_ITEMS,
          ).map((game) => {
            const best: string | null = getBestLabel(game.id, scopeKey, targetPairs);
            const Icon = game.icon;
            return (
              <section key={game.id} className="flex flex-col rounded-lg bg-surface p-4 shadow sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-indigo-50 text-indigo-ink">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <h2 className="text-base font-semibold text-gray-900">{game.name}</h2>
                </div>
                <p className="mt-2 text-sm text-gray-600">{game.blurb}</p>
                {best !== null && <p className="mt-1 text-xs text-gray-500">{best}</p>}
                <div className="mt-4" />
                <Link
                  to={buildGamePath(scope, game.id)}
                  aria-label={`Play ${game.name}`}
                  className="mt-auto inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:w-auto"
                >
                  Play
                </Link>
              </section>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="py-3 sm:py-4">
      {scopeBar}
      {topicBar}
      {body}
    </div>
  );
};

export default GamesHubPage;
