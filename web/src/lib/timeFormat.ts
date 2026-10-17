/**
 * How a clock is written, from `ui.time_format`.
 *
 * A display setting, so it changes labels only: 24-hour by default, or a 12-hour
 * clock with an `am`/`pm` suffix when the operator asked for one. Nothing here
 * converts a timezone — the stamp keeps the wall time the rollups recorded.
 */

export type TimeFormat = "24h" | "12h";

export const DEFAULT_TIME_FORMAT: TimeFormat = "24h";

/** "13:00" or "1pm" — hour axes, peaks and tooltips. */
export function hourLabel(hour: number, format: TimeFormat = DEFAULT_TIME_FORMAT): string {
  const whole = ((Math.floor(hour) % 24) + 24) % 24;
  if (format === "12h") {
    const suffix = whole < 12 ? "am" : "pm";
    return `${whole % 12 === 0 ? 12 : whole % 12}${suffix}`;
  }
  return `${String(whole).padStart(2, "0")}:00`;
}

/** "2026-10-17 00:00" or "2026-10-17 12:00 am" — the "as of" lines. */
export function stampLabel(
  stamp: string | null | undefined,
  format: TimeFormat = DEFAULT_TIME_FORMAT,
): string {
  if (!stamp) return "never";
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(stamp);
  if (!match) return stamp;
  const [, day, hours, minutes] = match;
  if (format !== "12h") return `${day} ${hours}:${minutes}`;
  const hour = Number(hours);
  const suffix = hour < 12 ? "am" : "pm";
  return `${day} ${hour % 12 === 0 ? 12 : hour % 12}:${minutes} ${suffix}`;
}

/** The format a payload asks for, defaulting to the config's own default. */
export function timeFormatOf(meta: { time_format?: string } | undefined): TimeFormat {
  return meta?.time_format === "12h" ? "12h" : DEFAULT_TIME_FORMAT;
}
