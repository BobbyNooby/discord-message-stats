import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { TERMS } from "../lib/glossary";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { usePanelFilters } from "./panelScope";
import { periodNote, periodPrefix, useWordView } from "./wordPeriod";

/**
 * "Whose word is it" — the mockup's `drawLift`, ported as a pure function of
 * (payload, filters). Lift is the one number here that needs the payload's
 * per-author totals rather than the word's own count: a word is only a
 * signature of somebody if they use it more often than they use words in
 * general, so the denominator is `authorWordTotals[author]`, not the grand total.
 */

const TOP_WORDS = 18;
/** Above 4× the heat scale stops meaning anything and one word flattens the rest. */
const LIFT_CAP = 4;

/** [author x, word y, lift] for the heatmap. */
export type LiftCell = [number, number, number];

export type LiftGrid = { names: string[]; words: string[]; cells: LiftCell[] };

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

export function WordLift({ payload: full, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("word-lift", fallbackFilters);
  // The payload's words, or the period's while a time filter is on.
  const view = useWordView(full, filters);
  const payload = view.payload;
  const note = periodNote(view);
  const grid = useMemo(() => liftGrid(payload, filters), [payload, filters]);
  const anyActive = payload.authors.some((_, index) => filters.active[index] !== false);

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        backgroundColor: "#171b25",
        borderColor: "#2b3244",
        textStyle: { color: "#e7eaf2", fontSize: 12 },
        formatter: (p: any) => {
          const [x, y, lift] = p.value as LiftCell;
          return `${grid.names[x]} · “${grid.words[y]}”<br>lift <b>${lift.toFixed(2)}×</b> their normal rate`;
        },
      },
      grid: { left: 6, right: 14, top: 8, bottom: 14, containLabel: true },
      xAxis: {
        type: "category",
        data: grid.names,
        axisLabel: { color: "#8a93a8", fontSize: 9.5, rotate: 38, interval: 0 },
        axisLine: { lineStyle: { color: "#2b3244" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: grid.words,
        axisLabel: { color: "#8a93a8", fontSize: 10.5 },
        axisLine: { lineStyle: { color: "#2b3244" } },
        axisTick: { show: false },
      },
      visualMap: {
        type: "piecewise",
        orient: "horizontal",
        left: "center",
        bottom: -4,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: "#8a93a8", fontSize: 9.5 },
        pieces: [
          { min: 3, label: "3×+", color: "#eb459e" },
          { min: 2, max: 2.999, label: "2×", color: "#c9cdfc" },
          { min: 1.3, max: 1.999, label: "1.3×", color: "#7180f0" },
          { min: 0.8, max: 1.299, label: "avg", color: "#2a3a78" },
          { max: 0.799, label: "rare", color: "#161c2e" },
        ],
      },
      series: [
        {
          type: "heatmap",
          data: grid.cells,
          progressive: 1000,
          itemStyle: { borderColor: "#11141c", borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: "#e7eaf2", borderWidth: 1 } },
        },
      ],
    }),
    [grid],
  );

  return (
    <Panel
      title="Whose word is it"
      subtitle={`${periodPrefix(view)}lift = how much more this person uses a word than their share of all words · 1.0 = exactly average`}
      help={TERMS.lift}
    >
      {note ? (
        <EmptyState>{note}</EmptyState>
      ) : !payload.words.length ? (
        <EmptyState>No words yet — ingest, or upload a database from the Admin board.</EmptyState>
      ) : !anyActive ? (
        <EmptyState>No authors selected — switch one back on in the filters.</EmptyState>
      ) : (
        <EChart option={option} height={430} />
      )}
    </Panel>
  );
}
