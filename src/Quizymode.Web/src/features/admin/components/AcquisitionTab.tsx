import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi, type AcquisitionChannelRow } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import VisitorCohortPanel from "./VisitorCohortPanel";

interface AcquisitionTabProps {
  days: number;
  includeBots: boolean;
  includeInternal?: boolean;
}

const DEVICE_OPTIONS = [
  { label: "All devices", value: "" },
  { label: "Desktop", value: "desktop" },
  { label: "Mobile", value: "mobile" },
  { label: "Tablet", value: "tablet" },
  { label: "Unknown", value: "unknown" },
];

const headerCell =
  "px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";

const ChannelRow = ({ row }: { row: AcquisitionChannelRow }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Fragment>
      <tr>
        <td className="px-5 py-3 text-sm font-medium capitalize text-slate-900">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-2 rounded text-left hover:text-indigo-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
            {row.channel}
          </button>
        </td>
        <td className="px-5 py-3 text-sm font-semibold text-slate-900">{row.sessions}</td>
        <td className="px-5 py-3 text-sm text-slate-700">{row.bounceRatePercent}%</td>
        <td className="px-5 py-3 text-sm text-slate-700">{row.engagedRatePercent}%</td>
        <td className="px-5 py-3 text-sm text-slate-700">{row.convertedCount}</td>
        <td className="px-5 py-3 text-sm text-slate-700">{row.conversionRatePercent}%</td>
      </tr>
      {expanded &&
        row.sourceBreakdown.map((source) => (
          <tr
            key={`${row.channel}:${source.utmSource ?? ""}:${source.utmCampaign ?? ""}`}
            className="bg-slate-50"
          >
            <td className="py-2 pl-12 pr-5 text-sm text-slate-700">
              {source.utmSource ?? "(no source)"}
              <span className="text-slate-400"> / </span>
              {source.utmCampaign ?? "(no campaign)"}
            </td>
            <td className="px-5 py-2 text-sm text-slate-700">{source.sessions}</td>
            <td className="px-5 py-2 text-sm text-slate-700">{source.bounceRatePercent}%</td>
            <td className="px-5 py-2 text-sm text-slate-700">{source.engagedRatePercent}%</td>
            <td className="px-5 py-2 text-sm text-slate-700">{source.convertedCount}</td>
            <td className="px-5 py-2 text-sm text-slate-700">{source.conversionRatePercent}%</td>
          </tr>
        ))}
    </Fragment>
  );
};

/** Where visitors come from and which sources engage and convert (ANALYTICS-002/003). */
const AcquisitionTab = ({ days, includeBots, includeInternal = false }: AcquisitionTabProps) => {
  const [deviceClass, setDeviceClass] = useState("");
  const [country, setCountry] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "acquisition-report", days, includeBots, includeInternal, deviceClass, country],
    queryFn: () =>
      adminApi.getAcquisitionReport(
        days,
        includeBots,
        includeInternal,
        deviceClass || undefined,
        country || undefined
      ),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm text-slate-700">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Device
          </span>
          <select
            value={deviceClass}
            onChange={(event) => setDeviceClass(event.target.value)}
            className="mt-1 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm"
          >
            {DEVICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Country
          </span>
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className="mt-1 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm"
          >
            <option value="">All countries</option>
            {(data?.countryBreakdown ?? [])
              .filter((row) => row.country)
              .map((row) => (
                <option key={row.country} value={row.country ?? ""}>
                  {row.country}
                </option>
              ))}
            {country && !(data?.countryBreakdown ?? []).some((row) => row.country === country) && (
              <option value={country}>{country}</option>
            )}
          </select>
        </label>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && (
        <ErrorMessage message="Failed to load the acquisition report" onRetry={() => refetch()} />
      )}

      {data && (
        <>
          <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Acquisition by Channel</h2>
              <p className="mt-1 text-sm text-gray-600">
                {data.totalSessions} sessions, classified by how the first page hit arrived. Expand a
                channel to see its sources and campaigns.
              </p>
              {data.botsExcluded && data.botSessions > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {data.botSessions} bot session{data.botSessions === 1 ? " was" : "s were"}{" "}
                  excluded.
                </p>
              )}
              {data.internalExcluded && data.internalSessions > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {data.internalSessions} internal session
                  {data.internalSessions === 1 ? " was" : "s were"} excluded.
                </p>
              )}
            </div>

            {data.channels.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">
                No sessions recorded in this window.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={headerCell}>Channel</th>
                      <th className={headerCell}>Sessions</th>
                      <th className={headerCell}>Bounce</th>
                      <th className={headerCell}>Engaged</th>
                      <th className={headerCell}>Converted</th>
                      <th className={headerCell}>Conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-surface">
                    {data.channels.map((row) => (
                      <ChannelRow key={row.channel} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">By Device</h2>
              <ul className="mt-3 divide-y divide-slate-200">
                {data.deviceBreakdown.map((row) => (
                  <li key={row.deviceClass} className="flex justify-between py-2 text-sm">
                    <span className="capitalize text-slate-700">{row.deviceClass}</span>
                    <span className="font-semibold text-slate-900">{row.sessions}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900">By Country</h2>
              <ul className="mt-3 divide-y divide-slate-200">
                {data.countryBreakdown.map((row) => (
                  <li key={row.country ?? "unknown"} className="flex justify-between py-2 text-sm">
                    <span className="text-slate-700">{row.country ?? "Unknown"}</span>
                    <span className="font-semibold text-slate-900">{row.sessions}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <VisitorCohortPanel visitors={data.visitors} />
        </>
      )}
    </div>
  );
};

export default AcquisitionTab;
