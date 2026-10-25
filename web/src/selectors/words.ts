/**
 * The numbers the word cards draw, from the payload's word slice or a period's.
 */
import type { Payload } from "../api/types";
import type { Filters } from "../app/reducer";
import { authorIndexById } from "./months";

const TOP_WORDS = 18;
/** Above 4× the heat scale stops meaning anything and one word flattens the rest. */
const LIFT_CAP = 4;
/** How many words the cloud has room for. */
const CLOUD_WORDS = 120;

/** [author x, word y, lift] for the heatmap. */
export type LiftCell = [number, number, number];

export type LiftGrid = { names: string[]; words: string[]; cells: LiftCell[] };

/**
 * Lift is the one number here that needs the payload's per-author totals rather
 * than the word's own count: a word is only a signature of somebody if they use
 * it more often than they use words in general, so the denominator is
 * `authorWordTotals[author]`, not the grand total.
 */
export function liftGrid(payload: Payload, filters: Filters, top = TOP_WORDS): LiftGrid {
  const words = payload.words.slice(0, top);
  const grand = payload.authorWordTotals.reduce((a, b) => a + b, 0) || 1;
  const active: number[] = [];
  payload.authors.forEach((_, index) => {
    if (filters.active[index] !== false) active.push(index);
  });

  const cells: LiftCell[] = [];
  words.forEach((entry, wordIndex) => {
    const word = entry[0];
    const usesTotal = entry[1];
    const byAuthor = new Map(payload.wordAuthors[word] ?? []);
    active.forEach((authorIndex, x) => {
      const uses = byAuthor.get(authorIndex) ?? 0;
      const share = uses / (payload.authorWordTotals[authorIndex] || 1);
      const expected = usesTotal / grand;
      cells.push([x, wordIndex, expected > 0 ? Math.min(share / expected, LIFT_CAP) : 0]);
    });
  });

  return { names: active.map((index) => payload.authors[index].name), words: words.map((w) => w[0]), cells };
}

export type WhoSaysItRow = { name: string; value: number; index: number };

/** The selected word's rows, filtered to the authors still switched on. */
export function whoSaysItRows(payload: Payload, filters: Filters, word: string | null): WhoSaysItRow[] {
  if (!word) return [];
  return (payload.wordAuthors[word] ?? [])
    .filter(([authorIndex]) => filters.active[authorIndex] !== false)
    .map(([authorIndex, uses]) => ({
      name: payload.authors[authorIndex]?.name ?? `#${authorIndex}`,
      value: uses,
      index: authorIndex,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => a.value - b.value);
}

/** The same rows from the server's answer, for a word outside the slice. */
export function remoteRows(
  payload: Payload,
  filters: Filters,
  authors: { id: string; count: number }[],
): WhoSaysItRow[] {
  const byId = authorIndexById(payload.authors);
  const combined = new Map<number, number>();
  for (const author of authors) {
    const index = byId.get(author.id);
    if (index === undefined || filters.active[index] === false) continue;
    combined.set(index, (combined.get(index) ?? 0) + author.count);
  }
  return [...combined.entries()]
    .map(([index, value]) => ({ name: payload.authors[index]?.name ?? `#${index}`, value, index }))
    .filter((row) => row.value > 0)
    .sort((a, b) => a.value - b.value);
}

/**
 * The words the cloud draws. `rollup_word` carries no date dimension, but it does
 * carry a per-author breakdown for 420 of the 500 shipped words, so a restricted
 * author selection is applied where the data allows it.
 */
export function cloudRows(payload: Payload, filters: Filters, limit = CLOUD_WORDS): [string, number][] {
  const allOn = payload.authors.every((_, index) => filters.active[index] !== false);
  if (allOn) return payload.words.slice(0, limit);

  const rows: [string, number][] = [];
  for (const [word] of payload.words) {
    const byAuthor = payload.wordAuthors[word];
    if (!byAuthor) continue;
    let uses = 0;
    for (const [authorIndex, count] of byAuthor) {
      if (filters.active[authorIndex] !== false) uses += count;
    }
    if (uses > 0) rows.push([word, uses]);
  }
  return rows.sort((a, b) => b[1] - a[1]).slice(0, limit);
}
