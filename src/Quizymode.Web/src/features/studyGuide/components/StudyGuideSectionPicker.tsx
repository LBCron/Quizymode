import * as React from "react";
import type { StudyGuideQuota, StudyGuideSection } from "@/api/studyGuideDocuments";
import { formatBytes } from "../studyGuideDocumentSchema";
import { MAX_SECTIONS_PER_GENERATE, getSectionChip, isSectionSelectable } from "../studyGuideSections";

export type QuestionStyle = "Recall" | "ClinicalScenario";

interface StudyGuideSectionPickerProps {
  sections: StudyGuideSection[];
  quota: StudyGuideQuota;
  selection: Set<string>;
  onToggle: (sectionId: string) => void;
  onGenerate: (questionStyle: QuestionStyle) => void;
  isGenerating: boolean;
}

export function StudyGuideSectionPicker({
  sections,
  quota,
  selection,
  onToggle,
  onGenerate,
  isGenerating,
}: StudyGuideSectionPickerProps) {
  const [questionStyle, setQuestionStyle] = React.useState<QuestionStyle>("Recall");
  const selectedCount = selection.size;
  const overQuota = selectedCount > quota.remainingToday;
  const overBatch = selectedCount > MAX_SECTIONS_PER_GENERATE;
  const generateDisabled = selectedCount === 0 || overQuota || overBatch || isGenerating;
  const sorted = [...sections].sort((a, b) => a.index - b.index);

  return (
    <section aria-labelledby="study-guide-picker-heading" className="rounded-lg bg-surface p-4 shadow space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="study-guide-picker-heading" className="text-lg font-semibold text-gray-900">
            Choose sections
          </h2>
          <p className="text-sm text-gray-600">
            Each section is a few pages. Generating one section uses one from your allowance; sections that were
            already generated from the same text are free.
          </p>
        </div>
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            overQuota ? "border-red-300 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
          aria-live="polite"
          data-testid="study-guide-quota-counter"
        >
          <div className="font-medium">
            {quota.dailyUsed + selectedCount} of {quota.dailyLimit} sections today
          </div>
          <div className="text-xs">
            {quota.monthlyUsed + selectedCount} of {quota.monthlyLimit} this month · {quota.tier} plan
          </div>
        </div>
      </div>

      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {sorted.map((section) => {
          const chip = getSectionChip(section);
          const selectable = isSectionSelectable(section);
          const checkboxId = `study-guide-section-${section.id}`;
          return (
            <li key={section.id} className="flex items-start gap-3 p-3">
              <input
                id={checkboxId}
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={selection.has(section.id)}
                disabled={!selectable || isGenerating}
                onChange={() => onToggle(section.id)}
                aria-describedby={`${checkboxId}-status`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={checkboxId} className="text-sm font-medium text-gray-900">
                    {section.label}
                  </label>
                  <span
                    id={`${checkboxId}-status`}
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${chip.className}`}
                  >
                    {chip.label}
                  </span>
                  <span className="text-xs text-gray-500">{formatBytes(section.sizeBytes)}</span>
                </div>
                {section.preview ? (
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600">{section.preview}</p>
                ) : section.textExpired ? (
                  <p className="mt-1 text-xs text-gray-500">The text of this section is no longer kept.</p>
                ) : null}
                {section.status === "Failed" && section.error && (
                  <p className="mt-1 text-xs text-red-700">{section.error}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-900">Question style</legend>
        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="study-guide-question-style"
              value="Recall"
              checked={questionStyle === "Recall"}
              disabled={isGenerating}
              onChange={() => setQuestionStyle("Recall")}
            />
            Recall (facts from the text)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="study-guide-question-style"
              value="ClinicalScenario"
              checked={questionStyle === "ClinicalScenario"}
              disabled={isGenerating}
              onChange={() => setQuestionStyle("ClinicalScenario")}
            />
            Clinical scenario (priority and first-action questions)
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onGenerate(questionStyle)}
          disabled={generateDisabled}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isGenerating
            ? "Starting…"
            : `Generate ${selectedCount} section${selectedCount === 1 ? "" : "s"}`}
        </button>
        <span className="text-sm text-gray-600">
          {quota.remainingToday} section{quota.remainingToday === 1 ? "" : "s"} left today
        </span>
        {overQuota && (
          <span className="text-sm font-medium text-red-700" role="alert">
            You selected more sections than you have left today. Unselect {selectedCount - quota.remainingToday}.
          </span>
        )}
        {!overQuota && overBatch && (
          <span className="text-sm font-medium text-red-700" role="alert">
            Select at most {MAX_SECTIONS_PER_GENERATE} sections at a time.
          </span>
        )}
      </div>
    </section>
  );
}
