import type { EChartsOption } from "echarts";

import { token } from "./palette";

/** One percentage dial: its label, its value out of 100, and its arc's colour. */
export type Gauge = { name: string; value: number; color: string };

/** Dials side by side, each with its value in the middle and its name under it. */
export function gaugeOption(gauges: Gauge[]): EChartsOption {
  return {
    series: gauges.map((gauge, index) => ({
      type: "gauge" as const,
      center: [`${((index + 0.5) / gauges.length) * 100}%`, "56%"],
      radius: "64%",
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      splitNumber: 4,
      progress: { show: true, width: 9, itemStyle: { color: gauge.color } },
      pointer: { show: false },
      anchor: { show: false },
      axisLine: { lineStyle: { width: 9, color: [[1, token("--chart-gauge-track")]] as [number, string][] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: { show: true, offsetCenter: [0, "34%"], color: token("--color-muted"), fontSize: 11 },
      detail: {
        valueAnimation: false,
        offsetCenter: [0, "2%"],
        color: token("--color-text"),
        fontSize: 20,
        fontWeight: 600 as const,
        formatter: (value: number) => `${value.toFixed(0)}%`,
      },
      data: [{ value: Number(gauge.value.toFixed(1)), name: gauge.name }],
    })),
  };
}
