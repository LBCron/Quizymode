import { useEffect, useId, useRef, useState } from "react";
import { mediaApi, mediaUploadErrorMessage, type ImageSlotInput } from "@/api/media";

interface Props { label: string; value?: ImageSlotInput; onChange: (value: ImageSlotInput | undefined) => void; onBusy: (busy: boolean) => void }
export function ImageSlotEditor({ label, value, onChange, onBusy }: Props) {
  const id = useId();
  const [preview, setPreview] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const request = useRef<AbortController | null>(null);
  const retryFile = useRef<{ file: File; key: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef(value); latest.current = value;
  const callbacks = useRef({ onChange, onBusy }); callbacks.current = { onChange, onBusy };
  useEffect(() => () => { request.current?.abort(); callbacks.current.onBusy(false); }, []);
  useEffect(() => {
    if (!value?.assetId) return;
    const abort = new AbortController(); let url: string | undefined;
    mediaApi.preview(value.assetId, abort.signal).then(blob => { if (!abort.signal.aborted) { url = URL.createObjectURL(blob); setPreview(url); } }).catch(() => { if (!abort.signal.aborted) setMessage("Preview unavailable. Retry the picture upload if needed."); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); setPreview(undefined); };
  }, [value?.assetId]);
  const upload = async (file: File, key: string) => {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setBusy(true); onBusy(true); setMessage("Optimizing picture…"); retryFile.current = { file, key };
    try {
      const asset = await mediaApi.upload(file, key, abort.signal);
      if (abort.signal.aborted) return;
      callbacks.current.onChange({ ...latest.current, remove: undefined, assetId: asset.id, altText: latest.current?.altText ?? "" });
      retryFile.current = null; setMessage(`Ready: ${asset.width} × ${asset.height}, ${Math.ceil(asset.bytes / 1024)} KiB. Human review is required before sharing.`);
    } catch (error) {
      if (abort.signal.aborted) return;
      setMessage(mediaUploadErrorMessage(error));
    } finally { if (request.current === abort) { setBusy(false); onBusy(retryFile.current !== null); } }
  };
  return <fieldset className="space-y-2 rounded border border-gray-200 p-3">
    <legend>{label} (optional)</legend>
    <p className="text-xs text-gray-600">JPEG, PNG or still WebP, up to 2 MiB. We optimize pictures and remove metadata. Do not include student or personal information. <a href="https://github.com/yanis-kr/Quizymode/blob/main/docs/picture-policy.md" className="underline">Picture policy</a></p>
    <label className="block text-sm"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} /> I own this picture or have permission to use it.</label>
    <label htmlFor={`${id}-file`} className="block text-sm">{value?.assetId && !value.remove ? "Replace" : "Add picture"}<span className="sr-only"> ({label.toLowerCase()})</span></label>
    <input ref={picker} id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp" disabled={!rights || busy} onChange={e => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { setMessage("Picture exceeds 2 MiB. Choose a smaller file."); return; }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setMessage("Choose a JPEG, PNG or still WebP picture."); return; }
      void upload(file, crypto.randomUUID());
    }} />
    {preview && value?.assetId && <img src={preview} alt="Optimized picture preview" className="max-h-48 w-full bg-slate-100 object-contain" />}
    {value?.assetId && !value.remove && <>
      <label className="block text-sm" htmlFor={`${id}-alt`}>Short description (required, avoid answer hints)</label>
      <p id={`${id}-alt-help`} className="text-xs text-gray-600">Describe the visible evidence, such as colors, pattern and labels, without giving the answer. Do not name the country or the thing being identified.</p>
      <input id={`${id}-alt`} aria-describedby={`${id}-alt-help`} required maxLength={300} value={value.altText ?? ""} onChange={e => onChange({ ...value, altText: e.target.value })} className="w-full rounded border p-2" />
      <label className="block text-sm" htmlFor={`${id}-long`}>Long description (optional, up to 2000 characters)</label>
      <textarea id={`${id}-long`} maxLength={2000} value={value.longDescription ?? ""} onChange={e => onChange({ ...value, longDescription: e.target.value })} className="w-full rounded border p-2" />
      <label className="block text-sm" htmlFor={`${id}-credit`}>Attribution (optional)</label>
      <input id={`${id}-credit`} maxLength={300} value={value.attribution ?? ""} onChange={e => onChange({ ...value, attribution: e.target.value })} className="w-full rounded border p-2" />
      <button type="button" onClick={() => { if (window.confirm(`Remove ${label.toLowerCase()}? This will take effect when you save.`)) { onChange({ remove: true }); picker.current?.focus(); } }}>Remove picture</button>
    </>}
    <p role="status" className="text-sm">{message}</p>
    {(busy || retryFile.current !== null) && <button type="button" onClick={() => { request.current?.abort(); retryFile.current = null; setBusy(false); onBusy(false); setMessage("Upload cancelled. Existing picture kept."); picker.current?.focus(); }}>Cancel upload</button>}
    {!busy && retryFile.current && <button type="button" onClick={() => { const retry = retryFile.current; if (retry) void upload(retry.file, retry.key); }}>Retry upload</button>}
  </fieldset>;
}
