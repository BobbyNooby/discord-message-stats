import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch } from "../lib/palette";
import { MON, monthTotals } from "../selectors/time";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

function monthBars(months: number[]): EChartsOption {
  const peak = Math.max(...months);
  return {
    tooltip: {
      ...tooltip(),
      formatter: (p: any) => `${MON[p.dataIndex]} — <b>${fmt(Number(p.value))}</b> msgs`,
    },
    grid: { left: 44, right: 12, top: 12, bottom: 24 },
    xAxis: {
      type: "category",
      data: [...MON],
      axisLabel: { ...axisLabel(10), interval: 0 },
      axisLine: axisLine(),
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(10.5), formatter: kfmt },
      splitLine: splitLine(),
    },
    series: [
      {
        type: "bar",
        barWidth: "60%",
        data: months.map((value) => ({
          value,
          itemStyle: {
            color: value === peak ? swatch(2) : swatch(7),
            borderRadius: [3, 3, 0, 0],
          },
        })),
      },
    ],
  };
}

/**
 * Which month of the year — `drawSeason`: every year pooled into twelve bars,
 * which is the only way a seasonal habit shows through six years of drift.
 */
export function Season({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("which-month-of-the-year", fallbackFilters);
  const totals = useMemo(() => monthTotals(payload, filters), [payload, filters]);
  const option = useMemo(() => monthBars(totals.months), [totals]);
  const { months, years, total } = totals;

  if (!total) {
    return (
      <Panel title="Which month of the year" subtitle={`${fmt(0)} messages · 12 months pooled`}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const peakMonth = MON[months.indexOf(Math.max(...months))];

  return (
    <Panel
      title="Which month of the year"
      subtitle={`${fmt(total)} messages pooled over ${years} years · peak ${peakMonth}`}
    >
      <EChart option={option} height={280} />
    </Panel>
  );
}
