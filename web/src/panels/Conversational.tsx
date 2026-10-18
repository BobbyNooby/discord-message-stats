import { C_DAY, C_MSGS, C_REPLIES } from "../api/types";
import type { EChartsOption } from "echarts";

import { EmptyState, Panel } from "../components/Panel";
import { bucketOf, selectVisibleCells } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { AXIS, TOOLTIP, bucketCountLabel, emptyLabel, fmt, pct, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

/**
 * How conversational — `drawConvo`: replies as a percentage of messages, with
 * the mean marked. A line, not a bar, because the interesting thing is the
 * trend in the ratio, not any single month's height.
 */
export function Conversational({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("how-conversational", fallbackFilters);
  const sums = new Map<string, number>();
  const replies = new Map<string, number>();
  const order: string[] = [];
  let msgs = 0;
  let replyCount = 0;

  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const key = bucketOf(day, filters.bucket);
    if (!sums.has(key)) order.push(key);
    sums.set(key, (sums.get(key) ?? 0) + cell[C_MSGS]);
    replies.set(key, (replies.get(key) ?? 0) + cell[C_REPLIES]);
    msgs += cell[C_MSGS];
    replyCount += cell[C_REPLIES];
  }
  order.sort();

  if (!order.length) {
    return (
      <Panel title="How conversational" subtitle={`${fmt(0)} replies · 0% of messages`}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const series = order.map((key) => {
    const total = sums.get(key) ?? 0;
    return total ? Number(pct(replies.get(key) ?? 0, total).toFixed(2)) : 0;
  });
  const mean = series.reduce((sum, value) => sum + value, 0) / series.length;

  const option: EChartsOption = {
    tooltip: {
      trigger: "axis",
      ...TOOLTIP,
      valueFormatter: (value: unknown) => `${value}%`,
    },
    grid: { left: 42, right: 14, top: 14, bottom: 30 },
    xAxis: { ...AXIS, type: "category", boundaryGap: false, data: order },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8a93a8", fontSize: 11, formatter: "{value}%" },
      splitLine: AXIS.splitLine,
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

  return (
    <Panel
      title="How conversational"
      subtitle={`${fmt(replyCount)} replies · ${pct(replyCount, msgs).toFixed(1)}% of ${fmt(
        msgs,
      )} messages across ${bucketCountLabel(order.length, filters.bucket)}`}
    >
      <EChart option={option} height={280} />
    </Panel>
  );
}
