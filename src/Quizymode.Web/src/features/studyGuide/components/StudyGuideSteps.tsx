export type StudyGuideStep = "add" | "coverage" | "review";

const STEPS: { key: StudyGuideStep; label: string }[] = [
  { key: "add", label: "Add material" },
  { key: "coverage", label: "Choose coverage" },
  { key: "review", label: "Review" },
];

interface StudyGuideStepsProps {
  current: StudyGuideStep;
}

export function StudyGuideSteps({ current }: StudyGuideStepsProps) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);

  return (
    <nav aria-label="Progress" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = index < currentIndex;
          return (
            <li
              key={step.key}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex items-center gap-2 ${
                isCurrent ? "font-semibold text-indigo-ink" : isDone ? "text-gray-700" : "text-gray-500"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                  isCurrent
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : isDone
                      ? "border-indigo-300 bg-indigo-50 text-indigo-ink"
                      : "border-gray-300 text-gray-500"
                }`}
              >
                {index + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
