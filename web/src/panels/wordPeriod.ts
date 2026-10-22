import { useMemo } from "react";

import type { getWords, Period } from "../api/client";
import { useWordPeriod } from "../api/queries";
import type { Payload } from "../api/types";
import type { Filters } from "../filters/reducer";
import { monthLabel } from "./MonthlyBars";

/**
 * The word cards under a time filter.
 *
 * Words are counted per local month (`rollup_word_month`), so a period is a
 * stretch of whole months plus, optionally, a set of years — the same two rules
 * the time filter applies to days. Picking years is exact; a day range is
 * rounded out to the months it touches, and the label says so.
 */

/** The filters' time rule at month grain, or null when there is none. */
export function periodOf(filters: Pick<Filters, "from" | "to" | "years">): Period | null {
  const from = filters.from ? filters.from.slice(0, 7) : null;
  const to = filters.to ? filters.to.slice(0, 7) : null;
  const years = [...filters.years].sort((a, b) => a - b);
  if (!from && !to && !years.length) return null;
  return { from, to, years };
}

export function inPeriod(month: string, period: Period | null): boolean {
  if (!period) return true;
  if (period.from && month < period.from) return false;
  if (period.to && month > period.to) return false;
  if (period.years.length && !period.years.includes(Number(month.slice(0, 4)))) return false;
  return true;
}

/** "2021, 2023", "Mar 2024 – May 2024 (whole months)", or both. */
export function periodLabel(period: Period): string {
  const parts: string[] = [];
  if (period.years.length) parts.push(period.years.join(", "));
  if (period.from || period.to) {
    const range = `${period.from ? monthLabel(period.from) : "the start"} – ${
      period.to ? monthLabel(period.to) : "now"
    }`;
    parts.push(`${range} (whole months)`);
  }
  return parts.join(" · ");
}

/**
 * What a word card says instead of drawing, while a period is loading, before
 * the month table exists, or when nobody said anything in it. Null: draw.
 */
export function periodNote(view: WordView): string | null {
  if (!view.period) return null;
  const when = periodLabel(view.period);
  if (view.pending) return `Counting words for ${when}…`;
  if (view.unbuilt) return "Words by year need one rebuild — Recalculate on the Admin board.";
  if (!view.payload.words.length) return `No words in ${when}.`;
  return null;
}

/** The start of a word card's subtitle: which stretch of time it counts. */
export function periodPrefix(view: WordView): string {
  return view.period ? `${periodLabel(view.period)} · ` : "all time · ";
}

export type WordView = {
  /** The payload with its word fields for the period, or the payload itself. */
  payload: Payload;
  period: Period | null;
  /** True while the first answer for a period is on its way. */
  pending: boolean;
  /** The month table has not been built yet: the card says "recalculate". */
  unbuilt: boolean;
};

/**
 * What a word card draws from. With no time filter it is the payload itself,
 * so the default view still never touches the network.
 */
export function useWordView(payload: Payload, filters: Filters): WordView {
  // A scoped card rebuilds its years array on every render; the contents are
  // what identify the period, so they are the dependency.
  const yearsKey = filters.years.join(",");
  const period = useMemo(
    () => periodOf({ from: filters.from, to: filters.to, years: yearsKey ? yearsKey.split(",").map(Number) : [] }),
    [filters.from, filters.to, yearsKey],
  );
  const answer = useWordPeriod(period);
  const data = period ? answer.data : undefined;
  const view = useMemo(() => {
    if (!period) return payload;
    // Waiting on the first answer: empty, not all-time numbers under a year
    // label that would be wrong for the second they were on screen.
    if (!data) return { ...payload, words: [], wordAuthors: {} };
    return {
      ...payload,
      words: data.words,
      wordAuthors: data.wordAuthors,
      authorWordTotals: data.authorWordTotals,
      authorDistinct: data.authorDistinct,
    };
  }, [payload, period, data]);
  return {
    payload: view,
    period,
    pending: Boolean(period) && !data && answer.isFetching,
    unbuilt: Boolean(period && data && !data.built),
  };
}

type WordAnswer = Awaited<ReturnType<typeof getWords>>;

/**
 * The server's answer for one word, cut to the period when there is one. The
 * endpoint answers for all time and carries the month-by-month split, so the
 * period's share is a sum the browser can do — and the label stays true.
 */
export function answerFor(found: WordAnswer | undefined, period: Period | null): WordAnswer | undefined {
  if (!found || !period || !found.months) return found;
  const names = new Map(found.authors.map((author) => [author.id, author.name]));
  const counts = new Map<string, number>();
  for (const row of found.months) {
    if (inPeriod(row.month, period)) counts.set(row.id, (counts.get(row.id) ?? 0) + row.count);
  }
  const authors = [...counts.entries()]
    .map(([id, count]) => ({ id, name: names.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count);
  return { ...found, total: authors.reduce((sum, author) => sum + author.count, 0), authors };
}
