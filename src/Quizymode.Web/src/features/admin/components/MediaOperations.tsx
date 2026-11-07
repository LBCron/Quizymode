import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { QuestionImage } from "@/components/study/QuestionImage";
interface Controls { uploadsEnabled: boolean; deliveryEnabled: boolean; advisoryEnabled: boolean }
interface Report { id: string; itemId: string; assetId: string; revision: number; slot: "question" | "explanation"; category: string; createdAt: string }
interface Job { state: string; model: string; policyVersion: string; resultJson?: string; failureCode?: string }
export function PictureAdvisory({ itemId, revision }: { itemId: string; revision: number }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient(); const key = ["picture-advisory", itemId, revision];
  const result = useQuery({ queryKey: key, enabled: open, queryFn: async () => (await apiClient.get<Job | null>(`/admin/items/${itemId}/image-advisory`)).data, retry: false });
  const assess = useMutation({ mutationFn: async () => apiClient.post(`/admin/items/${itemId}/image-advisory`, { expectedRevision: revision }), onSuccess: () => { void client.invalidateQueries({ queryKey: key }); } });
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded border p-3 text-sm"><summary>Optional AI assistance</summary><p>Advisory only. It can miss harmful content and flag harmless educational diagrams. Human review is always required. Requesting assistance uses the configured provider and allowance.</p>
    <button type="button" disabled={assess.isPending} onClick={() => assess.mutate()}>Request assistance</button> <button type="button" onClick={() => void result.refetch()}>Refresh saved result</button>
    {assess.isError && <p role="status">Assistance unavailable, disabled, stale or at its allowance. Continue manual review.</p>}
    {result.data && <div role="status"><p>{result.data.state} · {result.data.model} · {result.data.policyVersion}</p>{result.data.resultJson && <p className="whitespace-pre-wrap break-words">{result.data.resultJson}</p>}</div>}
  </details>;
}
export function MediaOperations() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient(); const [message, setMessage] = useState("");
  const controls = useQuery({ queryKey: ["media-controls"], enabled: open, queryFn: async () => (await apiClient.get<Controls>("/admin/media/controls")).data });
  const reports = useQuery({ queryKey: ["media-reports"], enabled: open, queryFn: async () => (await apiClient.get<Report[]>("/admin/media/reports")).data });
  const update = useMutation({ mutationFn: async (value: Controls) => apiClient.put("/admin/media/controls", value), onSuccess: () => { void client.invalidateQueries({ queryKey: ["media-controls"] }); setMessage("Picture controls saved. Withdrawal remains available."); }, onError: () => setMessage("Could not save controls. Retry.") });
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="mb-5 space-y-3 rounded border p-3"><summary>Picture reports and emergency controls</summary>
    <p>Disabling uploads or assistance does not disable reports or withdrawal. Disabling delivery hides uploaded pictures, including author previews.</p>
    {controls.data && <fieldset disabled={update.isPending}>{(["uploadsEnabled", "deliveryEnabled", "advisoryEnabled"] as const).map(field => <label key={field} className="block"><input type="checkbox" checked={controls.data[field]} onChange={e => update.mutate({ ...controls.data!, [field]: e.target.checked })} /> {field === "uploadsEnabled" ? "Allow uploads" : field === "deliveryEnabled" ? "Allow picture delivery" : "Allow optional AI assistance (also requires server privacy configuration)"}</label>)}</fieldset>}
    <p role="status">{message}</p><h3 className="font-semibold">Reports awaiting review</h3>
    {reports.isLoading ? <p>Loading reports…</p> : reports.isError ? <button onClick={() => void reports.refetch()}>Retry reports</button> : !reports.data?.length ? <p>No picture reports awaiting review.</p> : <ul className="space-y-3">{reports.data.map(report => <li key={report.id} className="rounded border p-3"><p>{report.category} · revision {report.revision} · {report.slot}</p><QuestionImage itemId={report.itemId} image={{ key: `media:${report.assetId.replaceAll("-", "")}`, altText: "Reported picture", revision: report.revision }} slot={report.slot} showEnlarge />
    <button type="button" onClick={async () => { if (!window.confirm("Withdraw this asset from EVERY referring item? Copies already downloaded cannot be recalled.")) return; try { await apiClient.post(`/admin/media/${report.assetId}/withdraw`, { itemId: report.itemId, expectedRevision: report.revision, category: report.category }); setMessage("Picture withdrawn from all referring items."); void reports.refetch(); void client.invalidateQueries({ queryKey: ["admin", "image-review-queue"] }); } catch { setMessage("Picture changed or withdrawal failed. Reload reports and retry; no stale decision was applied."); } }}>Withdraw picture everywhere</button> <button type="button" onClick={async () => { try { await apiClient.post(`/admin/media/reports/${report.id}/dismiss`); setMessage("Report reviewed; no withdrawal applied."); void reports.refetch(); } catch { setMessage("Could not resolve report. Reload and retry."); } }}>Reviewed: no withdrawal</button></li>)}</ul>}
  </details>;
}
