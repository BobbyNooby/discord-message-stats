import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { C_DAY, C_MSGS, type Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { selectVisibleCells, yearOf } from "../selectors/cells";
import { axis, axisLabel, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { yearCountLabel, type PanelProps } from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

type YearTotals = { years: number[]; values: number[]; total: number };

/** Filtered messages per calendar year, years ascending. */
function yearTotals(payload: Payload, filters: Filters): YearTotals {
  const byYear = new Map<number, number>();
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const year = yearOf(day);
    byYear.set(year, (byYear.get(year) ?? 0) + cell[C_MSGS]);
  }
  const years = [...byYear.keys()].sort();
  const values = years.map((year) => byYear.get(year) ?? 0);
  return { years, values, total: values.reduce((sum, value) => sum + value, 0) };
}

function yearBars({ years, values }: YearTotals): EChartsOption {
  const peak = Math.max(...values);
  return {
    tooltip: {
      ...tooltip(),
      formatter: (p: any) => `${p.name} — <b>${fmt(Number(p.value))}</b> msgs`,
    },
    grid: { left: 52, right: 16, top: 16, bottom: 24 },
    xAxis: { ...axis(), type: "category", data: years.map(String) },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(10.5), formatter: kfmt },
      splitLine: splitLine(),
    },
    series: [
      {
        type: "bar",
        barWidth: "50%",
        label: {
          show: true,
          position: "top",
          color: token("--color-muted"),
          fontSize: 10.5,
          formatter: (p: any) => kfmt(Number(p.value)),
        },
        data: values.map((value) => ({
          value,
          itemStyle: {
            color: value === peak ? token("--chart-peak") : swatch(0),
            borderRadius: [4, 4, 0, 0],
          },
        })),
      },
    ],
  };
}

/**
 * Messages per year — `drawYearBar`. Counts, not shares: this is the same data
 * as the doughnuts above it, in the form that answers "which year was biggest?"
 * without making the reader compare arc lengths.
 */
export function MessagesPerYear({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("messages-per-year", fallbackFilters);
  const totals = useMemo(() => yearTotals(payload, filters), [payload, filters]);
  const option = useMemo(() => yearBars(totals), [totals]);
  const { years, values, total } = totals;

  if (!years.length) {
    return (
      <Panel
        title="Messages per year"
        subtitle={`${fmt(0)} messages · 0 years`}
      >
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const peakYear = years[values.indexOf(Math.max(...values))];

  return (
    <Panel
      title="Messages per year"
      subtitle={`${fmt(total)} messages · ${yearCountLabel(years.length)} · peak ${peakYear}`}
    >
      <EChart option={option} height={220} />
    </Panel>
  );
}
