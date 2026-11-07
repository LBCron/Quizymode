import { useEffect, useId, useRef, type RefObject } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";

interface FallingCardProps {
  question: string;
  /** Set once the drop is lost: the correct answer replaces the question text. */
  revealAnswer: string | null;
  /** True after a correct pick. */
  caught: boolean;
  /** The card falls (or the bar shrinks) only while this is true; it holds its place otherwise. */
  running: boolean;
  fallMs: number;
  reducedMotion: boolean;
  onLand: () => void;
  /** The focusable question card. */
  cardRef: RefObject<HTMLDivElement | null>;
  /** Text before the revealed answer; Sort It uses "Group: ". */
  revealPrefix?: string;
}

/**
 * One falling question. Mount it with a new key per drop. Progress accumulates frame deltas, so it pauses while the
 * tab is hidden and during feedback; the position is written straight to the DOM to avoid a render per frame.
 * With reduced motion the card stays at the top and a decorative bar shows the time left instead.
 */
export function FallingCard({
  question,
  revealAnswer,
  caught,
  running,
  fallMs,
  reducedMotion,
  onLand,
  cardRef,
  revealPrefix = "Answer: ",
}: FallingCardProps) {
  const id: string = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const elapsedMs = useRef(0);
  const onLandRef = useRef(onLand);
  useEffect(() => {
    onLandRef.current = onLand;
  });

  const apply = (progress: number) => {
    const wrapper = wrapperRef.current;
    const area = wrapper?.parentElement;
    if (wrapper && area && !reducedMotion) {
      const distance: number = Math.max(0, area.clientHeight - wrapper.offsetHeight);
      wrapper.style.transform = `translateY(${Math.round(distance * progress)}px)`;
    }
    const bar = barRef.current;
    if (bar) {
      bar.style.width = `${Math.round((1 - progress) * 100)}%`;
      bar.dataset.low = String(1 - progress < 0.25);
    }
  };

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last: number | null = null;
    // Browsers stop frames in a hidden tab, so the first frame after returning must not add the whole gap.
    const onVisibility = () => {
      last = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    const tick = (now: number) => {
      if (document.hidden) {
        last = null;
      } else {
        if (last !== null) elapsedMs.current += Math.max(0, now - last);
        last = now;
      }
      const progress: number = Math.min(1, elapsedMs.current / fallMs);
      apply(progress);
      if (progress >= 1) {
        onLandRef.current();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.cancelAnimationFrame(frame);
    };
    // apply only reads refs and reducedMotion, which is fixed for a mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, fallMs]);

  const revealed: boolean = revealAnswer !== null;
  let style = "border-indigo-300 bg-surface";
  if (revealed) style = "border-red-500 bg-red-50 motion-safe:animate-wrong-shake";
  else if (caught) style = "border-green-500 bg-green-50 motion-safe:animate-correct-pulse";

  return (
    <>
      <div ref={wrapperRef} className="absolute inset-x-3 top-0 will-change-transform">
        <div
          ref={cardRef}
          role="group"
          tabIndex={-1}
          aria-labelledby={`${id}-q`}
          className={`relative rounded-lg border-2 p-3 text-center text-base font-semibold text-gray-900 [overflow-wrap:anywhere] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:text-lg ${style}`}
        >
          {revealed && <XCircleIcon className="absolute right-2 top-2 h-5 w-5 text-red-600" aria-hidden="true" />}
          {caught && <CheckCircleIcon className="absolute right-2 top-2 h-5 w-5 text-green-600" aria-hidden="true" />}
          <p id={`${id}-q`} className="line-clamp-3">
            {revealed ? (
              <>
                {revealPrefix}<ForeignPhraseText text={revealAnswer ?? ""} />
              </>
            ) : (
              <ForeignPhraseText text={question} />
            )}
          </p>
        </div>
      </div>
      {reducedMotion && (
        <div aria-hidden="true" className="absolute inset-x-3 bottom-3 h-1.5 rounded-full bg-gray-200">
          <div
            ref={barRef}
            data-low="false"
            style={{ width: "100%" }}
            className="h-full rounded-full bg-indigo-600 data-[low=true]:bg-red-600"
          />
        </div>
      )}
    </>
  );
}
