/**
 * Empty states that name the next action.
 *
 * "No data" tells a reader that something is missing and nothing else. Each of
 * these says which of the three situations it is — nothing ingested, nothing
 * matching the filter, or every author switched off — and what to do about it.
 */

export const EMPTY_DATABASE = "No messages yet — ingest, or upload a database from the Admin board.";

export const EMPTY_FILTER =
  "No messages match the active filters — widen the time range, or switch an author back on.";

export const EMPTY_AUTHORS = "No authors selected — switch one back on in the filters.";

/** For a panel backed by one rollup that has no rows at all. */
export function emptyFor(what: string): string {
  return `No ${what} yet — ingest, or upload a database from the Admin board.`;
}
