import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";

import { Chip } from "../components/AppShell";
import { EmptyState, Panel } from "../components/Panel";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { hourLabel, timeFormatOf, type TimeFormat } from "../lib/timeFormat";
import { byHour, heatGrid } from "../selectors/time";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

type Style = "bar" | "rose";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourOption(hours: number[], style: Style, timeFormat: TimeFormat): EChartsOption {
  const peak = Math.max(...hours);
  const data = hours.map((value) => ({
    value,
    itemStyle: {
      color: value === peak ? token("--chart-peak") : swatch(0),
      borderRadius: [3, 3, 0, 0] as [number, number, number, number],
    },
  }));
  const hover = {
    ...tooltip(),
    formatter: (p: any) => `${hourLabel(p.dataIndex, timeFormat)} — <b>${fmt(Number(p.value))}</b> msgs`,
  };

  return style === "rose"
    ? {
        tooltip: hover,
        polar: { center: ["50%", "52%"], radius: ["14%", "78%"] },
        angleAxis: {
          type: "category",
          data: HOURS,
          startAngle: 90,
          axisLabel: { ...axisLabel(9), interval: 1 },
          axisLine: axisLine(),
          axisTick: { show: false },
          splitLine: { show: false },
        },
        radiusAxis: {
          axisLabel: { color: token("--chart-axis-dim"), fontSize: 9, formatter: kfmt },
          splitLine: splitLine(),
          axisLine: { show: false },
        },
        series: [{ type: "bar", coordinateSystem: "polar", barWidth: "72%", data }],
      }
    : {
        tooltip: hover,
        grid: { left: 44, right: 12, top: 12, bottom: 24 },
        xAxis: {
          type: "category",
          data: HOURS,
          axisLabel: { ...axisLabel(10), interval: 3 },
          axisLine: axisLine(),
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          axisLabel: { ...axisLabel(10.5), formatter: kfmt },
          splitLine: splitLine(),
        },
        series: [{ type: "bar", barWidth: "74%", data }],
      };
}

/**
 * What time of day — the mockup's `drawHour`, both of its shapes: a plain bar
 * chart, and the polar rose, which reads as a clock face and shows the
 * overnight dip as a gap rather than as two low bars.
 */
export function TimeOfDay({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("what-time-of-day", fallbackFilters);
  const [style, setStyle] = useState<Style>("bar");
  const heat = useMemo(() => heatGrid(payload, filters), [payload, filters]);
  const hours = useMemo(() => byHour(heat.grid), [heat]);
  const busiest = hours.indexOf(Math.max(...hours));
  // `ui.time_format`: the peak and every tooltip read the same clock.
  const timeFormat = timeFormatOf(payload.meta);
  const option = useMemo(() => hourOption(hours, style, timeFormat), [hours, style, timeFormat]);
  const subtitle = `${fmt(heat.total)} messages · ${payload.tz.label} · peak ${hourLabel(busiest, timeFormat)}`;

  if (!heat.total) {
    return (
      <Panel
        title="What time of day"
        subtitle={subtitle}
        badge={
          <StyleToggle style={style} onChange={setStyle} />
        }
      >
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel title="What time of day" subtitle={subtitle} badge={<StyleToggle style={style} onChange={setStyle} />}>
      <EChart option={option} height={280} />
    </Panel>
  );
}

function StyleToggle({ style, onChange }: { style: Style; onChange: (next: Style) => void }) {
  return (
    <div className="flex gap-1">
      {(["bar", "rose"] as Style[]).map((entry) => (
        <Chip
          key={entry}
          active={style === entry}
          onClick={() => onChange(entry)}
          title={`Show the hour distribution as a ${entry === "bar" ? "bar chart" : "polar rose"}`}
        >
          {entry === "bar" ? "Bar" : "Rose"}
        </Chip>
      ))}
    </div>
  );
}
