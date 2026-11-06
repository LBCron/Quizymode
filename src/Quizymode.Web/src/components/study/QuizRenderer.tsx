/**
 * Renders a single item in Quiz mode: question, answer options, feedback.
 */
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ItemResponse } from "@/types/api";
import { SpeakButton } from "@/components/SpeakButton";
import { useSpeech } from "@/hooks/useSpeech";
import { PronunciationHint } from "@/components/items/PronunciationHint";
import { QuestionImage } from "@/components/study/QuestionImage";
import { PICTURE_REQUIRED_NOTE_ID, type QuestionPictureControls } from "@/components/study/pictureGate";
import { PictureGateNotes } from "@/components/study/PictureGateNotes";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";
import { getIndexedSpeech } from "@/utils/itemSpeech";
import { toPlainText } from "@/utils/foreignPhrase";

/** Result of a typed answer for the current item; `locked` once it has been recorded (no more override). */
export interface TypedAnswerOutcome {
  typed: string;
  correct: boolean;
  locked: boolean;
}

/** Practice-only Type answer option (AC 3.6.19). Omit it (Test, Daily, fixed sets) for multiple choice only. */
export interface TypedAnswerControls {
  isTypeable: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  result: TypedAnswerOutcome | null;
  onSubmit: (typed: string) => void;
  onOverride: () => void;
  onContinue: () => void;
  continueLabel: string;
}

function TypedAnswerPanel({
  item,
  controls,
  disabled,
}: {
  item: ItemResponse;
  controls: TypedAnswerControls;
  /** True while the question picture is not showing (#403): typing and checking are off. */
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const continueRef = useRef<HTMLButtonElement>(null);
  const { result } = controls;
  const awaitingContinue = result !== null && !result.locked;
  const canOverride = result !== null && !result.locked && !result.correct;

  useEffect(() => {
    if (awaitingContinue) continueRef.current?.focus();
  }, [awaitingContinue]);

  const submit = () => {
    if (disabled || result || text.trim().length === 0) return;
    controls.onSubmit(text);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`typed-answer-${item.id}`} className="block text-base font-medium text-gray-900">
        Type your answer
      </label>
      <div className="flex gap-2">
        <input
          id={`typed-answer-${item.id}`}
          type="text"
          value={result ? result.typed : text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          readOnly={result !== null}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        />
        {!result && (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || text.trim().length === 0}
            className="rounded-md bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check answer
          </button>
        )}
      </div>
      <div role="status" aria-live="polite">
        {result && (
          <p className={result.correct ? "font-medium text-green-800" : "font-medium text-red-800"}>
            {result.correct ? "Correct." : "Incorrect."} Accepted answer: {toPlainText(item.correctAnswer)}
          </p>
        )}
      </div>
      {awaitingContinue && (
        <div className="flex flex-wrap gap-2">
          {canOverride && (
            <button
              type="button"
              onClick={controls.onOverride}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              I was right
            </button>
          )}
          <button
            ref={continueRef}
            type="button"
            onClick={controls.onContinue}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {controls.continueLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export interface QuizRendererProps {
  item: ItemResponse;
  options: string[];
  selectedAnswer: string | null;
  showAnswer: boolean;
  onAnswerSelect: (answer: string) => void;
  stats: { total: number; correct: number };
  /**
   * False for an unsubmitted Test (AC 3.18.3): options stay selectable, the selection is neutral
   * (aria-pressed), and no correctness, answer panel, score line or option pronunciation hint renders.
   */
  revealFeedback?: boolean;
  typedAnswer?: TypedAnswerControls;
  /** Gate for the question picture (#403). Omit only where the item can never have one. */
  questionPicture?: QuestionPictureControls;
  /**
   * Wow feedback (#462): when defined, a polite live region renders the node (null until answered) and, once answered,
   * replaces the options, the blue answer box and the score line. Leave undefined for the standard feedback.
   */
  answerPanel?: ReactNode;
}

export function QuizRenderer({
  item,
  options,
  selectedAnswer,
  showAnswer,
  onAnswerSelect,
  stats,
  revealFeedback = true,
  typedAnswer,
  questionPicture,
  answerPanel,
}: QuizRendererProps) {
  const { isSupported } = useSpeech();
  const pictureBlocked = questionPicture?.blocked ?? false;
  const typedActive = typedAnswer !== undefined && (typedAnswer.enabled || typedAnswer.result !== null);
  const hasPanel = answerPanel !== undefined;
  const panelShowing = hasPanel && showAnswer;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <h3 className="text-base font-medium text-gray-900">Question</h3>
          <SpeakButton
            text={item.question}
            speech={item.questionSpeech}
            isSupported={isSupported}
            label="Read question aloud"
          />
        </div>
        <p className="text-gray-700"><ForeignPhraseText text={item.question} /></p>
        <PronunciationHint text={item.question} speech={item.questionSpeech} />
        <QuestionImage
          key={item.id}
          image={item.questionImage}
          className="mt-3"
          onStatusChange={questionPicture?.onStatusChange}
          onSkip={questionPicture?.onSkip}
        />
      </div>

      {typedAnswer && !showAnswer && typedAnswer.isTypeable && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={typedAnswer.enabled}
            disabled={pictureBlocked}
            onChange={(event) => typedAnswer.onEnabledChange(event.target.checked)}
          />
          Type answer
        </label>
      )}
      {typedAnswer && !showAnswer && !typedAnswer.isTypeable && (
        <p className="text-sm text-gray-500">This answer is too long to type, so choose an option.</p>
      )}

      {typedActive && typedAnswer && (
        <TypedAnswerPanel key={item.id} item={item} controls={typedAnswer} disabled={pictureBlocked} />
      )}

      <PictureGateNotes controls={questionPicture} />

      {!typedActive && !panelShowing && (
      <div>
        <h3 className="text-base font-medium text-gray-900 mb-1">
          Select an answer:
        </h3>
        <div
          role="group"
          aria-label="Answer options"
          aria-disabled={pictureBlocked || undefined}
          aria-describedby={pictureBlocked ? PICTURE_REQUIRED_NOTE_ID : undefined}
          className="space-y-1.5"
        >
          {options.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const isCorrect = option === item.correctAnswer;
            const isSelected = selectedAnswer === option;
            const wrongIndex = isCorrect ? -1 : item.incorrectAnswers.findIndex((candidate) => candidate === option);
            const wrongRationale = wrongIndex >= 0 ? item.incorrectAnswerRationale?.[wrongIndex] : undefined;
            const optionSpeech = isCorrect
              ? item.correctAnswerSpeech
              : getIndexedSpeech(
                  item.incorrectAnswerSpeech,
                  item.incorrectAnswers.findIndex((candidate) => candidate === option)
                );
            let bgColor = "bg-white hover:bg-gray-50";
            let motion = "";
            const showsCorrect = revealFeedback && showAnswer && isCorrect;
            const showsWrong = revealFeedback && showAnswer && isSelected && !isCorrect;
            const isNeutralSelected = !revealFeedback && isSelected;
            if (isNeutralSelected) {
              bgColor = "bg-slate-100 border-slate-700 ring-1 ring-slate-700";
            }
            if (showsCorrect) {
              bgColor = "bg-green-100 border-green-500";
              motion = "motion-safe:animate-correct-pulse";
            } else if (showsWrong) {
              bgColor = "bg-red-100 border-red-500";
              motion = "motion-safe:animate-wrong-shake";
            }

            return (
              <button
                key={index}
                type="button"
                onClick={() => onAnswerSelect(option)}
                disabled={(revealFeedback && showAnswer) || pictureBlocked}
                aria-pressed={revealFeedback ? undefined : isSelected}
                aria-keyshortcuts={`${index + 1} ${letter}`}
                className={`w-full text-left px-3 py-2 border-2 rounded-lg ${bgColor} ${motion} ${
                  pictureBlocked
                    ? "cursor-not-allowed opacity-60"
                    : revealFeedback && showAnswer
                      ? "cursor-default"
                      : "cursor-pointer"
                }`}
              >
                <div className={showsCorrect || showsWrong || isNeutralSelected ? "relative pr-7" : "relative"}>
                  {showsCorrect && (
                    <CheckCircleIcon className="absolute right-0 top-0 h-5 w-5 text-green-600" aria-hidden="true" />
                  )}
                  {showsWrong && (
                    <XCircleIcon className="absolute right-0 top-0 h-5 w-5 text-red-600" aria-hidden="true" />
                  )}
                  {isNeutralSelected && (
                    <CheckCircleIcon className="absolute right-0 top-0 h-5 w-5 text-slate-700" aria-hidden="true" />
                  )}
                  <span className="font-medium">{letter}.</span>{" "}
                  <ForeignPhraseText text={option} />
                  {revealFeedback && (
                    <PronunciationHint
                      text={option}
                      speech={optionSpeech}
                      className="mt-1 text-sm text-gray-500 italic"
                    />
                  )}
                  {showsWrong && wrongRationale && (
                    <p className="mt-1 text-sm text-red-800" data-testid="option-rationale">
                      <ForeignPhraseText text={wrongRationale} />
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      )}

      {hasPanel && (
        <div role="status" aria-live="polite">
          {showAnswer ? answerPanel : null}
        </div>
      )}

      {revealFeedback && showAnswer && !hasPanel && (
        <div className="p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-blue-900">
              Correct Answer: {item.correctAnswer}
            </p>
            <SpeakButton
              text={item.correctAnswer}
              speech={item.correctAnswerSpeech}
              isSupported={isSupported}
              label="Read answer aloud"
            />
          </div>
          <PronunciationHint
            text={item.correctAnswer}
            speech={item.correctAnswerSpeech}
            className="mt-1 text-sm text-blue-700 italic"
          />
          {item.explanation && (
            <p className="text-sm text-blue-700 mt-1"><ForeignPhraseText text={item.explanation} linkify /></p>
          )}
          {/* Mounted only once the answer is revealed: the picture can show the answer (#403). */}
          <QuestionImage
            key={`${item.id}-explanation`}
            image={item.explanationImage}
            slot="explanation"
            className="mt-3 rounded-lg bg-white"
          />
        </div>
      )}

      {revealFeedback && !hasPanel && (
        <div className="px-3 py-2 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">
            Score: {stats.correct} / {stats.total} correct
            {stats.total > 0 && (
              <span className="ml-2">
                ({Math.round((stats.correct / stats.total) * 100)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
