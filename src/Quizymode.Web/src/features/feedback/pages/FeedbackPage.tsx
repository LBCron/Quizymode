import { useState } from "react";
import { SEO } from "@/components/SEO";
import { useAuth } from "@/contexts/AuthContext";
import FeedbackDialog from "@/features/feedback/components/FeedbackDialog";
import { feedbackTypeOptions } from "@/features/feedback/feedbackTypes";
import type { FeedbackType } from "@/types/api";
import {
  BugAntIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

const FeedbackPage = () => {
  const { email } = useAuth();
  const [selectedType, setSelectedType] = useState<FeedbackType>("generalFeedback");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const cards: Array<{
    type: FeedbackType;
    title: string;
    description: string;
    icon: typeof BugAntIcon;
    accentClass: string;
  }> = [
    {
      type: "reportIssue",
      title: "Report an issue",
      description:
        "Capture bugs with the page URL attached automatically, plus optional contact details if you want a follow-up.",
      icon: BugAntIcon,
      accentClass: "border-rose-200 bg-rose-50 text-rose-600",
    },
    {
      type: "requestItems",
      title: "Ask for more items",
      description:
        "Request more questions for missing subjects, exams, or topics and include optional keywords for better routing.",
      icon: SparklesIcon,
      accentClass: "border-emerald-200 bg-emerald-50 text-emerald-600",
    },
    {
      type: "generalFeedback",
      title: "Provide feedback",
      description:
        "Share feature ideas, ask product questions, or send general feedback without leaving the app.",
      icon: ChatBubbleLeftRightIcon,
      accentClass: "border-sky-200 bg-sky-50 text-sky-600",
    },
  ];

  return (
    <>
      <SEO
        title="Quizymode Feedback"
        description="Share your feedback, report bugs, or suggest features for Quizymode. Your input helps make the platform better for everyone."
        canonical="https://www.quizymode.com/feedback"
      />
      <div className="mx-auto max-w-5xl rounded-[32px] bg-surface px-4 py-8 shadow-sm sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
            Feedback
          </p>
          <h1 className="mt-3 text-4xl font-bold text-gray-900">
            Share what should improve next
          </h1>
          <p className="mt-4 text-lg leading-8 text-gray-700">
            Quizymode is built iteratively. Use the in-app feedback flow to report bugs,
            request more study items, or send general product feedback without leaving the site.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;

            return (
              <section
                key={card.type}
                className="flex h-full flex-col rounded-3xl border border-slate-200 bg-slate-50 p-6"
              >
                <div
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border ${card.accentClass}`}
                >
                  <Icon className="h-6 w-6" aria-hidden />
                </div>
                <h2 className="mt-5 text-2xl font-semibold text-slate-900">{card.title}</h2>
                <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">
                  {card.description}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedType(card.type);
                    setIsDialogOpen(true);
                  }}
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-panel px-4 py-2.5 text-sm font-medium text-on-panel transition hover:bg-panel-raised"
                >
                  Open{" "}
                  {feedbackTypeOptions.find((option) => option.value === card.type)?.label}
                </button>
              </section>
            );
          })}
        </div>

        <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 px-6 py-5 text-sm text-slate-600">
          The form stores the current page URL automatically. Email is optional and can be
          cleared for anonymous submissions.
        </div>
      </div>
      <FeedbackDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        initialType={selectedType}
        defaultEmail={email}
      />
    </>
  );
};

export default FeedbackPage;
