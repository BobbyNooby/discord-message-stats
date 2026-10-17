import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";

/**
 * "Who says it" — the mockup's `drawWordLead`.
 *
 * Only 420 of the 500 shipped words carry a per-author breakdown, so a word from
 * the long tail has no rows to draw. It says so instead of showing an empty
 * chart (the plan's Review Focus #5).
 */

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export const OUTSIDE_SLICE = "No per-author breakdown — outside the indexed slice.";

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

export function WhoSaysIt({
  payload,
  filters,
  word,
}: {
  payload: Payload;
  filters: Filters;
  word: string | null;
}) {
  const rows = useMemo(() => whoSaysItRows(payload, filters, word), [payload, filters, word]);
  const indexed = Boolean(word && payload.wordAuthors[word]);
  // The bars honour the author selection, so the total has to as well or the
  // subtitle would disagree with the chart beside it.
  const total = useMemo(() => rows.reduce((sum, row) => sum + row.value, 0), [rows]);
  const allOff =
    payload.authors.length > 0 && filters.active.length > 0 && !filters.active.some(Boolean);

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        backgroundColor: "#171b25",
        borderColor: "#2b3244",
        textStyle: { color: "#e7eaf2", fontSize: 12 },
        formatter: (p: any) => `${p.name}<br><b>${fmt(p.value as number)}</b> uses of “${word}”`,
      },
      grid: { left: 6, right: 52, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { color: "#8a93a8", fontSize: 10.5, interval: 0, width: 96, overflow: "truncate" },
        splitLine: { lineStyle: { color: "#1b202c" } },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.name),
        axisLabel: { color: "#8a93a8", fontSize: 10.5 },
        axisLine: { lineStyle: { color: "#2b3244" } },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          barWidth: "62%",
          data: rows.map((row) => ({
            value: row.value,
            itemStyle: { color: swatch(row.index), borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: "right",
            color: "#8a93a8",
            fontSize: 10,
            formatter: (p: any) => fmt(p.value as number),
          },
        },
      ],
    }),
    [rows, word],
  );

  return (
    <Panel
      // The title names the selected word, so the card states its own id.
      panelId="who-says-it"
      title={word ? `Who says “${word}”` : "Who says it"}
      subtitle={word ? `${fmt(total)} uses total` : "click a word in the index"}
    >
      {!word ? (
        <EmptyState>Click a word in the index to see who says it.</EmptyState>
      ) : !indexed ? (
        <EmptyState>{OUTSIDE_SLICE}</EmptyState>
      ) : allOff ? (
        <EmptyState>No authors selected.</EmptyState>
      ) : !rows.length ? (
        <EmptyState>None of the selected authors use this word.</EmptyState>
      ) : (
        <EChart option={option} height={330} />
      )}
    </Panel>
  );
}
