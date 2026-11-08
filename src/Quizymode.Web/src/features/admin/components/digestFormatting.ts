const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 2 * 60 * 1000;

/** Date and time in the digest zone (matching the email), with the zone label. */
export function formatInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

/** Value for a datetime-local input (browser time zone, second precision). */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Returns the first problem with a send-now window, mirroring the API rules, or null. */
export function validateWindow(from: Date, to: Date, now: Date): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Enter both a From and a To time.";
  }
  if (from.getTime() >= to.getTime()) {
    return "From must be before To.";
  }
  if (to.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return "To must not be in the future.";
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    return "The window can be at most 31 days.";
  }
  return null;
}
