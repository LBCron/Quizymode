import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  dailyDigestApi,
  type DailyDigestPreview,
  type DailyDigestRun,
  type DailyDigestRuns,
} from "@/api/adminDailyDigest";
import ErrorMessage from "@/components/ErrorMessage";
import LoadingSpinner from "@/components/LoadingSpinner";
import { formatInZone, toLocalInput, validateWindow } from "./digestFormatting";

const TEST_COOLDOWN_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;

const BUTTON =
  "rounded-full px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px] w-full sm:w-auto sm:min-h-0";
const SECONDARY = `${BUTTON} border border-gray-300 bg-surface text-gray-700 hover:bg-gray-50`;
const PRIMARY = `${BUTTON} bg-indigo-600 text-white hover:bg-indigo-700`;

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function errorLabel(lastError: string | null | undefined): string {
  if (!lastError) return "";
  return lastError === "NotConfigured" ? "Not configured" : lastError;
}

type Tone = "green" | "red" | "amber" | "gray";

const TONES: Record<Tone, string> = {
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  gray: "bg-gray-100 text-gray-700",
};

const Badge = ({ tone, children }: { tone: Tone; children: string }) => (
  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>
);

function statusOf(run: DailyDigestRun): { label: string; tone: Tone } {
  if (run.status === "Sent") return { label: "Sent", tone: "green" };
  if (run.status === "Missed") return { label: "Missed", tone: "red" };
  if (run.status === "Failed" && run.lastError === "NotConfigured") return { label: "Not configured", tone: "amber" };
  if (run.status === "Failed") return { label: "Failed", tone: "red" };
  return { label: "Sending", tone: "gray" };
}

interface StatusBlockProps {
  data: DailyDigestRuns;
  lastScheduled: DailyDigestRun | undefined;
  warning: boolean;
  lastSent: DailyDigestRun | undefined;
}

const StatusBlock = ({ data, lastScheduled, warning, lastSent }: StatusBlockProps) => {
  const zone = data.timeZone;
  if (!data.enabled) {
    return (
      <div>
        <Badge tone="gray">Off</Badge>
        <p className="mt-2 text-sm text-gray-700">Daily digest is turned off.</p>
        {data.disabledReason && <p className="text-sm text-gray-500">Reason: {data.disabledReason}</p>}
      </div>
    );
  }

  const nextDue = data.nextDueUtc ? formatInZone(data.nextDueUtc, zone) : null;
  const notConfigured = !data.emailConfigured;
  return (
    <div className="space-y-3">
      {notConfigured && (
        <div>
          <Badge tone="amber">Not configured</Badge>
          <p className="mt-2 text-sm text-gray-700">
            Email is not configured, so digests cannot be sent. Set the Email settings on the server.
          </p>
        </div>
      )}
      {!lastScheduled ? (
        <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-gray-600">
          No digest has been sent yet.{nextDue ? ` The first one is due ${nextDue}.` : ""}
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Last run</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-gray-900">
              <Badge tone={statusOf(lastScheduled).tone}>{statusOf(lastScheduled).label}</Badge>
              <span>for {lastScheduled.reportDate}</span>
            </dd>
          </div>
          {lastSent?.sentUtc && (
            <div>
              <dt className="text-gray-500">Last sent</dt>
              <dd className="mt-0.5 text-gray-900">
                <time dateTime={lastSent.sentUtc}>{formatInZone(lastSent.sentUtc, zone)}</time> for {lastSent.reportDate}
              </dd>
            </div>
          )}
          {lastScheduled.status === "Failed" && lastScheduled.lastError && lastScheduled.lastError !== "NotConfigured" && (
            <div>
              <dt className="text-gray-500">Reason</dt>
              <dd className="mt-0.5 text-gray-900">{errorLabel(lastScheduled.lastError)}</dd>
            </div>
          )}
          {lastScheduled.status === "Failed" && (
            <div>
              <dt className="text-gray-500">Attempts</dt>
              <dd className="mt-0.5 text-gray-900">
                {lastScheduled.attempts} of {MAX_ATTEMPTS}
                {lastScheduled.nextAttemptUtc && (
                  <>
                    {" "}
                    - next retry <time dateTime={lastScheduled.nextAttemptUtc}>{formatInZone(lastScheduled.nextAttemptUtc, zone)}</time>
                  </>
                )}
              </dd>
            </div>
          )}
          {lastScheduled.status === "Missed" && (
            <div className="sm:col-span-2 text-gray-900">The digest for {lastScheduled.reportDate} was not sent.</div>
          )}
          {nextDue && (
            <div>
              <dt className="text-gray-500">Next due</dt>
              <dd className="mt-0.5 text-gray-900">
                <time dateTime={data.nextDueUtc ?? undefined}>{nextDue}</time>
              </dd>
            </div>
          )}
        </dl>
      )}
      {warning && (
        <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <span aria-hidden="true">! </span>
          No digest sent in the last 26 hours. Last sent:{" "}
          {lastSent?.sentUtc ? formatInZone(lastSent.sentUtc, zone) : "never"}.
        </div>
      )}
    </div>
  );
};

/** A clock state that ticks once a second while a countdown is running. */
function useTicker(active: boolean, setNow: (value: number) => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, setNow]);
}

const DailyDigestCard = () => {
  const queryClient = useQueryClient();
  const runsQuery = useQuery({
    queryKey: ["admin", "daily-digest-runs"],
    queryFn: () => dailyDigestApi.getRuns(14),
  });

  const [showPreview, setShowPreview] = useState(false);
  const preview = useMutation<DailyDigestPreview, unknown, void>({ mutationFn: () => dailyDigestApi.getPreview() });
  const [testMessage, setTestMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [localCooldownEnd, setLocalCooldownEnd] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const testSend = useMutation({
    mutationFn: () => dailyDigestApi.sendTest(),
    onSuccess: () => {
      setNow(Date.now());
      setLocalCooldownEnd(Date.now() + TEST_COOLDOWN_MS);
      setTestMessage({ text: "Test email sent to the configured admin address.", error: false });
      void queryClient.invalidateQueries({ queryKey: ["admin", "daily-digest-runs"] });
    },
    onError: (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const retryAfter = Number(error.response.headers?.["retry-after"]);
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : TEST_COOLDOWN_MS;
        setNow(Date.now());
        setLocalCooldownEnd(Date.now() + wait);
        setTestMessage({
          text: `A test email was sent recently. Try again in ${Math.max(1, Math.ceil(wait / 60000))} minutes.`,
          error: true,
        });
      } else if (axios.isAxiosError(error) && error.response?.status === 503) {
        setTestMessage({ text: "Email is not configured on the server, so no test could be sent.", error: true });
      } else {
        setTestMessage({ text: "Sending the test failed. Try again later.", error: true });
      }
    },
  });

  // Ad hoc "Send digest now": the window defaults to the last 24 hours ending when the page was opened.
  const [opened] = useState(() => new Date(Math.floor(Date.now() / 1000) * 1000));
  const [from, setFrom] = useState(() => toLocalInput(new Date(opened.getTime() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toLocalInput(opened));
  const [windowError, setWindowError] = useState<string | null>(null);
  const [sendNowMessage, setSendNowMessage] = useState<{ text: string; error: boolean } | null>(null);
  const sendNow = useMutation({
    mutationFn: ({ fromDate, toDate }: { fromDate: Date; toDate: Date }) =>
      dailyDigestApi.sendNow(fromDate.toISOString(), toDate.toISOString()),
    onSuccess: () => {
      setSendNowMessage({ text: "Digest sent to the configured admin address.", error: false });
      void queryClient.invalidateQueries({ queryKey: ["admin", "daily-digest-runs"] });
    },
    onError: (error) => {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 429) {
        setSendNowMessage({ text: "A digest was sent a moment ago. Please wait a minute before sending another.", error: true });
      } else if (status === 503) {
        setSendNowMessage({ text: "Email is not configured on the server, so nothing was sent.", error: true });
      } else if (status === 400 && axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") {
        setSendNowMessage({ text: error.response.data.detail, error: true });
      } else {
        setSendNowMessage({ text: "Sending the digest failed. Try again later.", error: true });
      }
    },
  });

  const data = runsQuery.data;
  const apiCooldownEnd = data?.lastTestSentUtc ? new Date(data.lastTestSentUtc).getTime() + TEST_COOLDOWN_MS : null;
  const cooldownEnd = Math.max(localCooldownEnd ?? 0, apiCooldownEnd ?? 0);
  const coolingDown = cooldownEnd > now;
  useTicker(coolingDown, setNow);

  if (runsQuery.isLoading) {
    return (
      <section aria-labelledby="daily-digest-heading" aria-busy="true" className="mb-8 rounded-lg bg-surface p-4 shadow sm:p-6">
        <h2 id="daily-digest-heading" className="text-xl font-semibold text-gray-900">Daily digest</h2>
        <LoadingSpinner />
      </section>
    );
  }

  if (runsQuery.isError || !data) {
    return (
      <section aria-labelledby="daily-digest-heading" className="mb-8 rounded-lg bg-surface p-4 shadow sm:p-6">
        <h2 id="daily-digest-heading" className="mb-3 text-xl font-semibold text-gray-900">Daily digest</h2>
        <ErrorMessage message="Failed to load daily digest status." onRetry={() => void runsQuery.refetch()} />
      </section>
    );
  }

  const scheduled = data.runs.filter((run) => run.kind === "Scheduled");
  const lastScheduled = scheduled[0];
  const lastSent = scheduled.find((run) => run.status === "Sent");
  const sentRecently = lastSent?.sentUtc
    ? runsQuery.dataUpdatedAt - new Date(lastSent.sentUtc).getTime() <= STALE_AFTER_MS
    : false;
  const warning = data.enabled && !sentRecently;
  const canTest = data.emailConfigured;
  const testLabel = testSend.isPending
    ? "Sending..."
    : coolingDown
      ? `Test sent. Try again in ${formatCountdown(cooldownEnd - now)}`
      : "Send test email";

  const onSendNow = () => {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const problem = validateWindow(fromDate, toDate, new Date());
    setWindowError(problem);
    setSendNowMessage(null);
    if (!problem) {
      sendNow.mutate({ fromDate, toDate });
    }
  };

  const previewError = preview.error;
  const previewBad = axios.isAxiosError(previewError) && previewError.response?.status === 400;

  return (
    <section aria-labelledby="daily-digest-heading" className="mb-8 rounded-lg bg-surface p-4 shadow sm:p-6">
      <h2 id="daily-digest-heading" className="mb-4 text-xl font-semibold text-gray-900">Daily digest</h2>
      <div className="min-w-0 max-w-full space-y-4">
        <StatusBlock data={data} lastScheduled={lastScheduled} warning={warning} lastSent={lastSent} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className={SECONDARY}
            disabled={preview.isPending}
            onClick={() => {
              setShowPreview(true);
              preview.mutate();
            }}
          >
            {preview.isPending ? "Loading preview..." : "Preview"}
          </button>
          <button
            type="button"
            className={PRIMARY}
            disabled={!canTest || testSend.isPending || coolingDown}
            aria-disabled={!canTest || testSend.isPending || coolingDown}
            aria-describedby={!canTest ? "daily-digest-test-hint" : undefined}
            onClick={() => {
              setTestMessage(null);
              testSend.mutate();
            }}
          >
            {testLabel}
          </button>
        </div>
        {!canTest && (
          <p id="daily-digest-test-hint" className="text-sm text-gray-500">
            Sending a test needs the Email settings on the server.
          </p>
        )}
        <div role="status" aria-live="polite" aria-atomic="true" className="text-sm">
          {testMessage && (
            <p className={testMessage.error ? "text-red-700" : "text-green-700"} role={testMessage.error ? "alert" : undefined}>
              {testMessage.text}
            </p>
          )}
        </div>

        {showPreview && (preview.isError || preview.data) && (
          <div className="min-w-0 max-w-full">
            {preview.isError ? (
              <ErrorMessage
                message={previewBad ? "That day cannot be previewed." : "Failed to load the preview."}
                onRetry={() => preview.mutate()}
              />
            ) : (
              preview.data && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900">Preview for {preview.data.reportDate}</h3>
                    <button type="button" className={SECONDARY} onClick={() => setShowPreview(false)}>
                      Close preview
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">Subject: {preview.data.subject}</p>
                  <pre
                    tabIndex={0}
                    aria-label="Digest preview text"
                    className="mt-2 max-h-96 overflow-auto whitespace-pre rounded-md bg-slate-50 p-3 font-mono text-xs text-gray-900"
                  >
                    {preview.data.textBody}
                  </pre>
                </>
              )
            )}
          </div>
        )}

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-base font-semibold text-gray-900">Send digest now</h3>
          <p className="mt-1 text-sm text-gray-600">
            Emails a digest for any window of up to 31 days to the configured admin address. Times are in your browser time zone.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-gray-700">
              From
              <input
                type="datetime-local"
                step={1}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-surface px-2 py-1.5 text-gray-900"
              />
            </label>
            <label className="block text-sm text-gray-700">
              To
              <input
                type="datetime-local"
                step={1}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-surface px-2 py-1.5 text-gray-900"
              />
            </label>
          </div>
          <div className="mt-3">
            <button
              type="button"
              className={PRIMARY}
              disabled={sendNow.isPending || !data.emailConfigured}
              aria-describedby={!data.emailConfigured ? "daily-digest-test-hint" : undefined}
              onClick={onSendNow}
            >
              {sendNow.isPending ? "Sending..." : "Send digest now"}
            </button>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true" className="mt-2 text-sm">
            {windowError && <p className="text-red-700" role="alert">{windowError}</p>}
            {sendNowMessage && (
              <p className={sendNowMessage.error ? "text-red-700" : "text-green-700"} role={sendNowMessage.error ? "alert" : undefined}>
                {sendNowMessage.text}
              </p>
            )}
          </div>
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Recent runs</summary>
          {data.runs.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No runs in the last 14 days.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th scope="col" className="py-1 pr-4 font-medium">Date</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Type</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Status</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Attempts</th>
                    <th scope="col" className="py-1 pr-4 font-medium">Error</th>
                    <th scope="col" className="py-1 font-medium">Sent at</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {data.runs.map((run) => (
                    <tr key={run.id}>
                      <td className="py-1 pr-4">{run.reportDate}</td>
                      <td className="py-1 pr-4">{run.kind === "AdHoc" ? "Ad hoc" : "Scheduled"}</td>
                      <td className="py-1 pr-4">{statusOf(run).label}</td>
                      <td className="py-1 pr-4">{run.attempts}</td>
                      <td className="py-1 pr-4">{errorLabel(run.lastError) || "-"}</td>
                      <td className="py-1">{run.sentUtc ? formatInZone(run.sentUtc, data.timeZone) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </div>
    </section>
  );
};

export default DailyDigestCard;
