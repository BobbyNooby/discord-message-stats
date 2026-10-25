/**
 * The horizontal bars the ranking cards draw: the longest bar on top, the value
 * written at its end, and the chrome read from the theme.
 */
import type { EChartsOption } from "echarts";

import { axisLabel, axisLine, splitLine, tooltip } from "./style";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "./palette";
import type { Row as NamedRow } from "../selectors/media";
import type { Row } from "../selectors/people";

export type BarOptions = {
  axis?: (value: number) => string;
  label?: (row: Row) => string;
  tooltip?: (row: Row) => string;
};

/** The mockup's `hbar`: sorted shortest-first so the longest bar reads top. */
export function hbarOption(rows: Row[], options: BarOptions = {}): EChartsOption {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  const axis = options.axis ?? kfmt;
  const label = options.label ?? ((row: Row) => axis(row.value));
  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: any) => {
        const row = sorted[params.dataIndex];
        return options.tooltip ? options.tooltip(row) : `${row.name}<br><b>${axis(row.value)}</b>`;
      },
    },
    grid: { left: 6, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { ...axisLabel(10.5), formatter: (value: number) => axis(value) },
      splitLine: splitLine(),
    },
    yAxis: {
      type: "category",
      data: sorted.map((row) => row.name),
      axisLabel: axisLabel(10.5),
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "62%",
        data: sorted.map((row) => ({
          value: row.value,
          itemStyle: { color: swatch(row.index), borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true,
          position: "right",
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (params: any) => label(sorted[params.dataIndex]),
        },
      },
    ],
  };
}

/** A bar that keeps its own colour: a two-way split, or an author in Share of voice. */
export type ColorRow = { name: string; value: number; color: string };

function truncate(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function horizontalBarsOption(
  rows: NamedRow[],
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
export function colorBarsOption(rows: ColorRow[], axisFontSize = 11): EChartsOption {
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
