import type { EChartsOption, LineSeriesOption } from "echarts";

import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import {
  AXIS,
  TOOLTIP,
  activeAuthorIndices,
  bucketCountLabel,
  bucketSeries,
  emptyLabel,
  fmt,
  kfmt,
  type PanelProps,
} from "./timeAggregates";

/**
 * Cumulative growth — `drawCumulative`: each author's running total, stacked,
 * with the grand total drawn on top of them.
 *
 * Stacked and cumulative is the honest form here: the bands are shares of a
 * whole that only grows, so the top edge really is "messages so far".
 */
export function Cumulative({ payload, filters }: PanelProps) {
  const buckets = bucketSeries(payload, filters);
  const authors = activeAuthorIndices(payload, filters);
  const nothing = buckets.order.length === 0;

  let total = 0;
  const runningTotal = buckets.order.map((key) => {
    total += buckets.sums[key] ?? 0;
    return total;
  });

  const lines: LineSeriesOption[] = authors.map((index) => {
    let run = 0;
    return {
      name: payload.authors[index]?.name ?? `#${index}`,
      type: "line",
      stack: "c",
      showSymbol: false,
      areaStyle: { opacity: 0.68 },
      lineStyle: { width: 0.7 },
      itemStyle: { color: swatch(index) },
      data: buckets.order.map((key) => {
        run += buckets.per[index]?.[key] ?? 0;
        return run;
      }),
    };
  });
  lines.push({
    name: "TOTAL",
    type: "line",
    showSymbol: false,
    z: 10,
    lineStyle: { width: 2.4, color: "#e7eaf2" },
    itemStyle: { color: "#e7eaf2" },
    data: runningTotal,
  });

  const option: EChartsOption = {
    tooltip: { trigger: "axis", ...TOOLTIP },
    grid: { left: 50, right: 16, top: 12, bottom: 30 },
    xAxis: { ...AXIS, type: "category", boundaryGap: false, data: buckets.order },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8a93a8", fontSize: 11, formatter: kfmt },
      splitLine: AXIS.splitLine,
    },
    series: lines,
  };

  return (
    <Panel
      title="Cumulative growth"
      subtitle={`${fmt(buckets.total)} messages by ${authors.length} authors across ${bucketCountLabel(
        buckets.order.length,
        filters.bucket,
      )}`}
      className="lg:col-span-2"
    >
      {nothing ? (
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      ) : (
        <EChart option={option} height={280} />
      )}
    </Panel>
  );
}
