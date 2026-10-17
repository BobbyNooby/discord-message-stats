import {
  C_AUTHOR,
  C_CHARS,
  C_DAY,
  C_EDITS,
  C_MEDIA,
  C_MSGS,
  C_REPLIES,
  type Author,
  type Cell,
  type Payload,
} from "../api/types";
import type { FilterPatch, Filters } from "./reducer";

/**
 * The one resolver every card calls: the global filters with a card's own patch
 * composed over them. Pure — neither argument is touched, and the arrays a
 * patch carries are copied so no two cards can share one and drift.
 */
export function effective(global: Filters, patch?: FilterPatch): Filters {
  if (!patch) return global;
  const keys = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (!keys.length) return global;
  const merged = { ...global, ...patch };
  return {
    ...merged,
    years: merged.years ? [...merged.years] : merged.years,
    active: merged.active ? [...merged.active] : merged.active,
  };
}

export type Totals = {
  msgs: number;
  chars: number;
  days: number;
  authors: number;
  media: number;
  replies: number;
  edits: number;
};

const ZERO: Totals = { msgs: 0, chars: 0, days: 0, authors: 0, media: 0, replies: 0, edits: 0 };

export function yearOf(day: string): number {
  return Number(day.slice(0, 4));
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The bucket a day falls in, for the x axis. */
export function bucketOf(day: string, bucket: Filters["bucket"]): string {
  return bucket === "day" ? day : bucket === "month" ? monthOf(day) : day.slice(0, 4);
}

export function inRange(payload: Payload, filters: Filters, dayIndex: number): boolean {
  const day = payload.days[dayIndex];
  if (!day) return false;
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  if (filters.years.length && !filters.years.includes(yearOf(day))) return false;
  return true;
}

/**
 * The cells every panel reads. One function, so no panel can invent its own
 * idea of what a filter means.
 */
export function selectVisibleCells(payload: Payload, filters: Filters): Cell[] {
  const active = filters.active;
  return payload.cells.filter(
    (cell) => active[cell[C_AUTHOR]] !== false && inRange(payload, filters, cell[C_DAY]),
  );
}

export function selectTotals(payload: Payload, filters: Filters): Totals {
  const cells = selectVisibleCells(payload, filters);
  if (!cells.length) return { ...ZERO };
  const totals = { ...ZERO };
  const days = new Set<number>();
  const authors = new Set<number>();
  for (const cell of cells) {
    totals.msgs += cell[C_MSGS];
    totals.chars += cell[C_CHARS];
    totals.media += cell[C_MEDIA];
    totals.replies += cell[C_REPLIES];
    totals.edits += cell[C_EDITS];
    days.add(cell[C_DAY]);
    authors.add(cell[C_AUTHOR]);
  }
  totals.days = days.size;
  totals.authors = authors.size;
  return totals;
}

/** Authors in payload order, each with its filtered totals. */
export function selectAuthors(payload: Payload, filters: Filters): (Author & Totals)[] {
  const per = new Map<number, Totals>();
  for (const cell of selectVisibleCells(payload, filters)) {
    const index = cell[C_AUTHOR];
    const totals = per.get(index) ?? { ...ZERO };
    totals.msgs += cell[C_MSGS];
    totals.chars += cell[C_CHARS];
    totals.media += cell[C_MEDIA];
    totals.replies += cell[C_REPLIES];
    totals.edits += cell[C_EDITS];
    per.set(index, totals);
  }
  return payload.authors.map((author, index) => ({ ...author, ...(per.get(index) ?? { ...ZERO }) }));
}
