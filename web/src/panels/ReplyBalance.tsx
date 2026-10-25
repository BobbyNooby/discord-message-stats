import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { axisLabel, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { EMPTY_AUTHORS } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { usePanelFilters } from "./panelScope";
import { replyBalance, type BalancePoint } from "../selectors/people";



function balanceOption(points: BalancePoint[]): EChartsOption {
  let max = 1;
  for (const point of points) max = Math.max(max, point.sent, point.received);
  const axis = max * 1.12;

  return {
    tooltip: {
      ...tooltip(),
      formatter: (params: any) =>
        `${params.data.name}<br>sent <b>${fmt(params.data.value[0])}</b> · received ` +
        `<b>${fmt(params.data.value[1])}</b>`,
    },
    grid: { left: 6, right: 18, top: 16, bottom: 6, containLabel: true },
    xAxis: {
      type: "value",
      name: "sent",
      nameTextStyle: { color: token("--chart-axis-dim"), fontSize: 10 },
      max: axis,
      axisLabel: { ...axisLabel(10.5), formatter: (value: number) => kfmt(value) },
      splitLine: splitLine(),
    },
    yAxis: {
      type: "value",
      name: "received",
      nameTextStyle: { color: token("--chart-axis-dim"), fontSize: 10 },
      max: axis,
      axisLabel: { ...axisLabel(10.5), formatter: (value: number) => kfmt(value) },
      splitLine: splitLine(),
    },
    series: [
      {
        type: "scatter",
        data: points.map((point) => ({
          name: point.name,
          value: [point.sent, point.received],
          itemStyle: { color: swatch(point.index), opacity: 0.88 },
          label: { show: point.msgs >= 1000 },
          symbolSize: Math.max(11, Math.sqrt(point.msgs) / 7),
        })),
        label: {
          show: true,
          position: "right",
          color: token("--color-muted"),
          fontSize: 9.5,
          formatter: (params: any) => params.data.name,
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: token("--chart-guide"), type: "dashed", width: 1 },
          label: { show: false },
          data: [[{ coord: [0, 0] }, { coord: [max, max] }]],
        },
      },
    ],
  };
}

/**
 * "Reply balance" — sent versus received from `rollup_reply`. Above the diagonal
 * a person is replied to more than they reply; on it, they are even.
 */
export function ReplyBalance({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("reply-balance", fallbackFilters);
  const balance = useMemo(() => replyBalance(payload, filters), [payload, filters]);
  const option = useMemo(() => balanceOption(balance.points), [balance]);
  const { points } = balance;

  if (!points.length) {
    return (
      <Panel title="Reply balance">
        <EmptyState>{EMPTY_AUTHORS}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="Reply balance"
      subtitle={`${points.length} authors · ${fmt(balance.total)} replies exchanged`}
    >
      <EChart option={option} height={320} />
    </Panel>
  );
}
