/**
 * The numbers the Time & rhythm cards draw.
 *
 * Every card is a pure function of `(payload, filters)` (§11.2), so the
 * bucketing lives here once — otherwise two cards could disagree about what "a
 * month" means.
 */
import { C_AUTHOR, C_DAY, C_MSGS, C_REPLIES, type Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { bucketOf, selectVisibleCells } from "./cells";

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function pct(part: number, whole: number): number {
  return whole ? (100 * part) / whole : 0;
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

export type RepliesByBucket = {
  /** The x axis: one sorted entry per bucket with messages. */
  order: string[];
  /** Replies as a percentage of each bucket's messages, to two decimals. */
  series: number[];
  msgs: number;
  replies: number;
};

/** Replies per bucket as a share of that bucket's messages. */
export function repliesByBucket(payload: Payload, filters: Filters): RepliesByBucket {
  const sums = new Map<string, number>();
  const replies = new Map<string, number>();
  const order: string[] = [];
  let msgs = 0;
  let replyCount = 0;

  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const key = bucketOf(day, filters.bucket);
    if (!sums.has(key)) order.push(key);
    sums.set(key, (sums.get(key) ?? 0) + cell[C_MSGS]);
    replies.set(key, (replies.get(key) ?? 0) + cell[C_REPLIES]);
    msgs += cell[C_MSGS];
    replyCount += cell[C_REPLIES];
  }
  order.sort();

  const series = order.map((key) => {
    const total = sums.get(key) ?? 0;
    return total ? Number(pct(replies.get(key) ?? 0, total).toFixed(2)) : 0;
  });
  return { order, series, msgs, replies: replyCount };
}

export type MonthTotals = {
  /** Messages per calendar month, January first, every year pooled. */
  months: number[];
  /** How many distinct years contributed. */
  years: number;
  total: number;
};

export function monthTotals(payload: Payload, filters: Filters): MonthTotals {
  const months = new Array<number>(12).fill(0);
  const years = new Set<string>();
  let total = 0;
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const month = Number(day.slice(5, 7)) - 1;
    if (month < 0 || month > 11) continue;
    months[month] += cell[C_MSGS];
    total += cell[C_MSGS];
    years.add(day.slice(0, 4));
  }
  return { months, years: years.size, total };
}
