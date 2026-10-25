/**
 * How a number reads on a card, said once. The mockup's `fmt`, `kfmt` and `dur`
 * were copied into nine panels and had drifted on negatives; this is the one
 * copy. Grouping is US English on purpose, so a figure reads the same in every
 * browser rather than following the reader's locale.
 */

/** A whole number with thousands separators: "17,135". */
export function fmt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/**
 * The compact form an axis has room for: "950", "12.3k", "1.2M". The suffix is
 * chosen by size, not sign, so a negative reads "-1.5k" rather than "-1500".
 */
export function kfmt(value: number): string {
  const rounded = Math.round(value);
  const size = Math.abs(rounded);
  if (size >= 1e6) return `${(rounded / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (size >= 1e3) return `${(rounded / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(rounded);
}

/** A wait in the coarsest unit that still keeps a decimal: "45s", "3.5m", "2.1h". */
export function dur(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 90) return `${seconds.toFixed(0)}s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** A share as a subtitle prints it: one decimal, and 0 rather than NaN. */
export function pctOf(part: number, whole: number): string {
  return whole > 0 ? ((100 * part) / whole).toFixed(1) : "0.0";
}
