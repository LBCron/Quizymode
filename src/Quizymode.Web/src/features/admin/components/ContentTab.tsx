import { useQuery } from "@tanstack/react-query";
import { adminApi, type ContentRowResponse } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";

interface ContentTabProps {
  days: number;
  includeBots: boolean;
  includeInternal?: boolean;
}

const TH = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const TD = "px-4 py-3 text-sm text-slate-700";

const dash = (value: number | null) => (value === null ? "—" : value);

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
    <div className="border-b border-slate-200 px-5 py-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-600">{description}</p>
    </div>
    {children}
  </section>
);

const Empty = ({ text }: { text: string }) => (
  <div className="px-5 py-8 text-center text-sm text-slate-500">{text}</div>
);

const ContentTable = ({
  rows,
  label,
  showCollectionSignals,
}: {
  rows: ContentRowResponse[];
  label: string;
  showCollectionSignals: boolean;
}) =>
  rows.length === 0 ? (
    <Empty text="No activity recorded in this window." />
  ) : (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH}>{label}</th>
            <th className={TH}>Sessions</th>
            <th className={TH}>Study sessions</th>
            <th className={TH}>Item steps</th>
            <th className={TH}>Ratings</th>
            <th className={TH}>Avg stars</th>
            <th className={TH}>Comments</th>
            {showCollectionSignals && <th className={TH}>Bookmarks</th>}
            {showCollectionSignals && <th className={TH}>Shares</th>}
            <th className={TH}>Completions</th>
            <th className={TH}>Avg score %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-surface">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-4 py-3 text-sm font-medium text-slate-900">
                {row.name ?? row.key}
              </td>
              <td className={TD}>{row.sessions}</td>
              <td className={TD}>{row.studySessions}</td>
              <td className={TD}>{row.itemSteps}</td>
              <td className={TD}>{row.ratingsCount}</td>
              <td className={TD}>{dash(row.averageStars)}</td>
              <td className={TD}>{row.comments}</td>
              {showCollectionSignals && <td className={TD}>{dash(row.bookmarks)}</td>}
              {showCollectionSignals && <td className={TD}>{dash(row.shares)}</td>}
              <td className={TD}>{dash(row.completions)}</td>
              <td className={TD}>{dash(row.averageScorePercent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

const ContentTab = ({ days, includeBots, includeInternal = false }: ContentTabProps) => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "content-report", days, includeBots, includeInternal],
    queryFn: () => adminApi.getContentReport(days, includeBots, includeInternal),
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorMessage message="Failed to load the content report" onRetry={() => refetch()} />;
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <Section
        title="Categories"
        description="Usage and community signals per category for the selected window."
      >
        {data.botsExcluded && data.botSessions > 0 && (
          <p className="px-5 pt-3 text-xs text-slate-500">
            {data.botSessions} bot session{data.botSessions === 1 ? " was" : "s were"} excluded.
          </p>
        )}
        {data.internalExcluded && data.internalSessions > 0 && (
          <p className="px-5 pt-3 text-xs text-slate-500">
            {data.internalSessions} internal session{data.internalSessions === 1 ? " was" : "s were"}{" "}
            excluded.
          </p>
        )}
        <ContentTable rows={data.categories} label="Category" showCollectionSignals={false} />
      </Section>

      <Section
        title="Navigation sets"
        description="Category plus up to two navigation keywords. Ratings and comments roll up to each prefix."
      >
        <ContentTable rows={data.navigationSets} label="Set" showCollectionSignals={false} />
      </Section>

      <Section title="Collections" description="Usage, ratings, bookmarks, and shares per collection.">
        <ContentTable rows={data.collections} label="Collection" showCollectionSignals />
      </Section>

      <Section
        title="Featured performance"
        description="Sessions that viewed home or the Featured page, and how many of them then opened each featured entry in the same session."
      >
        {data.featured.length === 0 ? (
          <Empty text="No featured entries." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Entry</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Sessions seen</th>
                  <th className={TH}>Opened</th>
                  <th className={TH}>Click-through</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-surface">
                {data.featured.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.displayName}</td>
                    <td className={`${TD} capitalize`}>{row.type}</td>
                    <td className={TD}>{row.sessionsSeen}</td>
                    <td className={TD}>{row.sessionsOpened}</td>
                    <td className={TD}>
                      {row.clickThroughPercent === null ? "—" : `${row.clickThroughPercent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Untouched content"
        description="Public categories and collections with no Quiz or Flashcards activity in the window."
      >
        <div className="grid gap-6 px-5 py-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Categories ({data.untouchedCategories.length})
            </h3>
            {data.untouchedCategories.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Every public category was studied.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                {data.untouchedCategories.map((entry) => (
                  <li key={entry.key}>{entry.name}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Collections ({data.untouchedCollections.length})
            </h3>
            {data.untouchedCollections.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Every public collection was studied.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                {data.untouchedCollections.map((entry) => (
                  <li key={entry.key}>{entry.name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="User-created content"
        description="Items and collections created by users (not seed sync), by week."
      >
        {data.userCreated.length === 0 ? (
          <Empty text="No user-created content in this window." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Week of</th>
                  <th className={TH}>Private items</th>
                  <th className={TH}>Public items</th>
                  <th className={TH}>Collections</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-surface">
                {data.userCreated.map((week) => (
                  <tr key={week.weekStartUtc}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {week.weekStartUtc.slice(0, 10)}
                    </td>
                    <td className={TD}>{week.privateItems}</td>
                    <td className={TD}>{week.publicItems}</td>
                    <td className={TD}>{week.collections}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};

export default ContentTab;
