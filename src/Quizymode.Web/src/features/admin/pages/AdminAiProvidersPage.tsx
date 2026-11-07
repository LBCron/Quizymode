import * as React from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  LLM_VENDORS,
  adminLlmProvidersApi,
  type LlmProvidersResponse,
  type LlmVendor,
} from "@/api/adminLlmProviders";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { readApiError } from "@/features/studyGuide/studyGuideApiErrors";
import LlmUsagePanel from "../components/LlmUsagePanel";
import {
  formatAttemptOutcome,
  moveItem,
  routeHasKeyedVendor,
  validateAiProvidersForm,
  type AiProvidersForm,
} from "../aiProvidersSchema";

const ATTEMPT_RANGES = [1, 7, 30];

function toForm(data: LlmProvidersResponse): AiProvidersForm {
  return {
    vendors: LLM_VENDORS.map((vendor) => ({
      vendor,
      model: data.vendors.find((entry) => entry.vendor === vendor)?.model ?? "",
    })),
    routes: { free: [...data.routes.free], premium: [...data.routes.premium] },
  };
}

interface RouteEditorProps {
  routeName: "free" | "premium";
  label: string;
  route: LlmVendor[];
  /** The route as last saved; the no-key alert follows this, not unsaved edits. */
  savedRoute: LlmVendor[];
  keyConfigured: Record<string, boolean>;
  onChange: (route: LlmVendor[]) => void;
}

function RouteEditor({ routeName, label, route, savedRoute, keyConfigured, onChange }: RouteEditorProps) {
  const [vendorToAdd, setVendorToAdd] = React.useState<LlmVendor | "">("");
  const available = LLM_VENDORS.filter((vendor) => !route.includes(vendor));
  const headingId = `route-${routeName}-heading`;
  const addId = `route-${routeName}-add`;

  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border border-gray-200 p-4">
      <h3 id={headingId} className="text-sm font-semibold text-gray-900">
        {label}
      </h3>
      <p className="mb-2 text-xs text-gray-500">Tried in order; vendors without a key are skipped.</p>
      {savedRoute.length > 0 && !routeHasKeyedVendor(savedRoute, keyConfigured) && (
        <p role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          No vendor in this route has a key; generation for {routeName} users is off.
        </p>
      )}
      <ol className="space-y-2">
        {route.map((vendor, index) => (
          <li key={vendor} className="flex flex-wrap items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
            <span className="w-5 text-gray-500">{index + 1}.</span>
            <span className="min-w-32 flex-1 font-medium text-gray-900">
              {vendor}
              {!keyConfigured[vendor] && <span className="ml-2 text-xs font-normal text-amber-700">(no key, skipped)</span>}
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => onChange(moveItem(route, index, -1))}
                disabled={index === 0}
                aria-label={`Move ${vendor} up in ${label}`}
                className="rounded border border-gray-300 bg-surface px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              >
                Up
              </button>
              <button
                type="button"
                onClick={() => onChange(moveItem(route, index, 1))}
                disabled={index === route.length - 1}
                aria-label={`Move ${vendor} down in ${label}`}
                className="rounded border border-gray-300 bg-surface px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              >
                Down
              </button>
              <button
                type="button"
                onClick={() => onChange(route.filter((entry) => entry !== vendor))}
                aria-label={`Remove ${vendor} from ${label}`}
                className="rounded border border-gray-300 bg-surface px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
        {route.length === 0 && <li className="text-sm text-red-700">No vendors in this route.</li>}
      </ol>
      {available.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={addId} className="block text-xs font-medium text-gray-700 mb-1">
              Add vendor to {label}
            </label>
            <select
              id={addId}
              value={vendorToAdd}
              onChange={(event) => setVendorToAdd(event.target.value as LlmVendor | "")}
              className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-sm"
            >
              <option value="">Choose…</option>
              {available.map((vendor) => (
                <option key={vendor} value={vendor}>
                  {vendor}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!vendorToAdd}
            onClick={() => {
              if (!vendorToAdd) return;
              onChange([...route, vendorToAdd]);
              setVendorToAdd("");
            }}
            className="rounded-md border border-gray-300 bg-surface px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

interface ProvidersFormProps {
  data: LlmProvidersResponse;
}

/** Form state is initialised once from the loaded settings; a save stores the server response. */
function ProvidersForm({ data }: ProvidersFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<AiProvidersForm>(() => toForm(data));
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [now, setNow] = React.useState(Date.now);
  const keyConfigured = Object.fromEntries(data.vendors.map((entry) => [entry.vendor, entry.keyConfigured]));
  const coolingDownUntil = Object.fromEntries(data.vendors.map((entry) => [entry.vendor, entry.coolingDownUntilUtc ?? null]));

  React.useEffect(() => {
    const currentTime = Date.now();
    const deadlines = data.vendors
      .map((entry) => Date.parse(entry.coolingDownUntilUtc ?? ""))
      .filter((deadline) => deadline > now);
    if (deadlines.length === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...deadlines) - currentTime));
    return () => window.clearTimeout(timer);
  }, [data.vendors, now]);

  const saveMutation = useMutation({
    mutationFn: (request: AiProvidersForm) =>
      adminLlmProvidersApi.update({
        vendors: request.vendors.map((entry) => ({ vendor: entry.vendor, model: entry.model.trim() })),
        routes: request.routes,
      }),
    onSuccess: (response) => {
      setSaved(true);
      queryClient.setQueryData(["admin", "llm-providers"], response);
    },
    onError: (error) => setFormError(readApiError(error, "Failed to save AI provider settings.").message),
  });

  const update = (next: AiProvidersForm) => {
    setForm(next);
    setSaved(false);
    setFormError(null);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateAiProvidersForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    saveMutation.mutate(form);
  };

  const budgetPercent =
    data.monthlySectionBudget > 0 ? Math.min(100, Math.round((data.monthlySectionsUsed / data.monthlySectionBudget) * 100)) : 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <section className="rounded-lg bg-surface p-5 shadow">
        <h2 className="text-base font-semibold text-gray-900">Monthly section budget</h2>
        <p className="mt-1 text-sm text-gray-600">
          {data.monthlySectionsUsed.toLocaleString()} of {data.monthlySectionBudget.toLocaleString()} sections generated
          this month (site-wide). Generation pauses when the budget is reached.
        </p>
        <div
          className="mt-3 h-2 w-full rounded-full bg-gray-200"
          role="progressbar"
          aria-label="Monthly section budget used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={budgetPercent}
        >
          <div
            className={`h-2 rounded-full ${budgetPercent >= 90 ? "bg-red-600" : budgetPercent >= 75 ? "bg-orange-500" : "bg-green-600"}`}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>
      </section>

      <section className="rounded-lg bg-surface p-5 shadow">
        <h2 className="text-base font-semibold text-gray-900">Vendors</h2>
        <p className="mt-1 text-sm text-gray-600">API keys come from server configuration only and are never shown here.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Vendor</th>
                <th className="py-2 pr-4">API key</th>
                <th className="py-2">Model</th>
              </tr>
            </thead>
            <tbody>
              {form.vendors.map((entry, index) => {
                const inputId = `llm-model-${entry.vendor}`;
                return (
                  <tr key={entry.vendor} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium text-gray-900">{entry.vendor}</td>
                    <td className="py-2 pr-4">
                      {keyConfigured[entry.vendor] ? (
                        <span className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">
                          Key configured
                        </span>
                      ) : (
                        <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                          No key
                        </span>
                      )}
                      {coolingDownUntil[entry.vendor] && Date.parse(coolingDownUntil[entry.vendor]!) > now && (
                        <span className="mt-1 block text-xs font-medium text-amber-700">
                          Cooling down until {new Date(coolingDownUntil[entry.vendor]!).toLocaleTimeString()}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <label htmlFor={inputId} className="sr-only">
                        Model for {entry.vendor}
                      </label>
                      <input
                        id={inputId}
                        type="text"
                        value={entry.model}
                        maxLength={100}
                        onChange={(event) =>
                          update({
                            ...form,
                            vendors: form.vendors.map((vendorEntry, i) =>
                              i === index ? { ...vendorEntry, model: event.target.value } : vendorEntry
                            ),
                          })
                        }
                        className="w-full min-w-36 rounded-md sm:min-w-48 border border-gray-300 px-3 py-1.5 font-mono text-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg bg-surface p-5 shadow">
        <h2 className="text-base font-semibold text-gray-900">Routing</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <RouteEditor
            routeName="free"
            label="Free route"
            route={form.routes.free}
            savedRoute={data.routes.free}
            keyConfigured={keyConfigured}
            onChange={(route) => update({ ...form, routes: { ...form.routes, free: route } })}
          />
          <RouteEditor
            routeName="premium"
            label="Premium route"
            route={form.routes.premium}
            savedRoute={data.routes.premium}
            keyConfigured={keyConfigured}
            onChange={(route) => update({ ...form, routes: { ...form.routes, premium: route } })}
          />
        </div>
      </section>

      {formError && <ErrorMessage message={formError} />}
      {saved && (
        <p className="text-sm text-emerald-700" role="status">
          AI provider settings saved.
        </p>
      )}
      <button
        type="submit"
        disabled={saveMutation.isPending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {saveMutation.isPending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

function AttemptsTable() {
  const [days, setDays] = React.useState(7);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "llm-providers", "attempts", days],
    queryFn: () => adminLlmProvidersApi.getAttempts(days),
  });

  return (
    <section className="rounded-lg bg-surface p-5 shadow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Recent attempts</h2>
        <div>
          <label htmlFor="llm-attempts-days" className="mr-2 text-sm text-gray-600">
            Window
          </label>
          <select
            id="llm-attempts-days"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-sm"
          >
            {ATTEMPT_RANGES.map((range) => (
              <option key={range} value={range}>
                {range === 1 ? "Last day" : `Last ${range} days`}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isLoading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="mt-3">
          <ErrorMessage message="Failed to load attempts" onRetry={() => void refetch()} />
        </div>
      ) : (data?.attempts ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">No vendor calls in this window.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Vendor</th>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">Outcome</th>
                <th className="py-2 pr-4 text-right">HTTP</th>
                <th className="py-2 pr-4 text-right">Tokens in / out</th>
                <th className="py-2 text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {(data?.attempts ?? []).map((attempt, index) => (
                <tr key={`${attempt.createdUtc}-${index}`} className="border-t border-gray-100">
                  <td className="py-1.5 pr-4 whitespace-nowrap">{new Date(attempt.createdUtc).toLocaleString()}</td>
                  <td className="py-1.5 pr-4">{attempt.vendor}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{attempt.model}</td>
                  <td
                    className={`py-1.5 pr-4 whitespace-nowrap ${attempt.outcome === "Success" ? "text-green-700" : "text-red-700"}`}
                  >
                    {formatAttemptOutcome(attempt.outcome)}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{attempt.httpStatus ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {attempt.inputTokens ?? "—"} / {attempt.outputTokens ?? "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{attempt.durationMs.toLocaleString()} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const AdminAiProvidersPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin", "llm-providers"],
    queryFn: () => adminLlmProvidersApi.get(),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: (query) =>
      query.state.data?.vendors.some((vendor) => vendor.coolingDownUntilUtc) ? 15_000 : false,
  });

  if (!isAuthenticated || !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="px-4 py-6 sm:px-0 space-y-6">
      <div>
        <Link to="/admin" className="text-sm font-medium text-indigo-ink hover:text-indigo-ink">
          ← Admin
        </Link>
        <h1 className="mt-1 text-3xl font-bold text-gray-900">AI providers</h1>
        <p className="text-sm text-gray-600">
          Choose the model per vendor and the order vendors are tried for free and premium study guide generation.
        </p>
      </div>
      {isLoading ? (
        <LoadingSpinner />
      ) : !data ? (
        <ErrorMessage message="Failed to load AI provider settings" onRetry={() => void refetch()} />
      ) : (
        <ProvidersForm data={data} />
      )}
      {isAuthenticated && isAdmin && !isLoading && <AttemptsTable />}
      {isAuthenticated && isAdmin && !isLoading && <LlmUsagePanel />}
    </div>
  );
};

export default AdminAiProvidersPage;
