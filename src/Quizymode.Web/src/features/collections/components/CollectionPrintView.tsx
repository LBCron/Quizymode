import type { ExportableItem } from "../utils/exportFormats";
import { QuestionImage } from "@/components/study/QuestionImage";

interface CollectionPrintViewProps {
  title: string;
  collectionId?: string;
  items: readonly ExportableItem[];
  /** Worksheet mode: show a blank answer line instead of the answer and explanation. */
  hideAnswers: boolean;
}

/** Hidden on screen; shown only when printing (Tailwind `print:` utilities). */
export const CollectionPrintView = ({ title, items, hideAnswers, collectionId }: CollectionPrintViewProps) => (
  <section data-testid="collection-print-view" className="hidden text-black print:block">
    <h1 className="mb-4 text-2xl font-bold">{title}</h1>
    <ol className="list-decimal space-y-4 pl-6">
      {items.map((item, index) => (
        <li key={index} className="break-inside-avoid">
          <p className="font-medium">{item.question}</p>
          {item.questionImage && <QuestionImage collectionId={collectionId} itemId={item.id} image={item.questionImage} showEnlarge={false} />}
          {hideAnswers ? (
            <p className="mt-2 border-b border-black pb-4">Answer:</p>
          ) : (
            <>
              <p>
                <span className="font-semibold">Answer:</span> {item.correctAnswer}
              </p>
              {item.explanation && item.explanation.trim() !== "" && (
                <p className="text-sm">
                  <span className="font-semibold">Explanation:</span> {item.explanation}
                </p>
              )}
              {item.explanationImage && <QuestionImage collectionId={collectionId} itemId={item.id} image={item.explanationImage} slot="explanation" showEnlarge={false} />}
            </>
          )}
        </li>
      ))}
    </ol>
  </section>
);
