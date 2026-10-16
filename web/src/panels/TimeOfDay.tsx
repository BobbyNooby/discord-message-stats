import { useState } from "react";
import type { EChartsOption } from "echarts";

import { Chip } from "../components/AppShell";
import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { TOOLTIP, byHour, clock, emptyLabel, fmt, heatGrid, kfmt, type PanelProps } from "./timeAggregates";

type Style = "bar" | "rose";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * What time of day — the mockup's `drawHour`, both of its shapes: a plain bar
 * chart, and the polar rose, which reads as a clock face and shows the
 * overnight dip as a gap rather than as two low bars.
 */
export function TimeOfDay({ payload, filters }: PanelProps) {
  const [style, setStyle] = useState<Style>("bar");
  const heat = heatGrid(payload, filters);
  const hours = byHour(heat.grid);
  const peak = Math.max(...hours);
  const busiest = hours.indexOf(peak);
  const subtitle = `${fmt(heat.total)} messages · ${payload.tz.label} · peak ${clock(busiest)}`;

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

  const data = hours.map((value) => ({
    value,
    itemStyle: {
      color: value === peak ? "#c9cdfc" : "#5865f2",
      borderRadius: [3, 3, 0, 0] as [number, number, number, number],
    },
  }));
  const tooltip = {
    ...TOOLTIP,
    formatter: (p: any) => `${clock(p.dataIndex)} — <b>${fmt(Number(p.value))}</b> msgs`,
  };

  const option: EChartsOption =
    style === "rose"
      ? {
          tooltip,
          polar: { center: ["50%", "52%"], radius: ["14%", "78%"] },
          angleAxis: {
            type: "category",
            data: HOURS,
            startAngle: 90,
            axisLabel: { color: "#8a93a8", fontSize: 9, interval: 1 },
            axisLine: { lineStyle: { color: "#2b3244" } },
            axisTick: { show: false },
            splitLine: { show: false },
          },
          radiusAxis: {
            axisLabel: { color: "#5b6478", fontSize: 9, formatter: kfmt },
            splitLine: { lineStyle: { color: "#1b202c" } },
            axisLine: { show: false },
          },
          series: [{ type: "bar", coordinateSystem: "polar", barWidth: "72%", data }],
        }
      : {
          tooltip,
          grid: { left: 44, right: 12, top: 12, bottom: 24 },
          xAxis: {
            type: "category",
            data: HOURS,
            axisLabel: { color: "#8a93a8", fontSize: 10, interval: 3 },
            axisLine: { lineStyle: { color: "#2b3244" } },
            axisTick: { show: false },
          },
          yAxis: {
            type: "value",
            axisLabel: { color: "#8a93a8", fontSize: 10.5, formatter: kfmt },
            splitLine: { lineStyle: { color: "#1b202c" } },
          },
          series: [{ type: "bar", barWidth: "74%", data }],
        };

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
