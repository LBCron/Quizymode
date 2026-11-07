import { getPageViewSessionId } from "@/utils/pageViewTracking";
import { useEffect, useState } from "react";
import axios from "axios";
import { useMutation } from "@tanstack/react-query";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { feedbackApi } from "@/api/feedback";
import { feedbackTypeMap, feedbackTypeOptions } from "../feedbackTypes";
import type { FeedbackType } from "@/types/api";

interface FeedbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: FeedbackType;
  defaultEmail?: string | null;
}

const FeedbackDialog = ({
  isOpen,
  onClose,
  initialType = "generalFeedback",
  defaultEmail = null,
}: FeedbackDialogProps) => {
  const [type, setType] = useState<FeedbackType>(initialType);
  const [currentUrl, setCurrentUrl] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [details, setDetails] = useState("");
  const [additionalKeywords, setAdditionalKeywords] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createFeedbackMutation = useMutation({
    mutationFn: () =>
      feedbackApi.create({
        type,
        currentUrl,
        details: details.trim(),
        email: email.trim() || null,
        additionalKeywords:
          type === "requestItems" && additionalKeywords.trim()
            ? additionalKeywords.trim()
            : null,
        sessionId: getPageViewSessionId(),
      }),
    onSuccess: () => {
      setErrorMessage(null);
    },
    onError: (error: unknown) => {
      setErrorMessage(getFeedbackErrorMessage(error));
    },
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setType(initialType);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentUrl(window.location.href);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail(defaultEmail ?? "");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetails("");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdditionalKeywords("");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorMessage(null);
    createFeedbackMutation.reset();
  }, [createFeedbackMutation.reset, defaultEmail, initialType, isOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createFeedbackMutation.isPending) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [createFeedbackMutation.isPending, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const selectedType = feedbackTypeMap[type];
  const canSubmit = Boolean(currentUrl.trim() && details.trim());

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-panel-deep/70 px-4 py-10 backdrop-blur-sm"
      onClick={() => {
        if (!createFeedbackMutation.isPending) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-surface shadow-2xl"
        style={{ maxHeight: "calc(100vh - 5rem)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
              Feedback
            </p>
            <h2 id="feedback-dialog-title" className="mt-1 text-2xl font-semibold text-slate-900">
              {createFeedbackMutation.isSuccess ? "Thanks for the feedback" : "Send feedback"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {createFeedbackMutation.isSuccess
                ? "Your submission was saved. We can follow up if you left an email."
                : "Choose the feedback type, review the current page URL, and send the details."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={createFeedbackMutation.isPending}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close feedback dialog"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {createFeedbackMutation.isSuccess ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                Your submission was saved for{" "}
                <strong>{feedbackTypeMap[createFeedbackMutation.data.type].label}</strong>.
              </div>
            </div>
            <div className="flex flex-shrink-0 justify-end border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-panel px-5 py-2.5 text-sm font-medium text-on-panel transition hover:bg-panel-raised"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              if (!createFeedbackMutation.isPending && canSubmit) {
                createFeedbackMutation.mutate();
              }
            }}
          >
            {/* Scrollable fields */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
              <fieldset>
                <legend className="text-sm font-medium text-slate-900">Type</legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {feedbackTypeOptions.map((option) => {
                    const isSelected = option.value === type;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setType(option.value)}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          isSelected
                            ? "border-sky-500 bg-sky-50 text-sky-950 shadow-sm"
                            : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-surface"
                        }`}
                        aria-pressed={isSelected}
                      >
                        <div className="text-sm font-semibold">{option.label}</div>
                        <p className="mt-1 text-xs leading-5 text-inherit/80">{option.helperText}</p>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <label htmlFor="feedback-current-url" className="block text-sm font-medium text-slate-900">
                  Current URL
                </label>
                <input
                  id="feedback-current-url"
                  type="url"
                  value={currentUrl}
                  readOnly
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700"
                />
                <p className="mt-2 text-xs text-slate-500">The current page URL is attached automatically.</p>
              </div>

              <div>
                <label htmlFor="feedback-email" className="block text-sm font-medium text-slate-900">
                  Email
                </label>
                <input
                  id="feedback-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Optional. Leave blank to stay anonymous."
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Optional. Clear this field if you want to submit without contact details.
                </p>
              </div>

              <div>
                <label htmlFor="feedback-details" className="block text-sm font-medium text-slate-900">
                  {selectedType.detailsLabel}
                </label>
                <textarea
                  id="feedback-details"
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={4}
                  placeholder={selectedType.detailsPlaceholder}
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
              </div>

              {type === "requestItems" && (
                <div>
                  <label htmlFor="feedback-keywords" className="block text-sm font-medium text-slate-900">
                    Additional keywords
                  </label>
                  <input
                    id="feedback-keywords"
                    type="text"
                    value={additionalKeywords}
                    onChange={(event) => setAdditionalKeywords(event.target.value)}
                    placeholder="Optional keywords, exam names, subjects, or tags"
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Optional. Add terms that make the requested topic easier to categorize.
                  </p>
                </div>
              )}

              {errorMessage && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {errorMessage}
                </div>
              )}
            </div>

            {/* Pinned action bar — always visible */}
            <div className="flex flex-shrink-0 flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={createFeedbackMutation.isPending}
                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || createFeedbackMutation.isPending}
                className="rounded-full bg-panel px-5 py-2.5 text-sm font-medium text-on-panel transition hover:bg-panel-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createFeedbackMutation.isPending ? "Submitting..." : "Submit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

function getFeedbackErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      return (
        error.response.data?.detail ??
        "Too many submissions from this user or IP. Please wait a few minutes and try again."
      );
    }

    if (typeof error.response?.data?.detail === "string") {
      return error.response.data.detail;
    }

    if (Array.isArray(error.response?.data) && error.response.data.length > 0) {
      const firstError = error.response.data[0];
      if (typeof firstError?.errorMessage === "string") {
        return firstError.errorMessage;
      }
      if (typeof firstError?.message === "string") {
        return firstError.message;
      }
    }
  }

  return "We could not submit your feedback. Please try again.";
}

export default FeedbackDialog;
