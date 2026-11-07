import { useId } from "react";
import type { StudyActivityDay } from "@/api/studySessions";
import {
  INTENSITY_LABELS,
  INTENSITY_LEVELS,
  buildCalendar,
  describeDay,
  formatDay,
  type CalendarCell,
  type IntensityLevel,
} from "./activityCalendar";

const LEVEL_CLASS: Record<IntensityLevel, string> = {
  0: "bg-gray-100 text-gray-400 border-gray-200",
  1: "bg-emerald-200 text-emerald-950 border-emerald-300",
  2: "bg-emerald-300 text-emerald-950 border-emerald-400",
  3: "bg-emerald-600 text-white border-emerald-700",
  4: "bg-emerald-800 text-white border-emerald-900",
};

const CELL = "relative flex h-4 w-4 items-center justify-center rounded-sm border text-[9px] font-semibold leading-none";

interface ActivityHeatmapProps {
  activity: StudyActivityDay[];
  /** Current UTC day, yyyy-MM-dd. */
  today: string;
  /** Show the daily-quiz marker in the legend (signed-in activity only). */
  showDailyMarker?: boolean;
}

/**
 * Last 26 weeks of study activity (issue #259). Not colour-only: every active day shows its session count, every cell
 * has a text name ("3 sessions on Oct 21"), and the same data is available as a list below the grid.
 */
export function ActivityHeatmap({ activity, today, showDailyMarker = false }: ActivityHeatmapProps) {
  const summaryId = useId();
  const calendar = buildCalendar(activity, today);
  const activeCells = calendar.weeks
    .flat()
    .filter((cell): cell is CalendarCell => cell !== null && (cell.sessions > 0 || cell.hasDaily));

  const summary =
    calendar.totalSessions === 0
      ? "No study sessions in the last 26 weeks."
      : `${calendar.totalSessions} ${calendar.totalSessions === 1 ? "session" : "sessions"} on ${calendar.activeDays} ${
          calendar.activeDays === 1 ? "day" : "days"
        } in the last 26 weeks.${
          calendar.busiest
            ? ` Busiest day: ${formatDay(calendar.busiest.date)} with ${calendar.busiest.sessions} ${
                calendar.busiest.sessions === 1 ? "session" : "sessions"
              }.`
            : ""
        }`;

  return (
    <div>
      <p id={summaryId} className="mb-2 text-sm text-gray-700">
        {summary}
      </p>
      {/* Focusable so keyboard users can scroll the calendar sideways on narrow screens. */}
      <div
        role="group"
        aria-label="Study activity calendar, last 26 weeks"
        aria-describedby={summaryId}
        tabIndex={0}
        className="max-w-full overflow-x-auto rounded-md pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <div className="inline-block min-w-max">
          <div className="relative mb-1 h-4 text-[10px] text-gray-500" aria-hidden="true">
            {calendar.monthLabels.map((month) => (
              <span key={`${month.weekIndex}-${month.label}`} className="absolute" style={{ left: month.weekIndex * 20 }}>
                {month.label}
              </span>
            ))}
          </div>
          <div className="flex gap-1" data-testid="heatmap-grid">
            {calendar.weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-1">
                {week.map((cell, dayIndex) =>
                  cell === null ? (
                    <span key={dayIndex} className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <span
                      key={cell.date}
                      role="img"
                      aria-label={describeDay(cell)}
                      title={describeDay(cell)}
                      data-date={cell.date}
                      data-level={cell.level}
                      className={`${CELL} ${LEVEL_CLASS[cell.level]}`}
                    >
                      {cell.sessions > 0 ? (cell.sessions > 9 ? "9+" : cell.sessions) : null}
                      {cell.hasDaily && (
                        <span
                          data-testid="daily-marker"
                          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-white bg-amber-500"
                        />
                      )}
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Legend" role="group">
        <span className="flex items-center gap-1">
          Fewer
          {INTENSITY_LEVELS.map((level) => (
            <span key={level} className="flex items-center gap-1">
              <span className={`${CELL} ${LEVEL_CLASS[level]}`} aria-hidden="true">
                {level > 0 ? level : null}
              </span>
              <span className="sr-only">{INTENSITY_LABELS[level]}</span>
            </span>
          ))}
          More
        </span>
        <span>Number in a square = sessions that day (9+ for more).</span>
        {showDailyMarker && (
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            Daily quiz completed
          </span>
        )}
      </div>

      {activeCells.length > 0 && (
        <details className="mt-3 text-sm text-gray-700">
          <summary className="cursor-pointer font-medium text-indigo-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            Show activity as a list
          </summary>
          <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5">
            {[...activeCells].reverse().map((cell) => (
              <li key={cell.date}>{describeDay(cell)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
