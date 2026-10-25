import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { axisLabel, axisLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { EMPTY_AUTHORS } from "../lib/empty";
import { fmt } from "../lib/format";
import { ramp, token } from "../lib/palette";
import { matrixData, type Matrix } from "./people";
import { usePanelFilters } from "./panelScope";

/** The legend's steps, busiest first; read at draw time so a theme reaches them. */
function pieces() {
  const [one, ten, fifty, twoHundred, thousand] = ramp("--chart-matrix");
  return [
    { min: 1000, label: "1k+", color: thousand },
    { min: 200, max: 999, label: "200+", color: twoHundred },
    { min: 50, max: 199, label: "50+", color: fifty },
    { min: 10, max: 49, label: "10+", color: ten },
    { min: 1, max: 9, label: "1+", color: one },
    { value: 0, label: "0", color: token("--color-surface") },
  ];
}

function matrixOption(matrix: Matrix): EChartsOption {
  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: any) =>
        `${matrix.names[params.value[0]]} replied to ${matrix.names[params.value[1]]}` +
        `<br><b>${fmt(params.value[2])}</b> times`,
    },
    grid: { left: 4, right: 10, top: 6, bottom: 50, containLabel: true },
    xAxis: {
      type: "category",
      data: matrix.names,
      axisLabel: { ...axisLabel(9), rotate: 50, interval: 0 },
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: matrix.names,
      axisLabel: { ...axisLabel(9), interval: 0, width: 74, overflow: "truncate" },
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    visualMap: {
      type: "piecewise",
      orient: "horizontal",
      left: "center",
      bottom: -2,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: token("--color-muted"), fontSize: 9.5 },
      pieces: pieces(),
    },
    series: [
      {
        type: "heatmap",
        data: matrix.data,
        progressive: 1000,
        itemStyle: { borderColor: token("--chart-heat-edge"), borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: token("--color-text"), borderWidth: 1 } },
      },
    ],
  };
}

/**
 * A k×k heatmap over the *visible* authors. `rollup_reply` carries no date, so
 * the axes, the cells and the totals are identical with or without a time
 * filter — the People section note says so once.
 */
export function ReplyMatrix({
  payload,
  filters: fallbackFilters,
  className,
}: { panelId?: string;
  payload: Payload;
  filters?: Filters;
  className?: string;
}) {
  const filters = usePanelFilters("reply-matrix", fallbackFilters);
  const matrix = useMemo(() => matrixData(payload, filters), [payload, filters]);
  const option = useMemo(() => matrixOption(matrix), [matrix]);

  if (!matrix.k) {
    return (
      <Panel title="Reply matrix" className={className}>
        <EmptyState>{EMPTY_AUTHORS}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="Reply matrix"
      subtitle={`${matrix.k} authors · ${matrix.k * matrix.k} cells · ${fmt(matrix.total)} replies`}
      className={className}
    >
      <EChart option={option} height={Math.max(260, matrix.k * 22 + 90)} />
    </Panel>
  );
}
