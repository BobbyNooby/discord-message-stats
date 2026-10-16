import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { AXIS_LINE, AXIS_TEXT, fmt, matrixData, TOOLTIP } from "./people";

const PIECES = [
  { min: 1000, label: "1k+", color: "#c3c8fb" },
  { min: 200, max: 999, label: "200+", color: "#7180f0" },
  { min: 50, max: 199, label: "50+", color: "#3c56c4" },
  { min: 10, max: 49, label: "10+", color: "#2a3a78" },
  { min: 1, max: 9, label: "1+", color: "#1c2542" },
  { value: 0, label: "0", color: "#141822" },
];

/**
 * A k×k heatmap over the *visible* authors. `rollup_reply` carries no date, so
 * the axes, the cells and the totals are identical with or without a time
 * filter — and the badge says so rather than leaving the reader to wonder why.
 */
export function ReplyMatrix({
  payload,
  filters,
  className,
}: {
  payload: Payload;
  filters: Filters;
  className?: string;
}) {
  const matrix = matrixData(payload, filters);
  const badge = hasTimeFilter(filters) ? <GlobalOnlyBadge what="Reply pairs" /> : null;

  if (!matrix.k) {
    return (
      <Panel title="Reply matrix" badge={badge} className={className}>
        <EmptyState>No authors selected.</EmptyState>
      </Panel>
    );
  }

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (params: any) =>
        `${matrix.names[params.value[0]]} replied to ${matrix.names[params.value[1]]}` +
        `<br><b>${fmt(params.value[2])}</b> times`,
    },
    grid: { left: 4, right: 10, top: 6, bottom: 50, containLabel: true },
    xAxis: {
      type: "category",
      data: matrix.names,
      axisLabel: { color: AXIS_TEXT, fontSize: 9, rotate: 50 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: matrix.names,
      axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
    },
    visualMap: {
      type: "piecewise",
      orient: "horizontal",
      left: "center",
      bottom: -2,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: AXIS_TEXT, fontSize: 9.5 },
      pieces: PIECES,
    },
    series: [
      {
        type: "heatmap",
        data: matrix.data,
        progressive: 1000,
        itemStyle: { borderColor: "#11141c", borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: "#e7eaf2", borderWidth: 1 } },
      },
    ],
  };

  return (
    <Panel
      title="Reply matrix"
      subtitle={`${matrix.k} authors · ${matrix.k * matrix.k} cells · ${fmt(matrix.total)} replies`}
      badge={badge}
      className={className}
    >
      <EChart option={option} height={Math.max(260, matrix.k * 22 + 90)} />
    </Panel>
  );
}
