/**
 * The numbers the Media & reactions cards draw.
 *
 * Everything here is a pure function of `(payload, filters)` so the panels
 * re-aggregate in the browser and never fetch on a filter change (§11.2). The
 * two doughnuts and the gauges read the filtered activity cells; the four
 * panels backed by `rollup_type`, `rollup_attachment`, `rollup_emoji` and
 * `rollup_reaction` have no date dimension and read the payload's global
 * arrays, so a time filter cannot move them — the Media section note says so
 * once (§11.1, §11.2).
 */
import {
  C_DAY,
  C_MEDIA,
  C_MSGS,
  C_REPLIES,
  type Cell,
  type Payload,
  type TypeRow,
} from "../api/types";
import type { Filters } from "../app/reducer";
import { emptyLabel } from "../lib/empty";
import { selectVisibleCells } from "./cells";

export type Row = { name: string; value: number };

/* ---------- cells: the two shares and the gauges ---------- */

export function mediaShare(cells: readonly Cell[]): {
  media: number;
  textOnly: number;
  total: number;
} {
  let media = 0;
  let total = 0;
  for (const cell of cells) {
    media += cell[C_MEDIA];
    total += cell[C_MSGS];
  }
  return { media, textOnly: total - media, total };
}

export function replyShare(cells: readonly Cell[]): {
  replies: number;
  standalone: number;
  total: number;
} {
  let replies = 0;
  let total = 0;
  for (const cell of cells) {
    replies += cell[C_REPLIES];
    total += cell[C_MSGS];
  }
  return { replies, standalone: total - replies, total };
}

export function totalMessages(cells: readonly Cell[]): number {
  return cells.reduce((sum, cell) => sum + cell[C_MSGS], 0);
}

/** Replies, media and active days as percentages of the filtered window. */
export function healthGauges(cells: readonly Cell[]): Row[] {
  let msgs = 0;
  let replies = 0;
  let media = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const days = new Set<number>();
  for (const cell of cells) {
    msgs += cell[C_MSGS];
    replies += cell[C_REPLIES];
    media += cell[C_MEDIA];
    days.add(cell[C_DAY]);
    first = Math.min(first, cell[C_DAY]);
    last = Math.max(last, cell[C_DAY]);
  }
  // The span is the filtered window itself, so a year filter cannot report a
  // handful of active days against six years of history.
  const span = days.size > 0 ? last - first + 1 : 0;
  return [
    { name: "Replies", value: msgs > 0 ? (100 * replies) / msgs : 0 },
    { name: "With media", value: msgs > 0 ? (100 * media) / msgs : 0 },
    { name: "Active days", value: span > 0 ? Math.min(100, (100 * days.size) / span) : 0 },
  ];
}

/**
 * The cells a cell-backed panel may use, plus the reason to render an empty
 * state instead. One function, so no panel invents its own idea of "empty".
 */
export function mediaCells(
  payload: Payload,
  filters: Filters,
): { cells: readonly Cell[]; empty: string | null } {
  const cells = payload.cells?.length ? selectVisibleCells(payload, filters) : [];
  return cells.length ? { cells, empty: null } : { cells: [], empty: emptyLabel(payload, filters) };
}

/* ---------- the global arrays: types, attachments, emoji, reactions ---------- */

export function allTypeRows(payload: Payload): Row[] {
  const types: TypeRow[] = payload.types?.length ? payload.types : (payload.meta?.types ?? []);
  return types
    .filter((row) => row[2] > 0)
    .slice()
    .sort((a, b) => b[2] - a[2])
    .map((row) => ({ name: row[1], value: row[2] }));
}

/** Every pair the payload carries, in the order the payload ranked it. */
export function allPairRows(pairs: [string, number][] | undefined): Row[] {
  return (pairs ?? [])
    .filter(([, count]) => count > 0)
    .map(([name, value]) => ({ name, value }));
}

export function pairRows(pairs: [string, number][] | undefined, limit: number): Row[] {
  return allPairRows(pairs).slice(0, limit);
}

export function sumRows(rows: Row[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

/** The whole global array, not just the rows a bar chart chooses to show. */
export function pairTotal(pairs: [string, number][] | undefined): number {
  return (pairs ?? []).reduce((sum, [, count]) => sum + count, 0);
}

export function pairCount(pairs: [string, number][] | undefined): number {
  return (pairs ?? []).filter(([, count]) => count > 0).length;
}
