import * as React from "react";
import { Link } from "react-router-dom";
import type { StudyGuideCandidate } from "@/api/studyGuideDocuments";
import { validateCandidateEdit, type CandidateEdit } from "../studyGuideDocumentSchema";
import { formatSourceLocation } from "../studyGuideSections";

interface StudyGuideCandidateCardProps {
  candidate: StudyGuideCandidate;
  /** Running question number across the document (for labels). */
  number: number;
  /** Fallback location when the candidate has no page (e.g. the section label). */
  sectionLabel: string;
  included: boolean;
  edit?: CandidateEdit;
  onToggle: (candidateId: string) => void;
  onSaveEdit: (candidateId: string, edit: CandidateEdit) => void;
  disabled?: boolean;
  /** Not saved, but its section was auto-saved: the question is already among the user's items (or was skipped). */
  alreadyHandled?: boolean;
}

function toEdit(candidate: StudyGuideCandidate, edit?: CandidateEdit): CandidateEdit {
  return (
    edit ?? {
      question: candidate.question,
      correctAnswer: candidate.correctAnswer,
      incorrectAnswers: [...candidate.incorrectAnswers],
      explanation: candidate.explanation ?? "",
    }
  );
}

export function StudyGuideCandidateCard({
  candidate,
  number,
  sectionLabel,
  included,
  edit,
  onToggle,
  onSaveEdit,
  disabled = false,
  alreadyHandled = false,
}: StudyGuideCandidateCardProps) {
  const [draft, setDraft] = React.useState<CandidateEdit | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const shown = toEdit(candidate, edit);
  const idPrefix = `candidate-${candidate.id}`;

  const startEditing = () => {
    setDraft(toEdit(candidate, edit));
    setError(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const normalized: CandidateEdit = {
      question: draft.question.trim(),
      correctAnswer: draft.correctAnswer.trim(),
      incorrectAnswers: draft.incorrectAnswers.map((answer) => answer.trim()),
      explanation: draft.explanation.trim(),
    };
    const validationError = validateCandidateEdit(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSaveEdit(candidate.id, normalized);
    setDraft(null);
    setError(null);
  };

  const updateWrongAnswer = (index: number, value: string) => {
    setDraft((current) =>
      current
        ? { ...current, incorrectAnswers: current.incorrectAnswers.map((answer, i) => (i === index ? value : answer)) }
        : current
    );
  };

  return (
    <li className="rounded-lg border border-gray-200 bg-surface p-4 shadow-sm" data-testid={`candidate-${candidate.id}`}>
      <div className="flex items-start gap-3">
        {candidate.accepted ? (
          <span className="mt-0.5 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">
            Saved
          </span>
        ) : alreadyHandled ? (
          <span className="mt-0.5 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
            Already in your items
          </span>
        ) : (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={included}
            disabled={disabled}
            onChange={() => onToggle(candidate.id)}
            aria-label={`Include question ${number}`}
          />
        )}

        {draft ? (
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <label htmlFor={`${idPrefix}-question`} className="block text-xs font-medium text-gray-700 mb-1">
                Question {number}
              </label>
              <textarea
                id={`${idPrefix}-question`}
                rows={2}
                value={draft.question}
                onChange={(event) => setDraft({ ...draft, question: event.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label htmlFor={`${idPrefix}-correct`} className="block text-xs font-medium text-gray-700 mb-1">
                Correct answer
              </label>
              <input
                id={`${idPrefix}-correct`}
                type="text"
                value={draft.correctAnswer}
                onChange={(event) => setDraft({ ...draft, correctAnswer: event.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            {draft.incorrectAnswers.map((answer, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`${idPrefix}-wrong-${index}`}
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    Wrong answer {index + 1}
                  </label>
                  <input
                    id={`${idPrefix}-wrong-${index}`}
                    type="text"
                    value={answer}
                    onChange={(event) => updateWrongAnswer(index, event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
                  />
                </div>
                {draft.incorrectAnswers.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        incorrectAnswers: draft.incorrectAnswers.filter((_, i) => i !== index),
                      })
                    }
                    className="rounded-md border border-gray-300 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
                    aria-label={`Remove wrong answer ${index + 1}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {draft.incorrectAnswers.length < 4 && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, incorrectAnswers: [...draft.incorrectAnswers, ""] })}
                className="text-xs font-medium text-indigo-ink hover:text-indigo-ink"
              >
                Add wrong answer
              </button>
            )}
            <div>
              <label htmlFor={`${idPrefix}-explanation`} className="block text-xs font-medium text-gray-700 mb-1">
                Explanation
              </label>
              <textarea
                id={`${idPrefix}-explanation`}
                rows={2}
                value={draft.explanation}
                onChange={(event) => setDraft({ ...draft, explanation: event.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveDraft}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
                className="rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium text-gray-900">
              {number}. {shown.question}
              {edit && <span className="ml-2 text-xs font-normal text-indigo-ink">(edited)</span>}
            </p>
            <ul className="space-y-1 text-sm">
              <li className="text-green-700">
                <span className="sr-only">Correct answer: </span>✓ {shown.correctAnswer}
              </li>
              {shown.incorrectAnswers.map((answer, answerIndex) => (
                <li key={answerIndex} className="text-gray-600">
                  <span className="sr-only">Wrong answer: </span>✗ {answer}
                </li>
              ))}
            </ul>
            {shown.explanation && <p className="text-xs text-gray-500">{shown.explanation}</p>}
            {candidate.sourceQuote && (
              <blockquote className="border-l-2 border-indigo-200 pl-3 text-xs italic text-gray-600">
                From your guide, {formatSourceLocation(candidate, sectionLabel)}: “{candidate.sourceQuote}”
              </blockquote>
            )}
            {!candidate.accepted && !alreadyHandled && (
              <button
                type="button"
                onClick={startEditing}
                disabled={disabled}
                className="inline-flex min-h-11 items-center text-xs font-medium text-indigo-ink hover:text-indigo-ink disabled:opacity-50"
                aria-label={`Edit question ${number}`}
              >
                Edit
              </button>
            )}
            {candidate.accepted && candidate.itemId && (
              <Link
                to={`/items/${candidate.itemId}/edit`}
                className="inline-flex min-h-11 items-center text-xs font-medium text-indigo-ink hover:text-indigo-ink"
                aria-label={`Edit saved question ${number}`}
              >
                Edit
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
