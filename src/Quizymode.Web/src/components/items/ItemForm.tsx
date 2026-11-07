/**
 * Shared form for creating and editing quiz items. Used by CreateItemPage and EditItemPage.
 */
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { ItemSpeechSupport, KeywordRequest } from "@/types/api";
import ErrorMessage from "@/components/ErrorMessage";
import {
  ItemTopicScopeFields,
  type TopicScopeFieldsHandle,
} from "@/components/items/ItemTopicScopeFields";
import { composeItemSuggestionText } from "@/features/topics/suggestionText";
import type { TopicSuggestion } from "@/api/taxonomy";
import { NAV_KEYWORD_MAX_LEN } from "@/utils/navigationKeywordRules";

import { ImageSlotEditor } from "./ImageSlotEditor";
import type { ImageSlotInput } from "@/api/media";

const EXTRA_KEYWORD_AUTOCOMPLETE_LIMIT = 10;

export interface ItemFormValues {
  questionImage?: ImageSlotInput;
  explanationImage?: ImageSlotInput;
  category: string;
  isPrivate: boolean;
  /** Navigation keyword rank 1 (from dropdown or custom private). */
  navigationRank1: string;
  /** Navigation keyword rank 2 (from dropdown or custom private). */
  navigationRank2: string;
  /** Whether the owner is requesting admin review to make the item public. */
  readyForReview: boolean;
  question: string;
  questionSpeech: ItemSpeechSupport;
  correctAnswer: string;
  correctAnswerSpeech: ItemSpeechSupport;
  incorrectAnswers: string[];
  incorrectAnswerSpeech: Record<number, ItemSpeechSupport>;
  /** Optional "why this option is wrong" text per incorrect answer index, max 200 chars (#367). */
  incorrectAnswerRationale?: Record<number, string>;
  explanation: string;
  keywords: KeywordRequest[];
  source: string;
  groupLabel: string;
}

export interface ItemFormProps {
  mode: "create" | "edit";
  questionPictureReadOnly?: boolean;
  explanationPictureReadOnly?: boolean;
  values: ItemFormValues;
  onChange: (values: ItemFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isAdmin: boolean;
  isPending: boolean;
  validationError?: string;
  submitError?: string;
  onDismissSubmitError?: () => void;
  /** Sorted unique names: item tags (per category) + taxonomy slugs; filtered by prefix in the UI (max 10). */
  extraKeywordAutocompleteSource?: string[];
  extraKeywordAutocompleteLoading?: boolean;
  /** Category taxonomy slugs (L1/L2 and shared tags). Matching extra keywords show as public in the UI. */
  taxonomyPublicSlugs?: string[];
  /** Set by the page when it blocks a submit because no complete topic is chosen (AC 12.14). */
  topicError?: string;
  /** Focus handle for the topic group, used by the page after a failed submit. */
  topicScopeRef?: Ref<TopicScopeFieldsHandle>;
  /** Create mode only: called when a set of topic chips has been shown. */
  onTopicSuggestionsShown?: (suggestions: TopicSuggestion[]) => void;
  /** Create mode only: non-blocking confirmation announced in a status region (#296). */
  statusMessage?: string;
  /** Focus handle for the Question field, used by the page after Save and add another. */
  questionRef?: Ref<HTMLTextAreaElement>;
}

/** Server messages that point at a field inside More options. */
const MORE_OPTIONS_ERROR_PATTERN =
  /\b(explanation|source|group ?label|pronunciation|language code|extra keyword|additional keyword)/i;

export function ItemForm({
  mode,
  questionPictureReadOnly,
  explanationPictureReadOnly,
  values,
  onChange,
  onSubmit,
  onCancel,
  isAdmin,
  isPending,
  validationError,
  submitError,
  onDismissSubmitError,
  extraKeywordAutocompleteSource = [],
  extraKeywordAutocompleteLoading = false,
  taxonomyPublicSlugs = [],
  topicError,
  topicScopeRef,
  onTopicSuggestionsShown,
  statusMessage,
  questionRef,
}: ItemFormProps) {
  const [questionBusy, setQuestionBusy] = useState(false);
  const [explanationBusy, setExplanationBusy] = useState(false);
  const picturesBusy = questionBusy || explanationBusy;
  const [newKeywordName, setNewKeywordName] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const keywordInputContainerRef = useRef<HTMLDivElement>(null);
  const listboxId = `${mode}-extra-keyword-listbox`;
  const moreOptionsId = `${mode}-more-options`;
  const [moreOpenChoice, setMoreOpenChoice] = useState<boolean | null>(null);

  const errorInMoreOptions =
    submitError !== undefined && MORE_OPTIONS_ERROR_PATTERN.test(submitError);
  // An error opens the panel when it appears; the user can close it afterwards.
  const [sawMoreOptionsError, setSawMoreOptionsError] = useState(false);
  if (errorInMoreOptions !== sawMoreOptionsError) {
    setSawMoreOptionsError(errorInMoreOptions);
    if (errorInMoreOptions) setMoreOpenChoice(true);
  }
  const moreOptionsHasValue =
    Boolean(values.explanationImage?.assetId) ||
    values.explanation.trim() !== "" ||
    values.source.trim() !== "" ||
    values.groupLabel.trim() !== "" ||
    values.keywords.length > 0 ||
    Boolean(values.questionSpeech.pronunciation || values.questionSpeech.languageCode) ||
    Boolean(values.correctAnswerSpeech.pronunciation || values.correctAnswerSpeech.languageCode) ||
    Object.values(values.incorrectAnswerSpeech).some((sp) => sp?.pronunciation || sp?.languageCode);
  // Closed by default; opens by itself for an error inside it, or on edit for a stored value.
  // Once the user toggles it (or an error opens it) that choice wins.
  const moreOpen = moreOpenChoice ?? (mode === "edit" && moreOptionsHasValue);

  const publicTaxonomySlugSet = useMemo(
    () => new Set(taxonomyPublicSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean)),
    [taxonomyPublicSlugs]
  );

  const r1 = values.navigationRank1.trim().toLowerCase();
  const r2 = values.navigationRank2.trim().toLowerCase();
  const prefix = newKeywordName.trim().toLowerCase();

  const matches = useMemo(() => {
    if (prefix.length === 0) return [];
    const already = new Set(values.keywords.map((k) => k.name.toLowerCase()));
    return extraKeywordAutocompleteSource
      .filter((name) => name.toLowerCase().startsWith(prefix))
      .filter((name) => {
        const n = name.toLowerCase();
        return !already.has(n) && n !== r1 && n !== r2;
      })
      .slice(0, EXTRA_KEYWORD_AUTOCOMPLETE_LIMIT);
  }, [prefix, extraKeywordAutocompleteSource, values.keywords, r1, r2]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightIndex(matches.length > 0 ? 0 : -1);
  }, [prefix, matches.length]);

  useEffect(() => {
    if (!suggestOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      if (
        keywordInputContainerRef.current &&
        !keywordInputContainerRef.current.contains(ev.target as Node)
      ) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [suggestOpen]);

  const tryAddKeyword = (raw: string) => {
    const trimmedName = raw.trim().toLowerCase();
    if (trimmedName.length === 0 || trimmedName.length > NAV_KEYWORD_MAX_LEN) return;
    if (values.keywords.some((k) => k.name.toLowerCase() === trimmedName)) return;
    const isPublicTag = publicTaxonomySlugSet.has(trimmedName);
    onChange({
      ...values,
      keywords: [...values.keywords, { name: trimmedName, isPrivate: !isPublicTag }],
    });
    setNewKeywordName("");
    setSuggestOpen(false);
    setHighlightIndex(-1);
  };

  const addKeyword = () => tryAddKeyword(newKeywordName);

  const removeKeyword = (index: number) => {
    onChange({
      ...values,
      keywords: values.keywords.filter((_, i) => i !== index),
    });
  };

  const handleIncorrectAnswerChange = (index: number, value: string) => {
    const newAnswers = [...values.incorrectAnswers];
    newAnswers[index] = value;
    onChange({ ...values, incorrectAnswers: newAnswers });
  };

  const updateSpeechSupport = (
    current: ItemSpeechSupport | undefined,
    key: keyof ItemSpeechSupport,
    value: string
  ): ItemSpeechSupport => ({
    ...(current ?? {}),
    [key]: value,
  });

  const handleIncorrectAnswerRationaleChange = (index: number, value: string) => {
    onChange({
      ...values,
      incorrectAnswerRationale: {
        ...values.incorrectAnswerRationale,
        [index]: value,
      },
    });
  };

  const handleIncorrectAnswerSpeechChange = (
    index: number,
    key: keyof ItemSpeechSupport,
    value: string
  ) => {
    onChange({
      ...values,
      incorrectAnswerSpeech: {
        ...values.incorrectAnswerSpeech,
        [index]: updateSpeechSupport(values.incorrectAnswerSpeech[index], key, value),
      },
    });
  };

  const keywordBlock = (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Additional keywords (optional; official taxonomy slugs attach as shared tags, new labels
        are private until reviewed)
      </label>
      <p className="text-xs text-gray-500 mb-2">
        Type to see up to {EXTRA_KEYWORD_AUTOCOMPLETE_LIMIT} matching tags (prefix search), or enter a
        new label (letters, numbers, hyphens; max {NAV_KEYWORD_MAX_LEN} chars).
      </p>
      {extraKeywordAutocompleteLoading && values.category.trim() !== "" && (
        <p className="text-xs text-gray-500 mb-2" aria-live="polite">
          Loading keyword suggestions for this category…
        </p>
      )}
      <div className="flex gap-2 mb-2">
        <div ref={keywordInputContainerRef} className="relative flex-1">
          <input
            type="text"
            value={newKeywordName}
            onChange={(e) => {
              setNewKeywordName(e.target.value.slice(0, NAV_KEYWORD_MAX_LEN));
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => {
              // Defer so mousedown on an option runs first
              window.setTimeout(() => setSuggestOpen(false), 120);
            }}
            placeholder={`Keyword (max ${NAV_KEYWORD_MAX_LEN} chars)`}
            maxLength={NAV_KEYWORD_MAX_LEN}
            autoComplete="off"
            role="combobox"
            aria-expanded={Boolean(suggestOpen && matches.length > 0)}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              suggestOpen && highlightIndex >= 0 && matches[highlightIndex]
                ? `${listboxId}-opt-${highlightIndex}`
                : undefined
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                if (matches.length === 0) return;
                e.preventDefault();
                setSuggestOpen(true);
                setHighlightIndex((i) =>
                  i < matches.length - 1 ? i + 1 : i >= 0 ? i : 0
                );
                return;
              }
              if (e.key === "ArrowUp") {
                if (matches.length === 0) return;
                e.preventDefault();
                setSuggestOpen(true);
                setHighlightIndex((i) => (i > 0 ? i - 1 : 0));
                return;
              }
              if (e.key === "Escape") {
                if (suggestOpen) {
                  e.preventDefault();
                  setSuggestOpen(false);
                }
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (
                  suggestOpen &&
                  matches.length > 0 &&
                  highlightIndex >= 0 &&
                  matches[highlightIndex]
                ) {
                  tryAddKeyword(matches[highlightIndex]);
                } else {
                  addKeyword();
                }
              }
            }}
          />
          {suggestOpen && matches.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
            >
              {matches.map((name, idx) => (
                <li
                  key={name}
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={idx === highlightIndex}
                  className={`cursor-pointer px-3 py-2 ${
                    idx === highlightIndex ? "bg-indigo-50 text-indigo-900" : "text-gray-800"
                  }`}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    tryAddKeyword(name);
                  }}
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={addKeyword}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 shrink-0"
        >
          Add
        </button>
      </div>
      {values.keywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.keywords.map((keyword, index) => (
            <span
              key={index}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
            >
              {keyword.name}
              {keyword.isPrivate && <span className="ml-1 text-xs">🔒</span>}
              <button
                type="button"
                onClick={() => removeKeyword(index)}
                className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-blue-200"
                aria-label={`Remove ${keyword.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <form
      onSubmit={e => { if (picturesBusy) { e.preventDefault(); return; } onSubmit(e); }}
      className="bg-white shadow rounded-lg p-6 space-y-6"
    >
      {validationError && (
        <ErrorMessage message={validationError} />
      )}
      {submitError && (
        <ErrorMessage
          message={submitError}
          onRetry={onDismissSubmitError ?? undefined}
        />
      )}

      <section aria-labelledby={`${mode}-question-heading`} className="space-y-6">
        <h2 id={`${mode}-question-heading`} className="text-lg font-semibold text-gray-900">
          Question and answers
        </h2>
        <div>
          <label
            htmlFor={`${mode}-question`}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Question *
          </label>
          <textarea
            id={`${mode}-question`}
            ref={questionRef}
            value={values.question}
            onChange={(e) => onChange({ ...values, question: e.target.value })}
            required
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
          />
        </div>

        {!questionPictureReadOnly && <ImageSlotEditor label="Question picture" value={values.questionImage} onChange={questionImage => onChange({ ...values, questionImage })} onBusy={setQuestionBusy} />}

        <div>
          <label
            htmlFor={`${mode}-correct-answer`}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Correct Answer *
          </label>
          <input
            id={`${mode}-correct-answer`}
            type="text"
            value={values.correctAnswer}
            onChange={(e) =>
              onChange({ ...values, correctAnswer: e.target.value })
            }
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Incorrect Answers (at least 1 required) *
          </label>
          {values.incorrectAnswers.map((answer, index) => (
            <div key={index} className="mb-3">
              <input
                type="text"
                value={answer}
                onChange={(e) =>
                  handleIncorrectAnswerChange(index, e.target.value)
                }
                aria-label={`Incorrect answer ${index + 1}`}
                placeholder={`Incorrect answer ${index + 1}`}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
              />
              <input
                type="text"
                value={values.incorrectAnswerRationale?.[index] ?? ""}
                maxLength={200}
                onChange={(e) => handleIncorrectAnswerRationaleChange(index, e.target.value)}
                aria-label={`Why incorrect answer ${index + 1} is wrong (optional)`}
                placeholder="Why this is wrong (optional, max 200 characters)"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
              />
            </div>
          ))}
        </div>
      </section>

      <div>
        <button
          type="button"
          id={`${mode}-more-options-toggle`}
          aria-expanded={moreOpen}
          aria-controls={moreOptionsId}
          onClick={() => setMoreOpenChoice(!moreOpen)}
          className="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 hover:text-indigo-900"
        >
          <span aria-hidden>{moreOpen ? "▾" : "▸"}</span>
          More options
        </button>
        <p className="mt-1 text-xs text-gray-500">
          Group label, explanation, source, extra keywords and pronunciation (all optional).
        </p>
        <div
          id={moreOptionsId}
          role="group"
          aria-labelledby={`${mode}-more-options-toggle`}
          hidden={!moreOpen}
          className="mt-4 space-y-6 rounded-lg border border-gray-200 bg-slate-50/80 p-4 sm:p-5"
        >
          <div>
            <label
              htmlFor={`${mode}-group-label`}
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Group label (optional)
            </label>
            <input
              id={`${mode}-group-label`}
              type="text"
              value={values.groupLabel}
              onChange={(e) => onChange({ ...values, groupLabel: e.target.value })}
              maxLength={30}
              placeholder="e.g., Mammals"
              aria-describedby={`${mode}-group-label-help`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
            />
            <p id={`${mode}-group-label-help`} className="mt-1 text-xs text-gray-500">
              Used by Sort It. Items with the same label form a group. Up to 30 characters.
            </p>
          </div>

          <div>
            <label
              htmlFor={`${mode}-explanation`}
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Explanation
            </label>
            <textarea
              id={`${mode}-explanation`}
              value={values.explanation}
              onChange={(e) =>
                onChange({ ...values, explanation: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
            />
          </div>

          {!explanationPictureReadOnly && <ImageSlotEditor label="Explanation picture" value={values.explanationImage} onChange={explanationImage => onChange({ ...values, explanationImage })} onBusy={setExplanationBusy} />}

          <div>
            <label
              htmlFor={`${mode}-source`}
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Source (optional)
            </label>
            <input
              id={`${mode}-source`}
              type="text"
              value={values.source}
              onChange={(e) => onChange({ ...values, source: e.target.value })}
              maxLength={1000}
              placeholder="e.g., ChatGPT, Claude, Manual"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
            />
          </div>

          {keywordBlock}

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium text-gray-700">
              Pronunciation and language (optional)
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Question pronunciation
                </label>
                <input
                  type="text"
                  value={values.questionSpeech.pronunciation ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...values,
                      questionSpeech: updateSpeechSupport(
                        values.questionSpeech,
                        "pronunciation",
                        e.target.value
                      ),
                    })
                  }
                  placeholder="kuroi"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Question language code
                </label>
                <input
                  type="text"
                  value={values.questionSpeech.languageCode ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...values,
                      questionSpeech: updateSpeechSupport(
                        values.questionSpeech,
                        "languageCode",
                        e.target.value
                      ),
                    })
                  }
                  placeholder="ja-JP"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Answer pronunciation
                </label>
                <input
                  type="text"
                  value={values.correctAnswerSpeech.pronunciation ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...values,
                      correctAnswerSpeech: updateSpeechSupport(
                        values.correctAnswerSpeech,
                        "pronunciation",
                        e.target.value
                      ),
                    })
                  }
                  placeholder="kuroi"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Answer language code
                </label>
                <input
                  type="text"
                  value={values.correctAnswerSpeech.languageCode ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...values,
                      correctAnswerSpeech: updateSpeechSupport(
                        values.correctAnswerSpeech,
                        "languageCode",
                        e.target.value
                      ),
                    })
                  }
                  placeholder="ja-JP"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
                />
              </div>
            </div>
            {values.incorrectAnswers.map((_, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Incorrect answer {index + 1} pronunciation
                  </label>
                  <input
                    type="text"
                    value={values.incorrectAnswerSpeech[index]?.pronunciation ?? ""}
                    onChange={(e) =>
                      handleIncorrectAnswerSpeechChange(index, "pronunciation", e.target.value)
                    }
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Incorrect answer {index + 1} language code
                  </label>
                  <input
                    type="text"
                    value={values.incorrectAnswerSpeech[index]?.languageCode ?? ""}
                    onChange={(e) =>
                      handleIncorrectAnswerSpeechChange(index, "languageCode", e.target.value)
                    }
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900 placeholder:text-gray-500"
                  />
                </div>
              </div>
            ))}
          </fieldset>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-slate-50/80 p-4 sm:p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Save to</h2>
          <p className="mt-1 text-xs text-gray-500">
            Category, primary topic, and subtopic define where the item appears when browsing.
          </p>
        </div>
        <ItemTopicScopeFields
          idPrefix="item-form"
          ref={topicScopeRef}
          category={values.category}
          rank1={values.navigationRank1}
          rank2={values.navigationRank2}
          onScopeChange={(patch) =>
            onChange({
              ...values,
              ...(patch.category !== undefined && { category: patch.category }),
              ...(patch.rank1 !== undefined && { navigationRank1: patch.rank1 }),
              ...(patch.rank2 !== undefined && { navigationRank2: patch.rank2 }),
            })
          }
          suggestionText={
            mode === "create"
              ? composeItemSuggestionText(values.question, values.correctAnswer, values.explanation)
              : undefined
          }
          onSuggestionsShown={onTopicSuggestionsShown}
          error={topicError}
        />
        <div className="pt-4 border-t border-gray-200/90 space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={values.isPrivate}
              onChange={(e) =>
                onChange({ ...values, isPrivate: e.target.checked })
              }
              disabled={!isAdmin}
              className="mr-2"
            />
            <span className="text-sm font-medium text-gray-700">
              Private Item {!isAdmin && "(default for regular users)"}
            </span>
          </label>
          {!isAdmin && (
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={values.readyForReview}
                onChange={(e) =>
                  onChange({ ...values, readyForReview: e.target.checked })
                }
                className="mr-2"
              />
              <span className="text-sm font-medium text-gray-700">
                Request admin review to make this item public
              </span>
            </label>
          )}
        </div>
      </section>

      {mode === "create" && (
        <div role="status" className="text-sm text-green-800">
          {statusMessage}
        </div>
      )}

      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
        {mode === "create" && (
          <button
            type="submit"
            data-action="another"
            disabled={isPending || picturesBusy}
            className="px-4 py-2 text-sm font-medium text-indigo-700 bg-white border border-indigo-300 rounded-md hover:bg-indigo-50 disabled:opacity-50"
          >
            Save and add another
          </button>
        )}
        <button
          type="submit"
          disabled={isPending || picturesBusy}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "Saving..." : mode === "create" ? "Save and study" : "Save"}
        </button>
      </div>
    </form>
  );
}
