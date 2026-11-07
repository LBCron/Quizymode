import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/api/admin";
import ErrorMessage from "@/components/ErrorMessage";
import {
  diffPlanSettings,
  planFormFromSettings,
  studyGuidePlanSchema,
  type StudyGuidePlanForm,
} from "../studyGuidePlanSchema";

/** Tier defaults from the epic #203 product decisions (AC 6.6). */
const TIER_DEFAULTS = {
  free: { daily: 10, monthly: 60 },
  premium: { daily: 50, monthly: 1000 },
};

interface StudyGuidePlanSettingsProps {
  userId: string;
  settings: Record<string, string>;
}

export function StudyGuidePlanSettings({ userId, settings }: StudyGuidePlanSettingsProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<StudyGuidePlanForm>(() => planFormFromSettings(settings));
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const saveMutation = useMutation({
    mutationFn: async (changes: Array<{ key: string; value: string }>) => {
      for (const change of changes) {
        await adminApi.updateUserSetting(userId, change.key, change.value);
      }
    },
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["admin", "user-settings", userId] });
    },
    onError: () => setFormError("Failed to save the study guide plan."),
  });

  const defaults = form.premium ? TIER_DEFAULTS.premium : TIER_DEFAULTS.free;
  const changes = diffPlanSettings(settings, form);

  const update = (patch: Partial<StudyGuidePlanForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
    setFormError(null);
  };

  const handleSave = () => {
    const result = studyGuidePlanSchema.safeParse(form);
    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? "Invalid values.");
      return;
    }
    if (changes.length === 0) return;
    saveMutation.mutate(changes);
  };

  return (
    <section className="rounded-2xl border border-slate-200 p-4" aria-labelledby={`study-guide-plan-${userId}`}>
      <h3 id={`study-guide-plan-${userId}`} className="text-base font-semibold text-slate-900">
        Study guide plan
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Premium users start generation immediately and get {TIER_DEFAULTS.premium.daily} sections a day and{" "}
        {TIER_DEFAULTS.premium.monthly.toLocaleString()} a month (free: {TIER_DEFAULTS.free.daily} a day,{" "}
        {TIER_DEFAULTS.free.monthly} a month). Leave an override blank to use the plan default.
      </p>

      <div className="mt-4 space-y-4">
        <div className="flex items-center gap-2">
          <input
            id={`study-guide-premium-${userId}`}
            type="checkbox"
            checked={form.premium}
            onChange={(event) => update({ premium: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-indigo-ink focus:ring-indigo-500"
          />
          <label htmlFor={`study-guide-premium-${userId}`} className="text-sm font-medium text-slate-700">
            Premium
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div>
            <label htmlFor={`study-guide-daily-${userId}`} className="block text-sm font-medium text-slate-700 mb-1">
              Daily sections override
            </label>
            <input
              id={`study-guide-daily-${userId}`}
              type="number"
              min={0}
              max={100_000}
              inputMode="numeric"
              value={form.dailySections}
              placeholder={`Default ${defaults.daily}`}
              onChange={(event) => update({ dailySections: event.target.value })}
              className="w-44 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`study-guide-monthly-${userId}`} className="block text-sm font-medium text-slate-700 mb-1">
              Monthly sections override
            </label>
            <input
              id={`study-guide-monthly-${userId}`}
              type="number"
              min={0}
              max={100_000}
              inputMode="numeric"
              value={form.monthlySections}
              placeholder={`Default ${defaults.monthly.toLocaleString()}`}
              onChange={(event) => update({ monthlySections: event.target.value })}
              className="w-44 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <p className="text-sm text-slate-600">
          Effective limits:{" "}
          <span className="font-mono text-slate-900">
            {form.dailySections.trim() || defaults.daily} / day, {form.monthlySections.trim() || defaults.monthly} / month
          </span>
        </p>

        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending || changes.length === 0}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving..." : "Save plan"}
        </button>

        {formError && <ErrorMessage message={formError} />}
        {saved && (
          <p className="text-sm text-emerald-700" role="status">
            Study guide plan saved.
          </p>
        )}
      </div>
    </section>
  );
}
