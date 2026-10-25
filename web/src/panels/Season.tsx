import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { C_DAY, C_MSGS, type Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { selectVisibleCells } from "../selectors/cells";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch } from "../lib/palette";
import { MON, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

type MonthTotals = {
  /** Messages per calendar month, January first, every year pooled. */
  months: number[];
  /** How many distinct years contributed. */
  years: number;
  total: number;
};

function monthTotals(payload: Payload, filters: Filters): MonthTotals {
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
  return { months, years: years.size, total };
}

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
