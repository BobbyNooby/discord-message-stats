/**
 * The horizontal bar every ranking card draws: the longest bar on top, the
 * value written at its end, and the chrome read from the theme.
 */
import type { EChartsOption } from "echarts";

import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
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
