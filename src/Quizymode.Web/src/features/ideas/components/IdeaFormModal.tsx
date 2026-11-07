import { useEffect, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import TurnstileWidget from "./TurnstileWidget";
import { getIdeaFieldError } from "../ideaValidation";

export interface IdeaFormValues {
  title: string;
  problem: string;
  proposedChange: string;
  tradeOffs: string;
  turnstileToken: string | null;
}

interface IdeaFormModalProps {
  isOpen: boolean;
  title: string;
  submitLabel: string;
  initialValues?: Partial<IdeaFormValues>;
  isPending: boolean;
  errorMessage?: string | null;
  helperText?: string | null;
  requireTurnstile?: boolean;
  onClose: () => void;
  onSubmit: (values: IdeaFormValues) => void;
}

const emptyValues: IdeaFormValues = {
  title: "",
  problem: "",
  proposedChange: "",
  tradeOffs: "",
  turnstileToken: null,
};

const getFieldError = getIdeaFieldError;

const IdeaFormModal = ({
  isOpen,
  title,
  submitLabel,
  initialValues,
  isPending,
  errorMessage,
  helperText,
  requireTurnstile = false,
  onClose,
  onSubmit,
}: IdeaFormModalProps) => {
  const [values, setValues] = useState<IdeaFormValues>(emptyValues);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({
      title: initialValues?.title ?? "",
      problem: initialValues?.problem ?? "",
      proposedChange: initialValues?.proposedChange ?? "",
      tradeOffs: initialValues?.tradeOffs ?? "",
      turnstileToken: null,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTouched(new Set());
  }, [initialValues, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, isPending, onClose]);

  if (!isOpen) {
    return null;
  }

  const touch = (field: string) =>
    setTouched((prev) => new Set([...prev, field]));

  const titleError = getFieldError("title", values.title);
  const problemError = getFieldError("problem", values.problem);
  const proposedChangeError = getFieldError("proposedChange", values.proposedChange);
  const tradeOffsError = getFieldError("tradeOffs", values.tradeOffs);

  const canSubmit =
    !titleError &&
    !problemError &&
    !proposedChangeError &&
    !tradeOffsError &&
    (!requireTurnstile || !!values.turnstileToken);

  const handleSubmit = () => {
    touch("title");
    touch("problem");
    touch("proposedChange");
    touch("tradeOffs");

    if (!canSubmit || isPending) {
      return;
    }

    onSubmit(values);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-panel-deep/70 px-4 py-10 backdrop-blur-sm"
      onClick={() => {
        if (!isPending) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="idea-form-title"
        className="mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-surface shadow-2xl"
        style={{ maxHeight: "calc(100vh - 5rem)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
              Ideas
            </p>
            <h2 id="idea-form-title" className="mt-1 text-2xl font-semibold text-slate-900">
              {title}
            </h2>
            {helperText && <p className="mt-2 text-sm text-slate-600">{helperText}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close idea form"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="idea-title" className="block text-sm font-medium text-slate-900">
                  Title
                </label>
                <span className="text-xs text-slate-400">{values.title.trim().length}/200</span>
              </div>
              <input
                id="idea-title"
                type="text"
                value={values.title}
                onChange={(event) =>
                  setValues((current) => ({ ...current, title: event.target.value }))
                }
                onBlur={() => touch("title")}
                maxLength={210}
                placeholder="A short label people can scan quickly"
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              {touched.has("title") && titleError && (
                <p className="mt-1.5 text-xs text-rose-600">{titleError}</p>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="idea-problem" className="block text-sm font-medium text-slate-900">
                  Problem
                </label>
                <span className="text-xs text-slate-400">{values.problem.trim().length}/4000</span>
              </div>
              <textarea
                id="idea-problem"
                value={values.problem}
                onChange={(event) =>
                  setValues((current) => ({ ...current, problem: event.target.value }))
                }
                onBlur={() => touch("problem")}
                rows={4}
                maxLength={4100}
                placeholder="What is frustrating, missing, or unclear today?"
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              {touched.has("problem") && problemError && (
                <p className="mt-1.5 text-xs text-rose-600">{problemError}</p>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor="idea-proposed-change"
                  className="block text-sm font-medium text-slate-900"
                >
                  Proposed change
                </label>
                <span className="text-xs text-slate-400">{values.proposedChange.trim().length}/4000</span>
              </div>
              <textarea
                id="idea-proposed-change"
                value={values.proposedChange}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    proposedChange: event.target.value,
                  }))
                }
                onBlur={() => touch("proposedChange")}
                rows={4}
                maxLength={4100}
                placeholder="Describe the product or workflow change you want."
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              {touched.has("proposedChange") && proposedChangeError && (
                <p className="mt-1.5 text-xs text-rose-600">{proposedChangeError}</p>
              )}
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="idea-tradeoffs" className="block text-sm font-medium text-slate-900">
                  Trade-offs
                  <span className="ml-1 font-normal text-slate-500">(optional)</span>
                </label>
                {values.tradeOffs.trim().length > 0 && (
                  <span className="text-xs text-slate-400">{values.tradeOffs.trim().length}/4000</span>
                )}
              </div>
              <textarea
                id="idea-tradeoffs"
                value={values.tradeOffs}
                onChange={(event) =>
                  setValues((current) => ({ ...current, tradeOffs: event.target.value }))
                }
                onBlur={() => touch("tradeOffs")}
                rows={3}
                maxLength={4100}
                placeholder="What complexity, cost, or downside should we remember?"
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              {touched.has("tradeOffs") && tradeOffsError && (
                <p className="mt-1.5 text-xs text-rose-600">{tradeOffsError}</p>
              )}
            </div>
          </div>

          {/* Verification and submit errors live in the footer, outside the scrolling body, so they
              stay visible next to Submit on short screens. */}
          <div className="space-y-3 border-t border-slate-200 px-6 py-4">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
              >
                {errorMessage}
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              {requireTurnstile ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-900">Verification</p>
                  <TurnstileWidget
                    onTokenChange={(token) =>
                      setValues((current) => ({ ...current, turnstileToken: token }))
                    }
                  />
                </div>
              ) : (
                <span aria-hidden />
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit || isPending}
                  className="rounded-full bg-panel px-5 py-2.5 text-sm font-medium text-on-panel transition hover:bg-panel-raised disabled:opacity-50"
                >
                  {isPending ? "Saving..." : submitLabel}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default IdeaFormModal;
