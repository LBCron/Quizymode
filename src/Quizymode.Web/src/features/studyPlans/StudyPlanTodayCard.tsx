import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import type { PlanView } from "./useStudyPlans";
import {
  NEXT_STEP_NAME,
  countdownLabel,
  daysUntil,
  deriveToday,
  estimateMinutes,
  formatShortDate,
  localDateFromString,
  type StepKind,
} from "./studyPlanSteps";

const shellClass =
  "rounded-[18px] border border-white/10 bg-gradient-to-br from-emerald-500/20 to-sky-500/10 p-3";
const linkShellClass = `${shellClass} hover:border-emerald-300/60 focus-within:ring-2 focus-within:ring-emerald-200`;
const pillClass =
  "relative z-10 inline-flex min-h-[44px] items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200";
const stretchedLinkClass =
  "flex items-center justify-between gap-3 focus-visible:outline-none after:absolute after:inset-0 after:rounded-[18px]";

interface Pill {
  label: string;
  ariaLabel: string;
  to: string;
}

interface CardModel {
  title: string;
  detail: string;
  action: string | null;
  to: string | null;
  pill: Pill | null;
}

function pathFor(step: StepKind, plan: PlanView): string {
  const { collectionId: id, collectionName: name } = plan;
  if (step === "learn") return buildCollectionStudyPath("learn", id, name);
  if (step === "practice-test") return `${buildCollectionStudyPath("quiz", id, name)}?mode=test`;
  if (step === "test-day") return buildCollectionStudyPath("explore", id, name);
  return buildCollectionStudyPath("quiz", id, name);
}

function describe(plan: PlanView, now: Date, isGuest: boolean): CardModel | null {
  const today = deriveToday(plan, now);
  if (!today) return null;
  const name = plan.collectionName ?? "this collection";
  const minutes = estimateMinutes(today.step, plan.itemCount);

  if (plan.itemCount === 0) {
    return {
      title: "Nothing to study yet",
      detail: "This collection has no questions yet.",
      action: "Open",
      to: buildCollectionPath(plan.collectionId, plan.collectionName),
      pill: null,
    };
  }

  if (today.done) {
    return {
      title: "Done for today ✓",
      detail: today.tomorrow ? `Tomorrow: ${NEXT_STEP_NAME[today.tomorrow]}.` : "",
      action: null,
      to: null,
      pill: { label: "Practice again", ariaLabel: `Practice again: ${name}`, to: pathFor(today.step, plan) },
    };
  }

  switch (today.step) {
    case "learn":
      return {
        title: "Learn the basics",
        detail: `About ${minutes} min. Go through the new questions.`,
        action: "Learn",
        to: pathFor("learn", plan),
        pill: null,
      };
    case "review":
      return {
        title: "Practice quiz",
        detail: isGuest
          ? `About ${minutes} min. Quiz yourself on the full set.`
          : `About ${minutes} min. Misses go to your Review queue.`,
        action: "Practice",
        to: pathFor("review", plan),
        pill: null,
      };
    case "practice-test":
      return {
        title: "Timed practice test",
        detail: `About ${minutes} min. A dress rehearsal for tomorrow.`,
        action: "Start",
        to: pathFor("practice-test", plan),
        pill: today.learnedBefore
          ? null
          : { label: "Learn first", ariaLabel: `Learn first: ${name}`, to: pathFor("learn", plan) },
      };
    case "test-day":
      return {
        title: "Test day. Good luck!",
        detail: "Want a quick warm up?",
        action: null,
        to: null,
        pill: { label: "Warm up", ariaLabel: `Warm up: ${name}`, to: pathFor("test-day", plan) },
      };
    case "rest": {
      const next = today.nextStepDate ? localDateFromString(today.nextStepDate) : null;
      return {
        title: "Rest day",
        detail: next ? `Next step: ${formatShortDate(next)}. Nothing to do today.` : "Nothing to do today.",
        action: null,
        to: null,
        pill: { label: "Review anyway", ariaLabel: `Review anyway: ${name}`, to: pathFor("review", plan) },
      };
    }
  }
}

function CardLines({ plan, countdown, model }: { plan: PlanView; countdown: string; model: CardModel }) {
  const name = plan.collectionName ?? "Unknown collection";
  return (
    <span className="min-w-0">
      <span className="block truncate text-xs text-slate-300" title={name}>
        {name} · {countdown}
      </span>
      <span className="block text-sm font-semibold text-white">{model.title}</span>
      {model.detail && <span className="block text-xs text-slate-200">{model.detail}</span>}
    </span>
  );
}

function Action({ label }: { label: string }): ReactNode {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-200">
      {label}
      <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}

/** One test-date plan on the Home Today lane (#364, AC 3.23.7). Renders nothing once the test date has passed. */
export function StudyPlanTodayCard({
  plan,
  isGuest,
  onRemove,
  now = new Date(),
}: {
  plan: PlanView;
  isGuest: boolean;
  onRemove: (collectionId: string) => void;
  now?: Date;
}) {
  const daysLeft = daysUntil(plan.testDate, now);
  if (daysLeft === null || daysLeft < 0) return null;
  const countdown = countdownLabel(daysLeft, plan.testDate);

  if (!plan.available) {
    const model: CardModel = {
      title: "Test plan",
      detail: "This collection is no longer available.",
      action: null,
      to: null,
      pill: null,
    };
    return (
      <div className={`${shellClass} flex items-center justify-between gap-3`}>
        <CardLines plan={plan} countdown={countdown} model={model} />
        <button
          type="button"
          aria-label="Remove test plan for this collection"
          onClick={() => onRemove(plan.collectionId)}
          className={`${pillClass} shrink-0`}
        >
          Remove plan
        </button>
      </div>
    );
  }

  const model = describe(plan, now, isGuest);
  if (!model) return null;

  if (model.to) {
    return (
      <div className={`relative ${linkShellClass}`}>
        <Link to={model.to} className={stretchedLinkClass}>
          <CardLines plan={plan} countdown={countdown} model={model} />
          {model.action && <Action label={model.action} />}
        </Link>
        {model.pill && (
          <Link to={model.pill.to} aria-label={model.pill.ariaLabel} className={`${pillClass} mt-1`}>
            {model.pill.label}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <CardLines plan={plan} countdown={countdown} model={model} />
      {model.pill && (
        <div className="mt-1">
          <Link to={model.pill.to} aria-label={model.pill.ariaLabel} className={pillClass}>
            {model.pill.label}
          </Link>
        </div>
      )}
    </div>
  );
}
