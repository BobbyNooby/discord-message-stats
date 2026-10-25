import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { yearTotals, type YearTotals } from "../selectors/overview";
import { axis, axisLabel, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt, yearCountLabel } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

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
