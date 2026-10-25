/**
 * Data shaping and ECharts options for the Media & reactions section.
 *
 * Everything here is a pure function of `(payload, filters)` so the panels
 * re-aggregate in the browser and never fetch on a filter change (§11.2). The
 * two doughnuts and the gauges read the filtered activity cells; the four
 * panels backed by `rollup_type`, `rollup_attachment`, `rollup_emoji` and
 * `rollup_reaction` have no date dimension and read the payload's global
 * arrays, so a time filter cannot move them — the Media section note says so
 * once (§11.1, §11.2).
 */
import type { EChartsOption } from "echarts";

import {
  C_DAY,
  C_MEDIA,
  C_MSGS,
  C_REPLIES,
  type Cell,
  type Payload,
  type TypeRow,
} from "../api/types";
import type { Filters } from "../filters/reducer";
import { selectVisibleCells } from "../selectors/cells";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";

export type MediaPanelProps = { payload: Payload; filters: Filters };
export type Row = { name: string; value: number };
export type Slice = { name: string; value: number; color: string };
export type Gauge = { name: string; value: number; color: string };

/* Colours come from the one palette, except the remainder of a two-part
 * doughnut: that slice is deliberately muted so "text only" and "standalone"
 * never read as a category of their own.
 *
 * These are functions, not constants, on purpose: a module-scope constant would
 * freeze the fallback at import time and never see a fork's `--chart-N`
 * override. They read the variable when a panel renders. */
export const mediaColor = () => swatch(1);
export const replyColor = () => swatch(4);
export const attachColor = () => swatch(5);
export const emojiColor = () => swatch(1);
export const reactionColor = () => swatch(2);
export const activeDaysColor = () => swatch(2);
export const remainderColor = () => token("--chart-remainder");

export function truncate(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

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
export function healthGauges(cells: readonly Cell[]): Gauge[] {
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
    { name: "Replies", value: msgs > 0 ? (100 * replies) / msgs : 0, color: replyColor() },
    { name: "With media", value: msgs > 0 ? (100 * media) / msgs : 0, color: mediaColor() },
    {
      name: "Active days",
      value: span > 0 ? Math.min(100, (100 * days.size) / span) : 0,
      color: activeDaysColor(),
    },
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

/* ---------- chart options ---------- */

export function doughnutOption(slices: Slice[], unit: string): EChartsOption {
  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: unknown) => {
        const point = params as { name?: string; value?: number; percent?: number };
        const percent = typeof point.percent === "number" ? ` (${point.percent.toFixed(1)}%)` : "";
        return `${point.name ?? ""}<br><b>${fmt(point.value ?? 0)}</b> ${unit}${percent}`;
      },
    },
    legend: {
      type: "scroll",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: token("--color-muted"), fontSize: 10 },
    },
    series: [
      {
        type: "pie",
        radius: ["46%", "72%"],
        center: ["50%", "43%"],
        avoidLabelOverlap: true,
        padAngle: 1.5,
        itemStyle: { borderColor: token("--chart-heat-edge"), borderWidth: 2 },
        label: {
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (params: unknown) => {
            const percent = (params as { percent?: number }).percent ?? 0;
            return percent >= 4 ? `${percent.toFixed(0)}%` : "";
          },
        },
        labelLine: { lineStyle: { color: token("--chart-guide") } },
        emphasis: { label: { color: token("--color-text"), fontSize: 12, fontWeight: 600 as const } },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: slice.color },
        })),
      },
    ],
  };
}

export function horizontalBarsOption(
  rows: Row[],
  color: string,
  axisFontSize = 9.5,
): EChartsOption {
  // Largest at the top: an ECharts category axis draws its first entry at the
  // bottom, so the payload's descending order is reversed for display.
  const ordered = rows.slice().reverse();
  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: unknown) => {
        const point = params as { dataIndex?: number; value?: number };
        const row = ordered[point.dataIndex ?? 0];
        return `${row?.name ?? ""}<br><b>${fmt(point.value ?? 0)}</b>`;
      },
    },
    grid: { left: 6, right: 46, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: {
        ...axisLabel(10.5),
        formatter: (value: unknown) => kfmt(Number(value)),
      },
      splitLine: splitLine(),
    },
    yAxis: {
      type: "category",
      data: ordered.map((row) => truncate(row.name, 30)),
      axisLabel: axisLabel(axisFontSize),
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "62%",
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        data: ordered.map((row) => row.value),
        label: {
          show: true,
          position: "right",
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (params: unknown) => kfmt(Number((params as { value?: number }).value ?? 0)),
        },
      },
    ],
  };
}

/**
 * A horizontal bar where each row keeps a colour of its own: the two-way splits
 * (with media / text only) and Share of voice, where colour follows the author
 * across panels. Rows keep every entry — the bar is the honest shape for a list
 * a pie would fold.
 */
export function colorBarsOption(rows: Slice[], axisFontSize = 11): EChartsOption {
  const ordered = rows.slice().reverse();
  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: unknown) => {
        const point = params as { dataIndex?: number; value?: number };
        const row = ordered[point.dataIndex ?? 0];
        return `${row?.name ?? ""}<br><b>${fmt(point.value ?? 0)}</b>`;
      },
    },
    grid: { left: 6, right: 46, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { ...axisLabel(10.5), formatter: (value: unknown) => kfmt(Number(value)) },
      splitLine: splitLine(),
    },
    yAxis: {
      type: "category",
      data: ordered.map((row) => truncate(row.name, 30)),
      axisLabel: axisLabel(axisFontSize),
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "62%",
        data: ordered.map((row) => ({ value: row.value, itemStyle: { color: row.color } })),
        label: {
          show: true,
          position: "right",
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (params: unknown) => kfmt(Number((params as { value?: number }).value ?? 0)),
        },
      },
    ],
  };
}

export function gaugeOption(gauges: Gauge[]): EChartsOption {
  return {
    series: gauges.map((gauge, index) => ({
      type: "gauge" as const,
      center: [`${((index + 0.5) / gauges.length) * 100}%`, "56%"],
      radius: "64%",
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      splitNumber: 4,
      progress: { show: true, width: 9, itemStyle: { color: gauge.color } },
      pointer: { show: false },
      anchor: { show: false },
      axisLine: { lineStyle: { width: 9, color: [[1, token("--chart-gauge-track")]] as [number, string][] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: { show: true, offsetCenter: [0, "34%"], color: token("--color-muted"), fontSize: 11 },
      detail: {
        valueAnimation: false,
        offsetCenter: [0, "2%"],
        color: token("--color-text"),
        fontSize: 20,
        fontWeight: 600 as const,
        formatter: (value: number) => `${value.toFixed(0)}%`,
      },
      data: [{ value: Number(gauge.value.toFixed(1)), name: gauge.name }],
    })),
  };
}
