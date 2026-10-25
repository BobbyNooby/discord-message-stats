import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { axisLabel, axisLine, tooltip } from "../charts/style";
import { EChart } from "../charts/echart";
import { emptyLabel } from "../lib/empty";
import { fmt } from "../lib/format";
import { ramp, token } from "../charts/palette";
import { hourLabel, timeFormatOf, type TimeFormat } from "../lib/timeFormat";
import { DOW, heatGrid, type HeatGrid } from "../selectors/time";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function heatOption(heat: HeatGrid, timeFormat: TimeFormat): EChartsOption {
  const data: [number, number, number][] = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) data.push([hour, dow, heat.grid[dow * 24 + hour]]);
  }

  return {
    tooltip: {
      ...tooltip(),
      formatter: (p: any) =>
        `${DOW[p.value[1]]} ${hourLabel(p.value[0], timeFormat)} — <b>${fmt(p.value[2])}</b> msgs`,
    },
    grid: { left: 40, right: 10, top: 8, bottom: 52 },
    xAxis: {
      type: "category",
      data: HOURS,
      axisLabel: { ...axisLabel(10), interval: 2 },
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: [...DOW],
      axisLabel: { ...axisLabel(10.5), interval: 0 },
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    visualMap: {
      min: 0,
      max: heat.max || 1,
      orient: "horizontal",
      left: "center",
      bottom: 2,
      itemWidth: 120,
      itemHeight: 10,
      textStyle: { color: token("--color-muted"), fontSize: 10 },
      inRange: { color: ramp("--chart-heat") },
    },
    series: [
      {
        type: "heatmap",
        data,
        progressive: 2000,
        itemStyle: { borderColor: token("--chart-heat-edge"), borderWidth: 1 },
      },
    ],
  };
}

/**
 * When the chat comes alive — `drawHeat`, fed by `rollup_heat` rather than the
 * calendar cells so it survives any time filter coarser than a day.
 *
 * The map is the mockup's: dark = quiet to light = busy, monotonically, so a
 * busy hour can never render darker than a quiet one (§11.4's second finding).
 */
export function Heat({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("when-the-chat-comes-alive", fallbackFilters);
  const heat = useMemo(() => heatGrid(payload, filters), [payload, filters]);
  // `ui.time_format`: the hour labels on the axis, the peak in the subtitle and
  // every tooltip are the same clock, written the way the operator asked.
  const timeFormat = timeFormatOf(payload.meta);
  const option = useMemo(() => heatOption(heat, timeFormat), [heat, timeFormat]);
  const subtitle = `${fmt(heat.total)} messages · ${payload.tz.label} · busiest ${
    DOW[heat.peakDow]
  } ${hourLabel(heat.peakHour, timeFormat)}`;

  if (!heat.total) {
    return (
      <Panel title="When the chat comes alive" subtitle={subtitle}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel title="When the chat comes alive" subtitle={subtitle}>
      <EChart option={option} height={280} />
    </Panel>
  );
}
