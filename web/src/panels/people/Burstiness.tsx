import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../../api/types";
import { EmptyState, Panel } from "../../components/Panel";
import type { Filters } from "../../app/reducer";
import { axisLabel, axisLine, splitLine, tooltip } from "../../charts/style";
import { EChart } from "../../charts/echart";
import { fmt, kfmt } from "../../lib/format";
import { token } from "../../charts/palette";
import { burstiness, quantile, type Burst } from "../../selectors/people";
import { usePanelFilters } from "../panelScope";

function burstOption(bursts: Burst[]): EChartsOption {
  const names = bursts.map((burst) => burst.name);
  const outliers: [number, number][] = [];
  bursts.forEach((burst, position) => {
    for (const value of burst.days) if (value > burst.box[4]) outliers.push([position, value]);
  });
  return {
    tooltip: {
      ...tooltip(),
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
      axisLabel: { ...axisLabel(10), rotate: 22, interval: 0 },
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(10.5), formatter: (value: number) => kfmt(value) },
      splitLine: splitLine(),
    },
    series: [
      {
        type: "boxplot",
        data: bursts.map((burst) => burst.box),
        boxWidth: ["22%", "44%"],
        itemStyle: { color: token("--chart-box-fill"), borderColor: token("--chart-box-line"), borderWidth: 1.4 },
        emphasis: { itemStyle: { borderColor: token("--chart-box-emphasis") } },
      },
      {
        type: "scatter",
        data: outliers,
        symbolSize: 4,
        silent: true,
        itemStyle: { color: token("--chart-outlier") },
      },
    ],
  };
}

/**
 * "How bursty is everyone" — a boxplot of each author's daily totals. Only days
 * they actually posted count, so a quiet week does not read as a burst of zeros;
 * a single active day gives a flat box, which is the honest answer.
 */
export function Burstiness({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("how-bursty-is-everyone", fallbackFilters);
  const bursts = useMemo(() => burstiness(payload, filters), [payload, filters]);
  const option = useMemo(() => burstOption(bursts), [bursts]);

  if (!bursts.length) {
    return (
      <Panel title="How bursty is everyone">
        <EmptyState>No messages match the current filters.</EmptyState>
      </Panel>
    );
  }

  const pooled = bursts.flatMap((burst) => burst.days).sort((a, b) => a - b);
  const median = quantile(pooled, 0.5);

  return (
    <Panel
      title="How bursty is everyone"
      subtitle={`${bursts.length} authors · median ${fmt(median)} messages on an active day`}
    >
      <EChart option={option} height={320} />
    </Panel>
  );
}
