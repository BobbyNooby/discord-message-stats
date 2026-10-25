import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { axis, axisLabel, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { bucketCountLabel, fmt } from "../lib/format";
import { swatch } from "../lib/palette";
import { pct, repliesByBucket, type RepliesByBucket } from "../selectors/time";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

function replyLine({ order, series }: RepliesByBucket): EChartsOption {
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;
  return {
    tooltip: {
      trigger: "axis",
      ...tooltip(),
      valueFormatter: (value: unknown) => `${value}%`,
    },
    grid: { left: 42, right: 14, top: 14, bottom: 30 },
    xAxis: { ...axis(), type: "category", boundaryGap: false, data: order },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(11), formatter: "{value}%" },
      splitLine: splitLine(),
    },
    series: [
      {
        type: "line",
        name: "replies %",
        showSymbol: false,
        lineStyle: { width: 2, color: swatch(4) },
        itemStyle: { color: swatch(4) },
        areaStyle: { opacity: 0.12, color: swatch(4) },
        data: series,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: swatch(1), type: "dashed", width: 1 },
          label: { color: swatch(1), fontSize: 10, formatter: `avg ${mean.toFixed(0)}%` },
          data: [{ yAxis: Number(mean.toFixed(2)) }],
        },
      },
    ],
  };
}

/**
 * How conversational — `drawConvo`: replies as a percentage of messages, with
 * the mean marked. A line, not a bar, because the interesting thing is the
 * trend in the ratio, not any single month's height.
 */
export function Conversational({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("how-conversational", fallbackFilters);
  const share = useMemo(() => repliesByBucket(payload, filters), [payload, filters]);
  const option = useMemo(() => replyLine(share), [share]);
  const { order, msgs, replies } = share;

  if (!order.length) {
    return (
      <Panel title="How conversational" subtitle={`${fmt(0)} replies · 0% of messages`}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="How conversational"
      subtitle={`${fmt(replies)} replies · ${pct(replies, msgs).toFixed(1)}% of ${fmt(
        msgs,
      )} messages across ${bucketCountLabel(order.length, filters.bucket)}`}
    >
      <EChart option={option} height={280} />
    </Panel>
  );
}
