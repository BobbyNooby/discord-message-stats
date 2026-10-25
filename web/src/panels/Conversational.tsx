import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { C_DAY, C_MSGS, C_REPLIES, type Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { bucketOf, selectVisibleCells } from "../selectors/cells";
import { axis, axisLabel, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt } from "../lib/format";
import { swatch } from "../lib/palette";
import { bucketCountLabel, pct, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

type ReplyShare = {
  /** The x axis: one sorted entry per bucket with messages. */
  order: string[];
  /** Replies as a percentage of each bucket's messages, to two decimals. */
  series: number[];
  msgs: number;
  replies: number;
};

/** Replies per bucket as a share of that bucket's messages. */
function replyShare(payload: Payload, filters: Filters): ReplyShare {
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

  const series = order.map((key) => {
    const total = sums.get(key) ?? 0;
    return total ? Number(pct(replies.get(key) ?? 0, total).toFixed(2)) : 0;
  });
  return { order, series, msgs, replies: replyCount };
}

function replyLine({ order, series }: ReplyShare): EChartsOption {
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
  const share = useMemo(() => replyShare(payload, filters), [payload, filters]);
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
