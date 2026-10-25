import { C_AUTHOR, C_DAY, C_MSGS, type Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { bucketOf, selectVisibleCells } from "../filters/selectors";
import { swatch } from "../lib/palette";

/**
 * The shapes the Overview and Time & rhythm panels share.
 *
 * Every panel is a pure function of `(payload, filters)` (§11.2), so the
 * bucketing, the empty-state wording and the chart chrome live here once —
 * otherwise two panels could disagree about what "a month" means.
 */

export type PanelProps = { payload: Payload; filters: Filters };

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function pct(part: number, whole: number): number {
  return whole ? (100 * part) / whole : 0;
}

export function bucketCountLabel(count: number, bucket: Filters["bucket"]): string {
  const noun = bucket === "day" ? "days" : bucket === "month" ? "months" : "years";
  return `${count} ${count === 1 ? noun.replace(/s$/, "") : noun}`;
}

export function yearCountLabel(count: number): string {
  return `${count} ${count === 1 ? "year" : "years"}`;
}

/** Author indices the filters leave visible, in payload order. */
export function activeAuthorIndices(payload: Payload, filters: Filters): number[] {
  return payload.authors
    .map((_, index) => index)
    .filter((index) => filters.active[index] !== false);
}

export type BucketSeries = {
  /** The x axis, sorted — one entry per bucket with data. */
  order: string[];
  /** msgs per author per bucket, keyed by author index. */
  per: Record<number, Record<string, number>>;
  sums: Record<string, number>;
  total: number;
};

/** `seriesByBucket` from the mockup: the x axis every trend panel reads. */
export function bucketSeries(payload: Payload, filters: Filters): BucketSeries {
  const sums: Record<string, number> = {};
  const per: Record<number, Record<string, number>> = {};
  const order: string[] = [];
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const key = bucketOf(day, filters.bucket);
    if (!(key in sums)) {
      sums[key] = 0;
      order.push(key);
    }
    sums[key] += cell[C_MSGS];
    const byAuthor = (per[cell[C_AUTHOR]] ??= {});
    byAuthor[key] = (byAuthor[key] ?? 0) + cell[C_MSGS];
  }
  order.sort();
  const total = order.reduce((sum, key) => sum + sums[key], 0);
  return { order, per, sums, total };
}

export type HeatGrid = {
  /** dow * 24 + hour, summed over the visible authors and years. */
  grid: Float64Array;
  max: number;
  total: number;
  peakDow: number;
  peakHour: number;
};

/**
 * `rollup_heat` has no day dimension, so it can only honour the year part of a
 * range (§11.1 lists its time filter as "year").
 */
export function yearVisible(year: number, filters: Filters): boolean {
  if (filters.years.length && !filters.years.includes(year)) return false;
  if (filters.from && year < Number(filters.from.slice(0, 4))) return false;
  if (filters.to && year > Number(filters.to.slice(0, 4))) return false;
  return true;
}

export function heatGrid(payload: Payload, filters: Filters): HeatGrid {
  const grid = new Float64Array(7 * 24);
  let max = 0;
  let total = 0;
  let peakDow = 0;
  let peakHour = 0;
  for (const [dow, hour, author, year, msgs] of payload.heat) {
    if (filters.active[author] === false || !yearVisible(year, filters)) continue;
    const key = dow * 24 + hour;
    grid[key] += msgs;
    total += msgs;
    if (grid[key] > max) {
      max = grid[key];
      peakDow = dow;
      peakHour = hour;
    }
  }
  return { grid, max, total, peakDow, peakHour };
}

export function byHour(grid: Float64Array): number[] {
  const hours = new Array<number>(24).fill(0);
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) hours[hour] += grid[dow * 24 + hour];
  }
  return hours;
}

/** The neutral slice a folded tail gets, so it never looks like a real author.
 * A function so a fork's `--chart-12` reaches it — a constant would freeze the
 * fallback at import time. */
export const otherColor = () => swatch(11);

export type Slice = { name: string; value: number; index: number };

/**
 * §11.5: a doughnut is for a part-of-whole with few categories. Share of voice
 * is a part-of-whole, but a chat can have a dozen authors, so the tail folds
 * into one "Others" slice rather than growing a twelfth indistinguishable
 * wedge. Everything past the fold is still in the total and the tooltip.
 */
export function foldSlices(rows: Slice[], max = 6): Slice[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  return [
    ...head,
    { name: "Others", value: tail.reduce((sum, row) => sum + row.value, 0), index: -1 },
  ];
}
