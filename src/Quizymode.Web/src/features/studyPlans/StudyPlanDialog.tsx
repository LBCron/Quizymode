import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { StudyPlanError, useStudyPlanActions, type CollectionPlan } from "./useStudyPlans";
import {
  MAX_PLANS,
  MAX_PLAN_DAYS_AHEAD,
  addLocalDays,
  forecastPlan,
  localDateString,
  parseDateOnly,
} from "./studyPlanSteps";

export type StudyPlanDialogResult = { kind: "saved"; testDate: string } | { kind: "removed" };

interface StudyPlanDialogProps {
  collectionId: string;
  collectionName: string;
  /** The visitor's existing plan for this collection, if any. */
  plan: CollectionPlan | null;
  /** True while a signed-in visitor's existing plan is still being fetched. */
  loading: boolean;
  onClose: (result?: StudyPlanDialogResult) => void;
}

const MESSAGES = {
  empty: "Choose a test date.",
  malformed: "Enter a valid date.",
  past: "That date has already passed. Choose today or later.",
  tooFar: `Choose a date within the next ${MAX_PLAN_DAYS_AHEAD} days.`,
};

function dateSchema(min: string, max: string) {
  return z.string().superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (value === "") return fail(MESSAGES.empty);
    if (parseDateOnly(value) === null) return fail(MESSAGES.malformed);
    if (value < min) return fail(MESSAGES.past);
    if (value > max) return fail(MESSAGES.tooFar);
  });
}

function errorCopy(error: StudyPlanError, action: "save" | "remove"): string {
  switch (error.kind) {
    case "limit":
      return `You can plan up to ${MAX_PLANS} tests at a time. Remove a plan from another collection first.`;
    case "notFound":
      return "This collection is no longer available, so a plan can't be saved.";
    case "invalidDate":
      return MESSAGES.tooFar;
    default:
      return action === "save"
        ? "Your plan could not be saved. Check your connection and try again."
        : "Your plan could not be removed. Try again.";
  }
}

/** The "Plan for a test" dialog (#364): pick a test date, preview the plan, save or remove it. */
export function StudyPlanDialog({ collectionId, collectionName, plan, loading, onClose }: StudyPlanDialogProps) {
  const titleId = useId();
  const helpId = useId();
  const errorId = useId();
  const { save, remove, isGuest } = useStudyPlanActions();
  const [now] = useState(() => new Date());
  const min = localDateString(now);
  const max = addLocalDays(now, MAX_PLAN_DAYS_AHEAD);
  const schema = useMemo(() => dateSchema(min, max), [min, max]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef);

  const [date, setDate] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"saving" | "removing" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  if (!initialized && !loading) {
    setInitialized(true);
    if (plan) setDate(plan.testDate);
  }

  const parsed = schema.safeParse(date);
  const validation = parsed.success ? null : parsed.error.issues[0].message;
  const shownValidation = touched ? validation : null;
  const learnedBefore =
    plan?.firstLearnAt != null && localDateString(new Date(plan.firstLearnAt)) < localDateString(now);
  const forecast = parsed.success ? forecastPlan(date, learnedBefore, now) : [];

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (inputRef.current ?? cancelRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous && previous !== document.body && previous.isConnected) previous.focus();
    };
  }, []);

  // When the existing plan finishes loading, the date input replaces the skeleton: move focus to it.
  const wasLoading = useRef(loading);
  useEffect(() => {
    if (wasLoading.current && !loading) inputRef.current?.focus();
    wasLoading.current = loading;
  }, [loading]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (validation !== null || busy || loading) return;
    setBusy("saving");
    setFailure(null);
    try {
      await save(collectionId, date);
      onClose({ kind: "saved", testDate: date });
    } catch (error) {
      setFailure(errorCopy(error instanceof StudyPlanError ? error : new StudyPlanError("network"), "save"));
      setBusy(null);
    }
  };

  const onRemove = async () => {
    if (busy) return;
    setBusy("removing");
    setFailure(null);
    try {
      await remove(collectionId);
      onClose({ kind: "removed" });
    } catch (error) {
      setFailure(errorCopy(error instanceof StudyPlanError ? error : new StudyPlanError("network"), "remove"));
      setBusy(null);
    }
  };

  const saveDisabled = busy !== null || loading || validation !== null;
  const describedBy = [helpId, shownValidation ? errorId : null].filter(Boolean).join(" ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      onClick={() => onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-4 text-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold">Plan for a test</h2>
        <p className="mt-0.5 break-words text-xs text-slate-600">{collectionName}</p>
        <p className="mt-2 text-sm text-slate-700">
          Pick your test date and we'll put one small step on your Home page each day.
        </p>

        <form onSubmit={(event) => void onSubmit(event)} noValidate>
          <label htmlFor={`${titleId}-date`} className="mt-3 block text-sm font-medium text-slate-800">
            Test date
          </label>
          {loading ? (
            <div role="status" className="mt-1">
              <span className="sr-only">Loading your plan…</span>
              <div aria-hidden="true" className="h-11 w-full animate-pulse rounded-md bg-slate-200" />
            </div>
          ) : (
            <input
              id={`${titleId}-date`}
              ref={inputRef}
              type="date"
              value={date}
              min={min}
              max={max}
              disabled={busy !== null}
              aria-invalid={shownValidation ? true : undefined}
              aria-describedby={describedBy}
              onChange={(event) => {
                setDate(event.target.value);
                setTouched(true);
                setFailure(null);
              }}
              className="mt-1 block min-h-[44px] w-full rounded-md border-slate-300 text-base disabled:opacity-60"
            />
          )}
          <p id={helpId} className="mt-1 text-xs text-slate-600">Up to {MAX_PLAN_DAYS_AHEAD} days from today.</p>
          {shownValidation && (
            <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">{shownValidation}</p>
          )}

          <div aria-live="polite" className="mt-3">
            <h3 className="text-xs font-semibold text-slate-600">What your plan looks like</h3>
            {forecast.length > 0 ? (
              <ol className="mt-1 space-y-0.5 text-sm text-slate-800">
                {forecast.map((row, index) => (
                  <li key={`${row.label}-${index}`}>{row.label ? `${row.label}: ${row.text}` : row.text}</li>
                ))}
              </ol>
            ) : (
              !shownValidation && <p className="mt-1 text-sm text-slate-600">Choose a date to see your plan.</p>
            )}
          </div>

          {isGuest && (
            <p className="mt-3 text-xs text-slate-600">
              Saved in this browser only. Sign in to keep your plan on all your devices.
            </p>
          )}
          {failure && (
            <p role="alert" className="mt-3 text-xs text-red-700">{failure}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2 sm:justify-end">
            {plan && (
              <button
                type="button"
                onClick={() => void onRemove()}
                disabled={busy !== null}
                className="min-h-[44px] w-full rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-60 sm:mr-auto sm:w-auto"
              >
                {busy === "removing" ? "Removing…" : "Remove plan"}
              </button>
            )}
            <button
              ref={cancelRef}
              type="button"
              onClick={() => onClose()}
              className="min-h-[44px] flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveDisabled}
              className="min-h-[44px] flex-1 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-60 sm:flex-none"
            >
              {busy === "saving" ? "Saving…" : "Save plan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
