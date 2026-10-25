import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { axisLabel, axisLine, splitLine, tooltip } from "./style";
import { EChart } from "./echart";
import { fmt } from "../lib/format";
import { swatch } from "./palette";
import { monthLabel, type MonthlyStacks } from "../selectors/months";

/**
 * Uses per month, stacked by person — the timeline behind a word or a GIF. The
 * axis already has every month in it, quiet ones included (`monthlyStacks`).
 */
export function MonthlyBars({
  stacks,
  unit,
  height = 200,
  "aria-label": ariaLabel,
}: {
  stacks: MonthlyStacks;
  /** What one count is, for the tooltip: "uses", "posts". */
  unit: string;
  height?: number;
  "aria-label"?: string;
}) {
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        ...tooltip(),
        formatter: (params: any) => {
          const items = (Array.isArray(params) ? params : [params]).filter((p: any) => p.value > 0);
          const month = Array.isArray(params) ? params[0]?.axisValue : params.axisValue;
          const lines = items.map((p: any) => `${p.marker}${p.seriesName}: <b>${fmt(p.value)}</b>`);
          return [`${monthLabel(String(month))}`, ...(lines.length ? lines : [`no ${unit}`])].join("<br>");
        },
      },
      grid: { left: 6, right: 10, top: 10, bottom: 6, containLabel: true },
      xAxis: {
        type: "category",
        data: stacks.months,
        axisLabel: {
          ...axisLabel(10),
          formatter: (value: string) => monthLabel(value),
          hideOverlap: true,
        },
        axisLine: axisLine(),
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: splitLine(),
        axisLabel: axisLabel(10),
      },
      series: stacks.series.map((series) => ({
        type: "bar",
        name: series.name,
        stack: "total",
        data: series.data,
        itemStyle: { color: swatch(series.index) },
        barMaxWidth: 18,
      })),
    }),
    [stacks, unit],
  );
  // Always the second chart in its card, so the card's export stays the first.
  return <EChart option={option} height={height} aria-label={ariaLabel} exportsCsv={false} />;
}
