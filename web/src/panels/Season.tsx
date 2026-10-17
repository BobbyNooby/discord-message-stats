import { C_DAY, C_MSGS } from "../api/types";
import type { EChartsOption } from "echarts";

import { EmptyState, Panel } from "../components/Panel";
import { selectVisibleCells } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { AXIS, MON, TOOLTIP, emptyLabel, fmt, kfmt, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

/**
 * Which month of the year — `drawSeason`: every year pooled into twelve bars,
 * which is the only way a seasonal habit shows through six years of drift.
 */
export function Season({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("which-month-of-the-year", fallbackFilters);
  const months = new Array<number>(12).fill(0);
  const years = new Set<string>();
  let total = 0;
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const month = Number(day.slice(5, 7)) - 1;
    if (month < 0 || month > 11) continue;
    months[month] += cell[C_MSGS];
    total += cell[C_MSGS];
    years.add(day.slice(0, 4));
  }

  if (!total) {
    return (
      <Panel title="Which month of the year" subtitle={`${fmt(0)} messages · 12 months pooled`}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const peak = Math.max(...months);
  const peakMonth = MON[months.indexOf(peak)];

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (p: any) => `${MON[p.dataIndex]} — <b>${fmt(Number(p.value))}</b> msgs`,
    },
    grid: { left: 44, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: "category",
      data: [...MON],
      axisLabel: { color: "#8a93a8", fontSize: 10, interval: 0 },
      axisLine: { lineStyle: { color: "#2b3244" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#8a93a8", fontSize: 10.5, formatter: kfmt },
      splitLine: AXIS.splitLine,
    },
    series: [
      {
        type: "bar",
        barWidth: "60%",
        data: months.map((value) => ({
          value,
          itemStyle: {
            color: value === peak ? "#57f287" : "#1abc9c",
            borderRadius: [3, 3, 0, 0],
          },
        })),
      },
    ],
  };

  return (
    <Panel
      title="Which month of the year"
      subtitle={`${fmt(total)} messages pooled over ${years.size} years · peak ${peakMonth}`}
    >
      <EChart option={option} height={280} />
    </Panel>
  );
}
