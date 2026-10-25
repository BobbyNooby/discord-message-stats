/**
 * Empty states that name the next action.
 *
 * "No data" tells a reader that something is missing and nothing else. Each of
 * these says which of the three situations it is — nothing ingested, nothing
 * matching the filter, or every author switched off — and what to do about it.
 * Which of the three applies is decided here too, so no card invents its own
 * idea of "empty".
 */

import type { Payload } from "../api/types";
import type { Filters } from "../app/reducer";

export const EMPTY_DATABASE = "No messages yet — ingest, or upload a database from the Admin board.";

export const EMPTY_FILTER =
  "No messages match the active filters — widen the time range, or switch an author back on.";

export const EMPTY_AUTHORS = "No authors selected — switch one back on in the filters.";

/** For a panel backed by one rollup that has no rows at all. */
export function emptyFor(what: string): string {
  return `No ${what} yet — ingest, or upload a database from the Admin board.`;
}

/**
 * "All authors off" is not the same as "no data": one is a filter the reader
 * can undo, the other is an empty database. The panels say which (§11.2).
 */
export function noAuthorsSelected(payload: Payload, filters: Filters): boolean {
  return (
    payload.authors.length > 0 &&
    filters.active.length > 0 &&
    !filters.active.some(Boolean)
  );
}

/** Why a card drawn from the activity cells has nothing to show. */
export function emptyLabel(payload: Payload, filters: Filters): string {
  if (!payload.cells?.length) return EMPTY_DATABASE;
  return noAuthorsSelected(payload, filters) ? EMPTY_AUTHORS : EMPTY_FILTER;
}

/**
 * The cards with no date dimension still honour the author switch, because
 * showing global bars while every chip is off would be the silent-filter
 * failure §11.2 warns about. A time filter never empties them: they keep their
 * numbers, and the section note names them once.
 */
export function globalEmpty(payload: Payload, filters: Filters): string | null {
  if (!payload.cells?.length) return EMPTY_DATABASE;
  if (noAuthorsSelected(payload, filters)) return EMPTY_AUTHORS;
  return null;
}
