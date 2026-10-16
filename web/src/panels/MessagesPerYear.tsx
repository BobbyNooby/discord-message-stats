import type { EChartsOption } from "echarts";

import { C_DAY, C_MSGS } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import { selectVisibleCells, yearOf } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { AXIS, TOOLTIP, emptyLabel, fmt, kfmt, yearCountLabel, type PanelProps } from "./timeAggregates";

/**
 * Messages per year — `drawYearBar`. Counts, not shares: this is the same data
 * as the doughnuts above it, in the form that answers "which year was biggest?"
 * without making the reader compare arc lengths.
 */
export function MessagesPerYear({ payload, filters }: PanelProps) {
  const byYear = new Map<number, number>();
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const year = yearOf(day);
    byYear.set(year, (byYear.get(year) ?? 0) + cell[C_MSGS]);
  }
  const years = [...byYear.keys()].sort();
  const total = years.reduce((sum, year) => sum + (byYear.get(year) ?? 0), 0);

  if (!years.length) {
    return (
      <Panel
        title="Messages per year"
        subtitle={`${fmt(0)} messages · 0 years`}
        className="lg:col-span-2"
      >
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const values = years.map((year) => byYear.get(year) ?? 0);
  const peak = Math.max(...values);
  const peakYear = years[values.indexOf(peak)];

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (p: any) => `${p.name} — <b>${fmt(Number(p.value))}</b> msgs`,
    },
    grid: { left: 52, right: 16, top: 16, bottom: 24 },
    xAxis: { ...AXIS, type: "category", data: years.map(String) },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8a93a8", fontSize: 10.5, formatter: kfmt },
      splitLine: AXIS.splitLine,
    },
    series: [
      {
        type: "bar",
        barWidth: "50%",
        label: {
          show: true,
          position: "top",
          color: "#8a93a8",
          fontSize: 10.5,
          formatter: (p: any) => kfmt(Number(p.value)),
        },
        data: years.map((year) => ({
          value: byYear.get(year) ?? 0,
          itemStyle: {
            color: (byYear.get(year) ?? 0) === peak ? "#c9cdfc" : "#5865f2",
            borderRadius: [4, 4, 0, 0],
          },
        })),
      },
    ],
  };

  return (
    <Panel
      title="Messages per year"
      subtitle={`${fmt(total)} messages · ${yearCountLabel(years.length)} · peak ${peakYear}`}
      className="lg:col-span-2"
    >
      <EChart option={option} height={220} />
    </Panel>
  );
}
