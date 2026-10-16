import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { AXIS_LINE, AXIS_TEXT, burstiness, fmt, kfmt, quantile, SPLIT_LINE, TOOLTIP } from "./people";

/**
 * "How bursty is everyone" — a boxplot of each author's daily totals. Only days
 * they actually posted count, so a quiet week does not read as a burst of zeros;
 * a single active day gives a flat box, which is the honest answer.
 */
export function Burstiness({ payload, filters }: { payload: Payload; filters: Filters }) {
  const bursts = burstiness(payload, filters);

  if (!bursts.length) {
    return (
      <Panel title="How bursty is everyone">
        <EmptyState>No messages match the current filters.</EmptyState>
      </Panel>
    );
  }

  const names = bursts.map((burst) => burst.name);
  const outliers: [number, number][] = [];
  bursts.forEach((burst, position) => {
    for (const value of burst.days) if (value > burst.box[4]) outliers.push([position, value]);
  });
  const pooled = bursts.flatMap((burst) => burst.days).sort((a, b) => a - b);
  const median = quantile(pooled, 0.5);

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (params: any) => {
        if (params.seriesType === "scatter") {
          return `${names[params.value[0]]} · ${fmt(params.value[1])} in a day`;
        }
        const [low, q1, middle, q3, high] = params.value as number[];
        return (
          `${names[params.dataIndex]}<br>median <b>${fmt(middle)}</b>` +
          `<br>middle 50%: ${fmt(q1)}–${fmt(q3)}` +
          `<br>5th–95th: ${fmt(low)}–${fmt(high)}`
        );
      },
    },
    grid: { left: 52, right: 16, top: 16, bottom: 34 },
    xAxis: {
      type: "category",
      data: names,
      axisLabel: { color: AXIS_TEXT, fontSize: 10, rotate: 22, interval: 0 },
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: AXIS_TEXT, fontSize: 10.5, formatter: (value: number) => kfmt(value) },
      splitLine: { lineStyle: { color: SPLIT_LINE } },
    },
    series: [
      {
        type: "boxplot",
        data: bursts.map((burst) => burst.box),
        boxWidth: ["22%", "44%"],
        itemStyle: { color: "rgba(88,101,242,.22)", borderColor: "#7180f0", borderWidth: 1.4 },
        emphasis: { itemStyle: { borderColor: "#c3c8fb" } },
      },
      {
        type: "scatter",
        data: outliers,
        symbolSize: 4,
        silent: true,
        itemStyle: { color: "rgba(235,69,158,.5)" },
      },
    ],
  };

  return (
    <Panel
      title="How bursty is everyone"
      subtitle={`${bursts.length} authors · median ${fmt(median)} messages on an active day`}
    >
      <EChart option={option} height={320} />
    </Panel>
  );
}
