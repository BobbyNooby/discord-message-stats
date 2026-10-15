import { C_DAY, C_MSGS, type Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { selectVisibleCells } from "../filters/selectors";

/** Default visible weeks, and the smallest window worth drawing (§11.3). */
export const DEFAULT_WEEKS = 60;
export const MIN_WEEKS = 6;
export const MAX_CELL_PX = 26;

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type Geometry = { cell: number; grid: { width: number; height: number }; height: number };

/**
 * Square cells, which is only computable because the number of visible columns
 * is known. This is the calculation §11.3 spells out, kept pure so it can be
 * tested without a browser: `cell = min(availableWidth / calSize, 26px)`,
 * `grid = { width: cell * calSize, height: cell * 7 }`, and the container is
 * exactly the grid plus margins so there is no dead space.
 */
export function calendarGeometry(availableWidth: number, calSize: number): Geometry {
  const columns = Math.max(MIN_WEEKS, Math.floor(calSize));
  const cell = Math.max(1, Math.min(availableWidth / columns, MAX_CELL_PX));
  const grid = { width: cell * columns, height: cell * 7 };
  return { cell, grid, height: grid.height + 56 };
}

/** The Sunday that starts the week containing `day`. */
export function weekStartOf(day: string): number {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.getTime();
}

export type WeekGrid = {
  weeks: string[];              // week-start ISO dates, ascending
  values: Map<string, number>;  // `${week}|${dow}` -> messages
  total: number;
};

/** Filtered messages per (week, weekday) — the only aggregation the calendar does. */
export function buildWeeks(payload: Payload, filters: Filters): WeekGrid {
  const values = new Map<string, number>();
  let total = 0;
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (!day) continue;
    const week = new Date(weekStartOf(day)).toISOString().slice(0, 10);
    const key = `${week}|${new Date(`${day}T00:00:00Z`).getUTCDay()}`;
    values.set(key, (values.get(key) ?? 0) + cell[C_MSGS]);
    total += cell[C_MSGS];
  }
  const weeks = [...new Set([...values.keys()].map((key) => key.split("|")[0]))].sort();
  return { weeks, values, total };
}

/** Which slice of weeks is on screen: the newest window by default. */
export function clampStart(start: number, calSize: number, weekCount: number): number {
  const maxStart = Math.max(0, weekCount - calSize);
  return Math.min(Math.max(0, Math.floor(start)), maxStart);
}
