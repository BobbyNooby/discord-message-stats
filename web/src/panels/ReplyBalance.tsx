import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { AXIS_TEXT, fmt, globalTotals, kfmt, sendRecv, SPLIT_LINE, TOOLTIP } from "./people";

/**
 * "Reply balance" — sent versus received from `rollup_reply`. Above the diagonal
 * a person is replied to more than they reply; on it, they are even.
 */
export function ReplyBalance({ payload, filters }: { payload: Payload; filters: Filters }) {
  const balance = sendRecv(payload, filters);
  const totals = globalTotals(payload, filters);
  const badge = hasTimeFilter(filters) ? <GlobalOnlyBadge what="Reply pairs" /> : null;

  const points = payload.authors
    .map((author, index) => ({
      index,
      name: author.name,
      msgs: totals[index]?.msgs ?? 0,
      sent: balance.sent[index] ?? 0,
      received: balance.received[index] ?? 0,
    }))
    .filter((point) => filters.active[point.index] !== false && point.msgs > 0);

  if (!points.length) {
    return (
      <Panel title="Reply balance" badge={badge}>
        <EmptyState>No authors selected.</EmptyState>
      </Panel>
    );
  }

  let max = 1;
  for (const point of points) max = Math.max(max, point.sent, point.received);
  const axis = max * 1.12;

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (params: any) =>
        `${params.data.name}<br>sent <b>${fmt(params.data.value[0])}</b> · received ` +
        `<b>${fmt(params.data.value[1])}</b>`,
    },
    grid: { left: 6, right: 18, top: 16, bottom: 6, containLabel: true },
    xAxis: {
      type: "value",
      name: "sent",
      nameTextStyle: { color: "#5b6478", fontSize: 10 },
      max: axis,
      axisLabel: { color: AXIS_TEXT, fontSize: 10.5, formatter: (value: number) => kfmt(value) },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
    },
    yAxis: {
      type: "value",
      name: "received",
      nameTextStyle: { color: "#5b6478", fontSize: 10 },
      max: axis,
      axisLabel: { color: AXIS_TEXT, fontSize: 10.5, formatter: (value: number) => kfmt(value) },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
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
          color: AXIS_TEXT,
          fontSize: 9.5,
          formatter: (params: any) => params.data.name,
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#3a4257", type: "dashed", width: 1 },
          label: { show: false },
          data: [[{ coord: [0, 0] }, { coord: [max, max] }]],
        },
      },
    ],
  };

  return (
    <Panel
      title="Reply balance"
      subtitle={`${points.length} authors · ${fmt(balance.total)} replies exchanged`}
      badge={badge}
    >
      <EChart option={option} height={320} />
    </Panel>
  );
}
