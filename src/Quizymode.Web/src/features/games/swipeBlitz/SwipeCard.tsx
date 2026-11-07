import { useId, useRef, type Ref, type TouchEvent } from "react";
import { XCircleIcon } from "@heroicons/react/24/outline";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";
import { classifySwipe, type SwipeDirection } from "./swipeGesture";

interface SwipeCardProps {
  question: string;
  shownAnswer: string;
  /** Set while a miss is revealed: the correct answer replaces the label and the shown answer. */
  revealAnswer: string | null;
  onSwipe: (direction: SwipeDirection) => void;
  cardRef: Ref<HTMLDivElement>;
}

/** The question card. Touch swipes use touch events (no drag-follow); scrolling vertically still works. */
export function SwipeCard({ question, shownAnswer, revealAnswer, onSwipe, cardRef }: SwipeCardProps) {
  const id: string = useId();
  const start = useRef<{ x: number; y: number } | null>(null);
  const revealed: boolean = revealAnswer !== null;

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const origin = start.current;
    start.current = null;
    const touch = event.changedTouches[0];
    if (!origin || !touch) return;
    const direction: SwipeDirection | null = classifySwipe(touch.clientX - origin.x, touch.clientY - origin.y);
    if (direction) onSwipe(direction);
  };

  return (
    <div
      ref={cardRef}
      role="group"
      tabIndex={-1}
      aria-labelledby={`${id}-q`}
      aria-describedby={`${id}-a`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        start.current = null;
      }}
      className={`relative flex min-h-48 touch-pan-y select-none flex-col justify-center rounded-lg border-2 p-4 [overflow-wrap:anywhere] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:min-h-56 sm:p-6 ${
        revealed ? "border-red-500 bg-red-50 motion-safe:animate-wrong-shake" : "border-gray-300 bg-surface"
      }`}
    >
      {revealed && <XCircleIcon className="absolute right-3 top-3 h-6 w-6 text-red-600" aria-hidden="true" />}
      <p id={`${id}-q`} className="text-base text-gray-800 sm:text-lg">
        <ForeignPhraseText text={question} />
      </p>
      <div id={`${id}-a`} className="mt-3">
        {revealed ? (
          <p className="text-2xl font-bold text-gray-900">
            Answer: <ForeignPhraseText text={revealAnswer ?? ""} />
          </p>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Answer?</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 sm:text-3xl">
              <ForeignPhraseText text={shownAnswer} />
            </p>
          </>
        )}
      </div>
    </div>
  );
}
