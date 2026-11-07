import * as React from "react";
import {
  DEFAULT_PARSE_OPTIONS,
  buildImportItems,
  parseTermPairs,
  type ImportDirection,
  type ImportItem,
  type SeparatorKind,
} from "../utils/importParser";
import { CLOZE_AI_HELPER_PROMPT, parseCloze } from "@/features/items/utils/clozeParser";

interface PasteTextImportProps {
  /** Upload limit for this user (100 for regular users, 1000 for admins). */
  maxItems: number;
  isPending: boolean;
  /** Called with the previewed items and a stable text used for duplicate-upload detection. */
  onImport: (items: ImportItem[], inputText: string) => void;
  /** Called with the previewed items whenever the preview changes (used to suggest a topic from them). */
  onPreviewChange?: (items: ImportItem[]) => void;
}

type PasteFormat = "term-pairs" | "cloze";

const PREVIEW_ROWS = 5;
const inputClass =
  "block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm";

const PasteTextImport = ({ maxItems, isPending, onImport, onPreviewChange }: PasteTextImportProps) => {
  const [format, setFormat] = React.useState<PasteFormat>("term-pairs");
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);
  const [text, setText] = React.useState("");
  const [separator, setSeparator] = React.useState<SeparatorKind>("auto");
  const [customSeparator, setCustomSeparator] = React.useState("");
  const [quotes, setQuotes] = React.useState(true);
  const [direction, setDirection] = React.useState<ImportDirection>("term-to-definition");
  const [template, setTemplate] = React.useState("{term}");

  const clozePreview = React.useMemo(() => {
    if (format !== "cloze" || !text.trim()) return null;
    const result = parseCloze(text, { limit: maxItems });
    const items: ImportItem[] = result.drafts.map((d) => ({
      question: d.question,
      correctAnswer: d.correctAnswer,
      incorrectAnswers: d.incorrectAnswers,
      explanation: d.explanation,
    }));
    return { result, items, hasSiblings: result.drafts.some((d) => d.cardCount > 1) };
  }, [format, text, maxItems]);

  const preview = React.useMemo(() => {
    if (format !== "term-pairs" || !text.trim()) return null;
    const parsed = parseTermPairs(text, { ...DEFAULT_PARSE_OPTIONS, separator, customSeparator, quotes });
    const built = buildImportItems(parsed.pairs, { direction, template, limit: maxItems });
    return { parsed, built, skipped: [...parsed.skipped, ...built.skipped] };
  }, [format, text, separator, customSeparator, quotes, direction, template, maxItems]);

  const previewItems = format === "cloze" ? clozePreview?.items : preview?.built.items;
  React.useEffect(() => {
    onPreviewChange?.(previewItems ?? []);
  }, [previewItems, onPreviewChange]);

  const canImport =
    format === "cloze"
      ? !!clozePreview && clozePreview.items.length > 0 && !isPending
      : !!preview && !preview.built.error && preview.built.items.length > 0 && !isPending;

  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CLOZE_AI_HELPER_PROMPT);
      setCopyError(false);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-1">Format</legend>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="paste-format"
              checked={format === "term-pairs"}
              onChange={() => setFormat("term-pairs")}
              className="h-4 w-4 border-gray-300 text-indigo-ink"
            />
            Term pairs (Quizlet, Anki, CSV/TSV)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="paste-format"
              checked={format === "cloze"}
              onChange={() => setFormat("cloze")}
              className="h-4 w-4 border-gray-300 text-indigo-ink"
            />
            Cloze
          </label>
        </div>
      </fieldset>

      {format === "term-pairs" ? (
      <p className="text-xs text-gray-500">
        Paste a Quizlet export (term, tab, definition), an Anki text export, or CSV/TSV. Quizlet links and Anki .apkg
        files are not supported. Wrong answers are picked from the other answers in the same set, so at least 4 usable
        rows are needed.
      </p>
      ) : (
        <div className="space-y-2 text-xs text-gray-600">
          <p>
            One note per line. Wrap each answer in <code>{"{{c1::answer}}"}</code> or{" "}
            <code>{"{{c1::answer::hint}}"}</code>, then add 1-4 required wrong answers after <code>|</code>. Use{" "}
            <code>| c2: wrong</code> to give a wrong answer to card 2 only, and <code>{"\\|"}</code> for a literal pipe.
          </p>
          <p>
            Example: <code>{"{{c1::Paris}} is the capital of France | Lyon | Marseille"}</code>
          </p>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-surface hover:bg-gray-50"
          >
            Copy AI helper prompt
          </button>
          <span role="status" aria-live="polite" className="ml-2">
            {copied ? "Helper prompt copied to clipboard." : ""}
            {copyError ? "Could not copy automatically." : ""}
          </span>
        </div>
      )}

      <div>
        <label htmlFor="paste-text" className="block text-sm font-medium text-gray-700 mb-1">
          Pasted text
        </label>
        <textarea
          id="paste-text"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`${inputClass} font-mono`}
          placeholder={
            format === "cloze"
              ? "{{c1::Paris}} is the capital of France | Lyon | Marseille"
              : "cat\tgato\ndog\tperro\nbird\tpájaro\nfish\tpez"
          }
        />
      </div>

      {format === "term-pairs" && (
      <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="paste-separator" className="block text-sm font-medium text-gray-700 mb-1">
            Separator
          </label>
          <select
            id="paste-separator"
            value={separator}
            onChange={(e) => setSeparator(e.target.value as SeparatorKind)}
            className={inputClass}
          >
            <option value="auto">Auto-detect (tab, otherwise comma)</option>
            <option value="tab">Tab</option>
            <option value="comma">Comma</option>
            <option value="semicolon">Semicolon</option>
            <option value="pipe">Pipe |</option>
            <option value="custom">Custom text</option>
          </select>
        </div>
        {separator === "custom" && (
          <div>
            <label htmlFor="paste-custom-separator" className="block text-sm font-medium text-gray-700 mb-1">
              Custom separator
            </label>
            <input
              id="paste-custom-separator"
              type="text"
              value={customSeparator}
              onChange={(e) => setCustomSeparator(e.target.value)}
              className={inputClass}
              placeholder=" - "
            />
          </div>
        )}
        <div>
          <label htmlFor="paste-direction" className="block text-sm font-medium text-gray-700 mb-1">
            Direction
          </label>
          <select
            id="paste-direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as ImportDirection)}
            className={inputClass}
          >
            <option value="term-to-definition">Term as question, definition as answer</option>
            <option value="definition-to-term">Definition as question, term as answer</option>
          </select>
        </div>
        <div>
          <label htmlFor="paste-template" className="block text-sm font-medium text-gray-700 mb-1">
            Question template (optional)
          </label>
          <input
            id="paste-template"
            type="text"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className={inputClass}
            placeholder="Define: {term}"
          />
          <p className="mt-1 text-xs text-gray-500">{"{term}"} is replaced by the question side of each row.</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={quotes}
          onChange={(e) => setQuotes(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-ink"
        />
        Treat double quotes as field quotes (CSV)
      </label>
      </>
      )}

      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
        <h2 className="font-medium text-gray-900">Preview</h2>
        {!preview && !clozePreview && <p className="text-gray-500">Paste text above to see a preview.</p>}
        {clozePreview && (
          <div className="space-y-2">
            <p aria-live="polite">
              {clozePreview.items.length} card{clozePreview.items.length === 1 ? "" : "s"} ready
              {clozePreview.result.skipped.length > 0 &&
                `, ${clozePreview.result.skipped.length} skipped`}
              {clozePreview.result.duplicates > 0 &&
                `, ${clozePreview.result.duplicates} duplicate${clozePreview.result.duplicates === 1 ? "" : "s"} removed`}
              .
            </p>
            {clozePreview.result.truncated && (
              <p role="alert" className="text-amber-700">
                Your limit is {maxItems} items per upload, so only the first {maxItems} will be imported. Split the
                rest into another upload.
              </p>
            )}
            {clozePreview.hasSiblings && (
              <p className="text-xs text-gray-600">
                Some lines produce several cards. Cards from the same line can reveal each other&apos;s answers when
                studied together.
              </p>
            )}
            {clozePreview.items.length > 0 && (
              <ul className="space-y-2">
                {clozePreview.items.slice(0, PREVIEW_ROWS).map((item, i) => (
                  <li key={i} className="break-words rounded border border-gray-200 bg-surface p-2">
                    <div className="font-medium text-gray-900">{item.question}</div>
                    <div className="text-green-700">{item.correctAnswer}</div>
                    <div className="text-xs text-gray-500">Wrong: {item.incorrectAnswers.join(" | ")}</div>
                  </li>
                ))}
              </ul>
            )}
            {clozePreview.result.skipped.length > 0 && (
              <details open>
                <summary className="cursor-pointer text-xs text-gray-600">Skipped lines</summary>
                <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                  {clozePreview.result.skipped.slice(0, 20).map((s, i) => (
                    <li key={i}>
                      Line {s.line}
                      {s.card !== undefined && ` (card c${s.card})`}: {s.reason}
                    </li>
                  ))}
                  {clozePreview.result.skipped.length > 20 && (
                    <li>&hellip;and {clozePreview.result.skipped.length - 20} more</li>
                  )}
                </ul>
              </details>
            )}
          </div>
        )}
        {preview && (
          <div className="space-y-2">
            <p aria-live="polite">
              {preview.built.items.length} item{preview.built.items.length === 1 ? "" : "s"} ready
              {preview.skipped.length > 0 && `, ${preview.skipped.length} row${preview.skipped.length === 1 ? "" : "s"} skipped`}
              {preview.built.duplicates > 0 &&
                `, ${preview.built.duplicates} duplicate${preview.built.duplicates === 1 ? "" : "s"} removed`}
              .
            </p>
            {preview.built.error && (
              <p role="alert" className="text-red-700">
                {preview.built.error}
              </p>
            )}
            {preview.built.truncated > 0 && (
              <p role="alert" className="text-amber-700">
                Your limit is {maxItems} items per upload, so only the first {maxItems} will be imported. Split the
                rest into another upload.
              </p>
            )}
            {preview.built.items.length > 0 && (
              <ul className="space-y-2">
                {preview.built.items.slice(0, PREVIEW_ROWS).map((item, i) => (
                  <li key={i} className="break-words rounded border border-gray-200 bg-surface p-2">
                    <div className="font-medium text-gray-900">{item.question}</div>
                    <div className="text-green-700">{item.correctAnswer}</div>
                    <div className="text-xs text-gray-500">Wrong: {item.incorrectAnswers.join(" | ")}</div>
                  </li>
                ))}
              </ul>
            )}
            {preview.skipped.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-gray-600">Skipped rows</summary>
                <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                  {preview.skipped.slice(0, 20).map((s, i) => (
                    <li key={i}>
                      Row {s.row}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!canImport}
        onClick={() => {
          if (format === "cloze" && clozePreview && canImport) {
            onImport(clozePreview.items, JSON.stringify(clozePreview.items));
          } else if (format === "term-pairs" && preview && canImport) onImport(preview.built.items, JSON.stringify(preview.built.items));
        }}
        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Uploading…" : "Upload and open collection"}
      </button>
    </div>
  );
};

export default PasteTextImport;
