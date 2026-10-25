import type { EChartsOption, LineSeriesOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import { axis, axisLabel, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { bucketCountLabel, fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { activeAuthorIndices, bucketSeries, type BucketSeries } from "../selectors/time";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

function cumulativeOption(payload: Payload, buckets: BucketSeries, authors: number[]): EChartsOption {
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
    lineStyle: { width: 2.4, color: token("--color-text") },
    itemStyle: { color: token("--color-text") },
    data: runningTotal,
  });

  return {
    tooltip: { trigger: "axis", ...tooltip() },
    grid: { left: 50, right: 16, top: 12, bottom: 30 },
    xAxis: { ...axis(), type: "category", boundaryGap: false, data: buckets.order },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(11), formatter: kfmt },
      splitLine: splitLine(),
    },
    series: lines,
  };
}

/**
 * Cumulative growth — `drawCumulative`: each author's running total, stacked,
 * with the grand total drawn on top of them.
 *
 * Stacked and cumulative is the honest form here: the bands are shares of a
 * whole that only grows, so the top edge really is "messages so far".
 */
export function Cumulative({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("cumulative-growth", fallbackFilters);
  const buckets = useMemo(() => bucketSeries(payload, filters), [payload, filters]);
  const authors = useMemo(() => activeAuthorIndices(payload, filters), [payload, filters]);
  const option = useMemo(() => cumulativeOption(payload, buckets, authors), [payload, buckets, authors]);
  const nothing = buckets.order.length === 0;

  return (
    <Panel
      title="Cumulative growth"
      subtitle={`${fmt(buckets.total)} messages by ${authors.length} authors across ${bucketCountLabel(
        buckets.order.length,
        filters.bucket,
      )}`}
    >
      {nothing ? (
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      ) : (
        <EChart option={option} height={280} />
      )}
    </Panel>
  );
}
