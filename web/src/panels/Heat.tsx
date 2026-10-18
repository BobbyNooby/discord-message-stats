import type { EChartsOption } from "echarts";

import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { chartHeat, chartHeatEdge, token } from "../lib/palette";
import { hourLabel, timeFormatOf } from "../lib/timeFormat";
import { DOW, TOOLTIP, emptyLabel, fmt, heatGrid, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * When the chat comes alive — `drawHeat`, fed by `rollup_heat` rather than the
 * calendar cells so it survives any time filter coarser than a day.
 *
 * The map is the mockup's: dark = quiet to light = busy, monotonically, so a
 * busy hour can never render darker than a quiet one (§11.4's second finding).
 */
export function Heat({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("when-the-chat-comes-alive", fallbackFilters);
  const heat = heatGrid(payload, filters);
  // `ui.time_format`: the hour labels on the axis, the peak in the subtitle and
  // every tooltip are the same clock, written the way the operator asked.
  const timeFormat = timeFormatOf(payload.meta);
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

  const data: [number, number, number][] = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) data.push([hour, dow, heat.grid[dow * 24 + hour]]);
  }

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (p: any) =>
        `${DOW[p.value[1]]} ${hourLabel(p.value[0], timeFormat)} — <b>${fmt(p.value[2])}</b> msgs`,
    },
    grid: { left: 40, right: 10, top: 8, bottom: 52 },
    xAxis: {
      type: "category",
      data: HOURS,
      axisLabel: { color: token("--color-muted"), fontSize: 10, interval: 2 },
      axisLine: { lineStyle: { color: token("--color-line") } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: [...DOW],
      axisLabel: { color: token("--color-muted"), fontSize: 10.5, interval: 0 },
      axisLine: { lineStyle: { color: token("--color-line") } },
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
      inRange: { color: chartHeat() },
    },
    series: [
      {
        type: "heatmap",
        data,
        progressive: 2000,
        itemStyle: { borderColor: chartHeatEdge(), borderWidth: 1 },
      },
    ],
  };

  return (
    <Panel title="When the chat comes alive" subtitle={subtitle}>
      <EChart option={option} height={280} />
    </Panel>
  );
}
