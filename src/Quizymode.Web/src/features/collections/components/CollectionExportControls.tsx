import { useRef, useState } from "react";
import {
  dialogPrimaryButton,
  dialogSecondaryButton,
  TestDialog,
} from "@/features/items/quiz/test/TestDialog";
import {
  downloadTextFile,
  exportFileName,
  planTextExport,
  toCsv,
  toQuizletText,
  toTsv,
  type ExportableItem,
} from "../utils/exportFormats";

interface CollectionExportControlsProps {
  items: readonly ExportableItem[];
  collectionName: string | null | undefined;
  hideAnswers: boolean;
  onPreparePrint?: () => void;
  onHideAnswersChange: (hide: boolean) => void;
}

type TextFormat = "csv" | "tsv" | "txt";
type PictureChoice = "skip" | "text-only";

const FORMATS: Record<TextFormat, { extension: string; mimeType: string; withBom: boolean; build: typeof toCsv; downloadLabel: string }> = {
  csv: { extension: "csv", mimeType: "text/csv", withBom: true, build: toCsv, downloadLabel: "Download CSV" },
  tsv: { extension: "tsv", mimeType: "text/tab-separated-values", withBom: true, build: toTsv, downloadLabel: "Download TSV" },
  txt: { extension: "txt", mimeType: "text/plain", withBom: false, build: toQuizletText, downloadLabel: "Download Quizlet text" },
};

const buttonClass =
  "inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

interface PictureExportDialogProps {
  items: readonly ExportableItem[];
  format: TextFormat;
  onCancel: () => void;
  onDownload: (choice: PictureChoice) => void;
}

/**
 * CSV, TSV and Quizlet files hold text only (#403): when some questions have a question picture the learner chooses
 * between skipping them (the default) and exporting them as text, the latter only after acknowledging the loss.
 */
function PictureExportDialog({ items, format, onCancel, onDownload }: PictureExportDialogProps) {
  const plan = planTextExport(items);
  const [choice, setChoice] = useState<PictureChoice>(plan.pictureCount === 0 ? "text-only" : "skip");
  const [acknowledged, setAcknowledged] = useState(false);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const remaining = plan.total - plan.pictureCount;
  const nothingToExport = choice === "skip" && remaining === 0;
  const blocked = nothingToExport || (choice === "text-only" && !acknowledged);

  return (
    <TestDialog
      titleId="picture-export-title"
      title="Some questions have pictures"
      initialFocusRef={firstRadioRef}
      onEscape={onCancel}
    >
      <div className="mt-3 max-h-[60vh] overflow-y-auto break-words text-sm">
        <p>
          {plan.pictureCount} of {plan.total} questions include a picture. CSV, TSV and Quizlet files can only hold text, so
          pictures can&apos;t be included.
          {plan.hasExplanationPictures && " Explanation pictures are not included either."}
        </p>
        <div role="radiogroup" aria-label="Export options" className="mt-4 space-y-3">
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
            <input
              ref={firstRadioRef}
              type="radio"
              name="picture-export-choice"
              checked={choice === "skip"}
              onChange={() => setChoice("skip")}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="font-medium text-slate-900">
                Skip {plan.pictureCount} picture {plural(plan.pictureCount, "question", "questions")}
              </span>
              <span className="block text-xs text-gray-600">
                Export the other {remaining} {plural(remaining, "question", "questions")}.
              </span>
            </span>
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="picture-export-choice"
              checked={choice === "text-only"}
              onChange={() => setChoice("text-only")}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="font-medium text-slate-900">Export text only (pictures not included)</span>
              <span className="block text-xs text-gray-600">Picture questions stay in the file without their pictures.</span>
            </span>
          </label>
        </div>
        {choice === "text-only" && (
          <label className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              I understand pictures won&apos;t be in this file, so some questions may not make sense without them.
            </span>
          </label>
        )}
        {nothingToExport && (
          <p id="picture-export-hint" role="status" className="mt-3 text-xs text-gray-600">
            Every question here has a picture, so there is nothing to export as text. Choose &quot;Export text only&quot; or
            cancel.
          </p>
        )}
        {choice === "text-only" && !acknowledged && (
          <p id="picture-export-hint" className="mt-3 text-xs text-gray-600">
            Tick the box to continue.
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={`min-h-[44px] ${dialogSecondaryButton}`}>
          Cancel
        </button>
        <button
          type="button"
          disabled={blocked}
          aria-describedby={blocked ? "picture-export-hint" : undefined}
          onClick={() => onDownload(choice)}
          className={`min-h-[44px] ${dialogPrimaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {FORMATS[format].downloadLabel}
        </button>
      </div>
    </TestDialog>
  );
}

export const CollectionExportControls = ({
  items,
  collectionName,
  hideAnswers,
  onHideAnswersChange,
  onPreparePrint,
}: CollectionExportControlsProps) => {
  const [pendingFormat, setPendingFormat] = useState<TextFormat | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const download = (format: TextFormat, exported: readonly ExportableItem[]): void => {
    const { extension, mimeType, withBom, build } = FORMATS[format];
    downloadTextFile(exportFileName(collectionName, extension), build(exported), mimeType, withBom);
  };

  const requestExport = (format: TextFormat): void => {
    setAnnouncement("");
    // No dialog without a question picture: a text export loses nothing then.
    if (planTextExport(items).pictureCount === 0 && !planTextExport(items).hasExplanationPictures) {
      download(format, items);
      return;
    }
    setPendingFormat(format);
  };

  const confirmExport = (choice: PictureChoice): void => {
    if (pendingFormat === null) return;
    const plan = planTextExport(items);
    if (choice === "skip" && plan.hasExplanationPictures && !window.confirm("Explanation pictures will be omitted from this text export. Continue?")) return;
    if (choice === "skip") {
      download(pendingFormat, plan.withoutPictureQuestions);
      setAnnouncement(
        `Downloaded ${plan.withoutPictureQuestions.length} ${plural(plan.withoutPictureQuestions.length, "question", "questions")}. ${plan.pictureCount} picture ${plural(plan.pictureCount, "question", "questions")} skipped.`,
      );
    } else {
      download(pendingFormat, items);
      setAnnouncement(`Downloaded ${items.length} ${plural(items.length, "question", "questions")} as text only.`);
    }
    setPendingFormat(null);
  };

  return (
    <section
      aria-label="Export and print"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 p-3"
    >
      <button type="button" className={buttonClass} onClick={() => requestExport("csv")}>
        Download CSV
      </button>
      <button type="button" className={buttonClass} onClick={() => requestExport("tsv")}>
        Download TSV
      </button>
      <button type="button" className={buttonClass} onClick={() => requestExport("txt")}>
        Quizlet text
      </button>
      <button type="button" className={buttonClass} onClick={async () => {
        setAnnouncement("Preparing pictures for print…");
        if (onPreparePrint) { onPreparePrint(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
        const statuses = () => Array.from(document.querySelectorAll('[data-testid="collection-print-view"] [data-picture-status]')).map(node => node.getAttribute("data-picture-status"));
        const until = Date.now() + 30000;
        while (statuses().some(status => status === "loading" || status === "stuck") && Date.now() < until) await new Promise(resolve => window.setTimeout(resolve, 100));
        if (statuses().some(status => status !== "loaded")) { setAnnouncement("Print blocked: a required picture is unavailable. Retry the picture before printing."); return; }
        setAnnouncement(""); window.print();
      }}>
        Print
      </button>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={hideAnswers}
          onChange={(e) => onHideAnswersChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
        />
        Hide answers when printing (worksheet)
      </label>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {pendingFormat !== null && (
        <PictureExportDialog
          items={items}
          format={pendingFormat}
          onCancel={() => setPendingFormat(null)}
          onDownload={confirmExport}
        />
      )}
    </section>
  );
};
