/**
 * Renders a single item in Explore (Flashcards) mode: question face-up; tap/click flips to answer + explanation.
 */
import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import type { FlashcardGrade } from "@/features/items/flashcards/flashcardDeck";
import type { ItemResponse } from "@/types/api";
import { SpeakButton } from "@/components/SpeakButton";
import { useSpeech } from "@/hooks/useSpeech";
import { PronunciationHint } from "@/components/items/PronunciationHint";
import { QuestionImage } from "@/components/study/QuestionImage";
import { PICTURE_REQUIRED_NOTE_ID, type QuestionPictureControls } from "@/components/study/pictureGate";
import { PictureGateNotes } from "@/components/study/PictureGateNotes";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";

/** Characters beyond which the explanation is truncated with a "Show more" toggle. */
const EXPLANATION_CLAMP_THRESHOLD = 220;

export interface ExploreRendererProps {
  item: ItemResponse;
  /** Called each time the card is flipped to its answer. */
  onReveal?: (item: ItemResponse) => void;
  /** The card's current self-grade. The grade group shows only when `onGrade` is set and the card is flipped. */
  grade?: FlashcardGrade;
  onGrade?: (item: ItemResponse, grade: FlashcardGrade) => void;
  /** Controlled flip state (used for keyboard shortcuts). The owner resets it when the card changes. */
  isFlipped?: boolean;
  onFlippedChange?: (flipped: boolean) => void;
  /** Gate for the question picture (#403): the grade buttons stay off until it shows. Flipping is never blocked. */
  questionPicture?: QuestionPictureControls;
}

const GRADE_OPTIONS: ReadonlyArray<{ grade: FlashcardGrade; label: string; shortcut: string }> = [
  { grade: "got-it", label: "Got it", shortcut: "1" },
  { grade: "still-learning", label: "Still learning", shortcut: "2" },
];

export function ExploreRenderer({
  item,
  onReveal,
  grade,
  onGrade,
  isFlipped: controlledFlipped,
  onFlippedChange,
  questionPicture,
}: ExploreRendererProps) {
  const pictureBlocked = questionPicture?.blocked ?? false;
  const [internalFlipped, setInternalFlipped] = useState(false);
  const isControlled = controlledFlipped !== undefined;
  const isFlipped = isControlled ? controlledFlipped : internalFlipped;
  const setIsFlipped = (flipped: boolean) => {
    if (isControlled) onFlippedChange?.(flipped);
    else setInternalFlipped(flipped);
  };
  const [explanationExpanded, setExplanationExpanded] = useState(false);
  const { isSupported } = useSpeech();

  useEffect(() => {
    if (!isControlled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInternalFlipped(false);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExplanationExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const explanationTrimmed = item.explanation?.trim() ?? "";
  const hasExplanation = explanationTrimmed.length > 0;
  const isLongExplanation = explanationTrimmed.length > EXPLANATION_CLAMP_THRESHOLD;

  return (
    <div className="mx-auto max-w-2xl">
      {/* One picture slot above both faces: visible on both sides and never inside a flip button (so its alt text stays reachable). */}
      {item.questionImage && (
        <div className="mb-3">
          <QuestionImage
            key={item.id}
            itemId={item.id} image={item.questionImage}
            onStatusChange={questionPicture?.onStatusChange}
            onSkip={questionPicture?.onSkip}
          />
        </div>
      )}
      {/*
        Outer container sets the minimum card height. Whichever face is
        currently visible is in normal document flow (drives height); the
        hidden face is pulled out of flow with absolute positioning so it
        doesn't affect layout.
      */}
      <div className="relative min-h-[12rem]">

        {/* ── Front face: question ── */}
        <div
          className={`rounded-xl border border-gray-200 bg-white shadow-sm transition-opacity duration-300 ${
            isFlipped ? "absolute inset-0 opacity-0 pointer-events-none select-none" : "opacity-100"
          }`}
          aria-hidden={isFlipped}
          data-testid="flashcard-front"
        >
          {/* Label row with speak button — sits outside the flip button so there is no nested-button issue */}
          <div className="flex items-center justify-between px-6 pt-6 pb-0">
            <p className="text-sm font-medium text-gray-500">Question</p>
            <SpeakButton
              text={item.question}
              speech={item.questionSpeech}
              isSupported={isSupported}
              label="Read question aloud"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setIsFlipped(true);
              onReveal?.(item);
            }}
            aria-expanded={false}
            aria-label="Show answer and explanation"
            className="w-full rounded-b-xl px-6 pb-6 pt-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <div className="flex-1">
              <p className="text-lg text-gray-900">
                <ForeignPhraseText text={item.question} />
              </p>
              <PronunciationHint text={item.question} speech={item.questionSpeech} />
            </div>
            <p className="mt-4 text-xs text-gray-400">Click the card to reveal the answer</p>
          </button>
        </div>

        {/* ── Back face: answer + explanation ── */}
        <div
          className={`rounded-xl border border-indigo-100 bg-indigo-50/80 shadow-sm transition-opacity duration-300 ${
            !isFlipped ? "absolute inset-0 opacity-0 pointer-events-none select-none" : "opacity-100"
          }`}
          aria-hidden={!isFlipped}
          data-testid="flashcard-back"
        >
          {/* Label row with speak button — sits outside the flip button */}
          <div className="flex items-center justify-between px-6 pt-6 pb-0">
            <p className="text-sm font-medium text-gray-500">Answer</p>
            <SpeakButton
              text={item.correctAnswer}
              speech={item.correctAnswerSpeech}
              isSupported={isSupported}
              label="Read answer aloud"
            />
          </div>
          {/* Tapping the answer section flips back to the question */}
          <button
            type="button"
            onClick={() => setIsFlipped(false)}
            aria-expanded={isFlipped}
            aria-label="Show question"
            className="w-full rounded-none px-6 pb-2 pt-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <div>
              <p className="text-lg font-semibold text-gray-900">
                <ForeignPhraseText text={item.correctAnswer} />
              </p>
              <PronunciationHint text={item.correctAnswer} speech={item.correctAnswerSpeech} />
            </div>
            <p className="mt-2 text-xs text-gray-400">Click to show question</p>
          </button>

          {hasExplanation && (
            <div className="border-t border-indigo-200/80 px-6 pb-6 pt-4">
              <p className="text-sm font-medium text-gray-500">Explanation</p>
              <p
                className={`mt-2 text-gray-800 ${
                  isLongExplanation && !explanationExpanded ? "line-clamp-3" : ""
                }`}
              >
                <ForeignPhraseText text={explanationTrimmed} linkify />
              </p>
              {isLongExplanation && (
                <button
                  type="button"
                  onClick={() => setExplanationExpanded((e) => !e)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 rounded"
                >
                  {explanationExpanded ? "Show less" : "Show more"}
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      explanationExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}
              {/* Mounted only while flipped: the back face is in the DOM before the flip, and the picture can show the answer (#403). */}
              {isFlipped && (
                <QuestionImage
                  key={`${item.id}-explanation`}
                  itemId={item.id} image={item.explanationImage}
                  slot="explanation"
                  className="mt-3 rounded-lg bg-white"
                />
              )}
            </div>
          )}

          {onGrade && isFlipped && (
            <div className={`px-6 pb-5 ${hasExplanation ? "pt-1" : "border-t border-indigo-200/80 pt-4"}`}>
              <div
                role="group"
                aria-labelledby={`grade-label-${item.id}`}
                aria-disabled={pictureBlocked || undefined}
                aria-describedby={pictureBlocked ? PICTURE_REQUIRED_NOTE_ID : undefined}
              >
                <p id={`grade-label-${item.id}`} className="text-sm font-medium text-gray-500">
                  How well did you know this?
                </p>
                <PictureGateNotes controls={questionPicture} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {GRADE_OPTIONS.map((option) => {
                    const pressed = grade === option.grade;
                    return (
                      <button
                        key={option.grade}
                        type="button"
                        aria-pressed={pressed}
                        aria-keyshortcuts={option.shortcut}
                        disabled={pictureBlocked}
                        onClick={() => {
                          if (!pressed && !pictureBlocked) onGrade(item, option.grade);
                        }}
                        className={`inline-flex disabled:cursor-not-allowed disabled:opacity-60 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                          pressed
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {pressed && <CheckIcon className="h-4 w-4" aria-hidden="true" />}
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!hasExplanation && !(onGrade && isFlipped) && <div className="pb-4" />}
        </div>
      </div>
    </div>
  );
}
