import { useId, type Ref } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";

interface SurvivalQuestionProps {
  question: string;
  options: readonly string[];
  correctAnswer: string;
  /** The picked option once answered; null while the question is open. */
  picked: string | null;
  onAnswer: (option: string) => void;
  questionRef: Ref<HTMLParagraphElement>;
}

const OPTION_BASE =
  "relative w-full min-h-[52px] rounded-lg border-2 px-4 py-3 pr-11 text-left text-base [overflow-wrap:anywhere] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/** The question and its options. Plain buttons: no letters, hotkeys, speech or pronunciation hints (AC 3.20.14). */
export function SurvivalQuestion({ question, options, correctAnswer, picked, onAnswer, questionRef }: SurvivalQuestionProps) {
  const id: string = useId();
  const answered: boolean = picked !== null;

  return (
    <div>
      <p
        id={`${id}-q`}
        ref={questionRef}
        tabIndex={-1}
        className="mt-5 text-lg font-semibold text-gray-900 [overflow-wrap:anywhere] focus:outline-none sm:text-xl"
      >
        <ForeignPhraseText text={question} />
      </p>
      <div role="group" aria-labelledby={`${id}-q`} className="mt-4 flex flex-col gap-3">
        {options.map((option) => {
          const isPicked: boolean = answered && option === picked;
          const isCorrectOption: boolean = answered && option === correctAnswer;
          let style = "border-gray-300 bg-surface hover:bg-gray-50";
          let suffix = "";
          let icon = null;
          if (isPicked && isCorrectOption) {
            style = "border-green-500 bg-green-100 text-green-900 motion-safe:animate-correct-pulse";
            suffix = " Correct";
            icon = <CheckCircleIcon className="h-6 w-6 text-green-600" aria-hidden="true" />;
          } else if (isPicked) {
            style = "border-red-500 bg-red-100 text-red-900 motion-safe:animate-wrong-shake";
            suffix = " Wrong";
            icon = <XCircleIcon className="h-6 w-6 text-red-600" aria-hidden="true" />;
          } else if (isCorrectOption) {
            style = "border-green-500 bg-green-100 text-green-900";
            suffix = " Right answer";
            icon = <CheckCircleIcon className="h-6 w-6 text-green-600" aria-hidden="true" />;
          } else if (answered) {
            style = "border-gray-300 bg-surface opacity-60";
          }
          return (
            <button
              key={option}
              type="button"
              aria-disabled={answered || undefined}
              onClick={() => {
                if (!answered) onAnswer(option);
              }}
              className={`${OPTION_BASE} ${style} ${answered ? "cursor-default" : ""}`}
            >
              <ForeignPhraseText text={option} />
              {suffix && <span className="sr-only">{suffix}</span>}
              {icon && <span className="absolute right-3 top-1/2 -translate-y-1/2">{icon}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
