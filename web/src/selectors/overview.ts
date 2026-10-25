/**
 * The numbers behind the Overview cards, as pure functions of the payload and
 * the filters a card is under, so each card can memoise them and the tests can
 * check them without a chart.
 */
import { C_AUTHOR, C_DAY, C_MSGS, type Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { selectAuthors, selectVisibleCells, yearOf } from "./cells";

/** One author's share of the messages in view. */
export type VoiceRow = { name: string; value: number; index: number };

/** One row per author with messages in view, busiest first. */
export function voiceRows(payload: Payload, filters: Filters): VoiceRow[] {
  return selectAuthors(payload, filters)
    .map((author, index) => ({ name: author.name, value: author.msgs, index }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

export type YearTotals = { years: number[]; values: number[]; total: number };

/** Filtered messages per calendar year, years ascending. */
export function yearTotals(payload: Payload, filters: Filters): YearTotals {
  const byYear = new Map<number, number>();
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const year = yearOf(day);
    byYear.set(year, (byYear.get(year) ?? 0) + cell[C_MSGS]);
  }
  const years = [...byYear.keys()].sort();
  const values = years.map((year) => byYear.get(year) ?? 0);
  return { years, values, total: values.reduce((sum, value) => sum + value, 0) };
}

export type YearMix = {
  years: number[];
  /** Year to author index to messages. */
  byYear: Map<number, Map<number, number>>;
  total: number;
};

/** Each author's filtered messages, year by year, years ascending. */
export function yearMix(payload: Payload, filters: Filters): YearMix {
  const byYear = new Map<number, Map<number, number>>();
  let total = 0;
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const year = yearOf(day);
    const authors = byYear.get(year) ?? new Map<number, number>();
    authors.set(cell[C_AUTHOR], (authors.get(cell[C_AUTHOR]) ?? 0) + cell[C_MSGS]);
    byYear.set(year, authors);
    total += cell[C_MSGS];
  }
  return { years: [...byYear.keys()].sort(), byYear, total };
}
