/** "new" when the previous window is zero (never an infinite percentage); null when nothing to compare. */
export function formatChange(current: number, previous: number): string | null {
  if (previous === 0) {
    return current === 0 ? null : "new";
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export interface ReleaseLabel {
  x: number;
  text: string;
  versions: string[];
  row: number;
  anchor: "start" | "end";
}

/**
 * Lays out release-marker labels on the daily chart: markers on the same day share one label,
 * labels that would run past `rightEdge` are right-aligned to their marker, and a label that would
 * overlap the previous one moves to the next free row (the last row takes any overflow).
 */
export function layoutReleaseLabels(
  markers: Array<{ x: number; version: string }>,
  rightEdge: number,
  { charWidth = 5, gap = 4, maxRows = 3 }: { charWidth?: number; gap?: number; maxRows?: number } = {}
): ReleaseLabel[] {
  const byX = new Map<number, string[]>();
  for (const marker of [...markers].sort((a, b) => a.x - b.x)) {
    const key = Math.round(marker.x);
    byX.set(key, [...(byX.get(key) ?? []), marker.version]);
  }

  const rowEnds: number[] = [];
  const labels: ReleaseLabel[] = [];
  for (const [x, versions] of byX) {
    const text = versions.map((version) => `v${version}`).join(", ");
    const width = text.length * charWidth;
    const anchor = x + 2 + width > rightEdge ? "end" : "start";
    const start = anchor === "start" ? x + 2 : x - 2 - width;
    let row = rowEnds.findIndex((end) => end + gap <= start);
    if (row === -1) {
      row = rowEnds.length < maxRows ? rowEnds.length : maxRows - 1;
    }
    rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, start + width);
    labels.push({ x, text, versions, row, anchor });
  }
  return labels;
}

/** "less than a minute" / "5 minutes" / "1 hour" / "3 days" for an elapsed number of seconds. */
export function formatAge(seconds: number): string {
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds < 60) return "less than a minute";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/** Seconds elapsed since an ISO timestamp (never negative). */
export function secondsSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
}
