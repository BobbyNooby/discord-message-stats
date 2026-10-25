/**
 * Uses per month, stacked by person — the timeline behind a word or a GIF.
 *
 * The server sends only the months something happened in; the axis is filled
 * in between, because a gap of quiet months is part of the story and a chart
 * that skips them makes a two-year silence look like the next month.
 */
import type { Author } from "../api/types";
import { MON } from "./time";

export type MonthRow = { month: string; id: string; count: number };

export type MonthlyStacks = {
  months: string[];
  series: { index: number; name: string; data: number[] }[];
  /** The busiest month, or null when nothing is left after filtering. */
  peak: { month: string; count: number } | null;
  first: string | null;
  total: number;
};

export function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MON[Number(number) - 1] ?? number} ${year}`;
}

/** Every month from `first` to `last`, inclusive, as YYYY-MM. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [year, month] = first.split("-").map(Number);
  const [endYear, endMonth] = last.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** An author id (or a merged-in alt's id) to its position in `payload.authors`. */
export function authorIndexById(authors: Author[]): Map<string, number> {
  const index = new Map<string, number>();
  authors.forEach((author, i) => {
    index.set(author.id, i);
    for (const account of author.accounts ?? []) index.set(account, i);
  });
  return index;
}

export function monthlyStacks(rows: MonthRow[], authors: Author[], active: boolean[]): MonthlyStacks {
  const byId = authorIndexById(authors);
  const kept = rows.filter((row) => {
    const index = byId.get(row.id);
    return index !== undefined && active[index] !== false && row.count > 0;
  });
  if (!kept.length) return { months: [], series: [], peak: null, first: null, total: 0 };
  const sorted = kept.map((row) => row.month).sort();
  const months = monthRange(sorted[0], sorted[sorted.length - 1]);
  const position = new Map(months.map((month, i) => [month, i]));
  const perAuthor = new Map<number, number[]>();
  const perMonth = new Array<number>(months.length).fill(0);
  for (const row of kept) {
    const index = byId.get(row.id) as number;
    const at = position.get(row.month) as number;
    const data = perAuthor.get(index) ?? new Array<number>(months.length).fill(0);
    data[at] += row.count;
    perAuthor.set(index, data);
    perMonth[at] += row.count;
  }
  let peakAt = 0;
  perMonth.forEach((count, i) => {
    if (count > perMonth[peakAt]) peakAt = i;
  });
  return {
    months,
    // Ordered by author position, so colours match every other card.
    series: [...perAuthor.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, data]) => ({ index, name: authors[index]?.name ?? `#${index}`, data })),
    peak: { month: months[peakAt], count: perMonth[peakAt] },
    first: months[0],
    total: perMonth.reduce((sum, count) => sum + count, 0),
  };
}
