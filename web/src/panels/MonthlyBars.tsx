import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Author } from "../api/types";
import { EChart } from "../lib/echart";
import { chartTooltipBg, swatch, token } from "../lib/palette";

/**
 * Uses per month, stacked by person — the timeline behind a word or a GIF.
 *
 * The server sends only the months something happened in; the axis is filled
 * in between, because a gap of quiet months is part of the story and a chart
 * that skips them makes a two-year silence look like the next month.
 */

export type MonthRow = { month: string; id: string; count: number };

export type MonthlyStacks = {
  months: string[];
  series: { index: number; name: string; data: number[] }[];
  /** The busiest month, or null when nothing is left after filtering. */
  peak: { month: string; count: number } | null;
  first: string | null;
  total: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  return `${MONTHS[Number(number) - 1] ?? number} ${year}`;
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

const nf = new Intl.NumberFormat("en-US");

export function MonthlyBars({
  stacks,
  unit,
  height = 200,
  "aria-label": ariaLabel,
}: {
  stacks: MonthlyStacks;
  /** What one count is, for the tooltip: "uses", "posts". */
  unit: string;
  height?: number;
  "aria-label"?: string;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: chartTooltipBg(),
        borderColor: token("--color-line"),
        textStyle: { color: token("--color-text"), fontSize: 12 },
        formatter: (params: any) => {
          const items = (Array.isArray(params) ? params : [params]).filter((p: any) => p.value > 0);
          const month = Array.isArray(params) ? params[0]?.axisValue : params.axisValue;
          const lines = items.map((p: any) => `${p.marker}${p.seriesName}: <b>${nf.format(p.value)}</b>`);
          return [`${monthLabel(String(month))}`, ...(lines.length ? lines : [`no ${unit}`])].join("<br>");
        },
      },
      grid: { left: 6, right: 10, top: 10, bottom: 6, containLabel: true },
      xAxis: {
        type: "category",
        data: stacks.months,
        axisLabel: {
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (value: string) => monthLabel(value),
          hideOverlap: true,
        },
        axisLine: { lineStyle: { color: token("--color-line") } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: token("--color-surface-2") } },
        axisLabel: { color: token("--color-muted"), fontSize: 10 },
      },
      series: stacks.series.map((series) => ({
        type: "bar",
        name: series.name,
        stack: "total",
        data: series.data,
        itemStyle: { color: swatch(series.index) },
        barMaxWidth: 18,
      })),
    }),
    [stacks, unit],
  );
  return <EChart option={option} height={height} aria-label={ariaLabel} />;
}
