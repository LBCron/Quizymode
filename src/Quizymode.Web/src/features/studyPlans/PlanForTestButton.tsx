import { useState } from "react";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { StudyPlanDialog, type StudyPlanDialogResult } from "./StudyPlanDialog";
import { useCollectionStudyPlan } from "./useStudyPlans";
import { daysUntil, formatLongDate, formatShortDate, localDateFromString } from "./studyPlanSteps";

/**
 * Collection page entry to the test-date plan (#364, AC 3.23.5): "Plan for a test", or "Test plan: Fri, Nov 6" once a plan
 * exists. A persistent polite status region announces "saved" and "removed" after the dialog has closed.
 */
export function PlanForTestButton({ collectionId, collectionName }: { collectionId: string; collectionName: string }) {
  const { plan, loading } = useCollectionStudyPlan(collectionId);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");

  const planDate = plan && (daysUntil(plan.testDate, new Date()) ?? -1) >= 0 ? localDateFromString(plan.testDate) : null;
  const activePlan = planDate ? plan : null;

  const onClose = (result?: StudyPlanDialogResult) => {
    setOpen(false);
    if (result?.kind === "saved") {
      const saved = localDateFromString(result.testDate);
      setStatus(saved ? `Test plan saved for ${formatLongDate(saved)}.` : "Test plan saved.");
    } else if (result?.kind === "removed") {
      setStatus("Test plan removed.");
    }
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={planDate ? `Test plan: ${formatLongDate(planDate)}. Edit` : undefined}
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-[44px] items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium ${
          planDate
            ? "border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        <CalendarDaysIcon className="h-4 w-4" aria-hidden="true" />
        {planDate ? `Test plan: ${formatShortDate(planDate)}` : "Plan for a test"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      {open && (
        <StudyPlanDialog
          collectionId={collectionId}
          collectionName={collectionName}
          plan={activePlan}
          loading={loading}
          onClose={onClose}
        />
      )}
    </>
  );
}
