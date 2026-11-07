import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "@/api/client";
import { useFocusTrap } from "@/hooks/useFocusTrap";
const categories = ["sexual", "violence", "hate", "harassment", "privacy", "rights", "misleading", "other"];
export function PictureReportButton({ itemId, slot, revision, collectionId }: { itemId: string; slot: string; revision: number; collectionId?: string }) {
  const [open, setOpen] = useState(false); const [category, setCategory] = useState("privacy"); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null); const dialog = useRef<HTMLDivElement>(null); const id = useId();
  useFocusTrap(dialog);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <><button ref={button} type="button" className="mt-2 text-xs underline print:hidden" aria-haspopup="dialog" onClick={() => { setMessage(""); setOpen(true); }}>Report picture</button>
    {open && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="w-full max-w-md space-y-4 rounded bg-surface p-5 text-gray-900">
        <h2 id={`${id}-title`} className="text-lg font-semibold">Report picture</h2><p className="text-sm">Choose the concern. Reports go to a human reviewer and do not automatically remove the picture. No contact information is needed.</p>
        <label htmlFor={`${id}-category`}>Concern</label><select autoFocus id={`${id}-category`} value={category} onChange={e => setCategory(e.target.value)} className="w-full rounded border p-2">{categories.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <p role="status">{message}</p>
        <div className="flex gap-3"><button type="button" onClick={close}>Close</button><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await apiClient.post(`/items/${itemId}/image-reports`, { slot, category, expectedRevision: revision, collectionId }); setMessage("Report received. A human reviewer will check it."); } catch { setMessage("Report could not be sent. The picture may have changed or the report allowance was reached. Reload and retry later."); } finally { setBusy(false); } }}>Send report</button></div>
      </div>
    </div>, document.body)}
  </>;
}
