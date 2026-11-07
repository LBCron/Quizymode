import { useEffect, useRef, useState } from "react";
import { getTestDeadlineMs, isTestInProgress, type QuizRunState } from "../quizRun";

/**
 * Seconds left in a timed Test, from the stored start time and the wall clock (AC 3.18.6). Recomputed every
 * second and when the tab becomes visible, so a throttled background tab cannot drift. At zero (also on a
 * reload after the deadline) `onExpire` is called with the deadline as an ISO string. Returns null when the
 * run is not a started, unsubmitted, timed Test.
 */
export function useTestCountdown(run: QuizRunState | null, onExpire: (deadlineIso: string) => void, paused = false): number | null {
  const deadline = run && isTestInProgress(run) ? getTestDeadlineMs(run) : null;
  const [now, setNow] = useState(() => Date.now());
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (deadline === null) return;
    const tick = (): void => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline]);

  const frozenNow = paused ? (run?.picturePausedAt ? Date.parse(run.picturePausedAt) : now) : now;
  const expired = !paused && !run?.picturePausedAt && deadline !== null && now >= deadline;
  useEffect(() => {
    if (deadline !== null && expired) onExpireRef.current(new Date(deadline).toISOString());
  }, [deadline, expired]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - frozenNow) / 1000));
}
