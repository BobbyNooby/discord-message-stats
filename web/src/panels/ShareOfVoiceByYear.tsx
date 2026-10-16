import type { EChartsOption } from "echarts";

import { C_AUTHOR, C_DAY, C_MSGS } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import { selectVisibleCells, yearOf } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import {
  OTHER_COLOR,
  TOOLTIP,
  emptyLabel,
  fmt,
  foldSlices,
  yearCountLabel,
  type PanelProps,
  type Slice,
} from "./timeAggregates";

/** Radius that keeps seven doughnuts legible on one row without a width probe. */
function radiusFor(count: number): number {
  if (count <= 2) return 54;
  if (count <= 4) return 44;
  if (count <= 6) return 34;
  return 27;
}

/**
 * Share of voice, year by year — `drawSovYear`: one small-multiple doughnut per
 * year, so the mix shifting over time is visible at a glance.
 */
export function ShareOfVoiceByYear({ payload, filters }: PanelProps) {
  const byYear = new Map<number, Map<number, number>>();
  let total = 0;
  for (const cell of selectVisibleCells(payload, filters)) {
    const day = payload.days[cell[C_DAY]];
    if (day === undefined) continue;
    const year = yearOf(day);
    const authors = byYear.get(year) ?? new Map<number, number>();
    authors.set(cell[C_AUTHOR], (authors.get(cell[C_AUTHOR]) ?? 0) + cell[C_MSGS]);
    byYear.set(year, authors);
    total += cell[C_MSGS];
  }
  const years = [...byYear.keys()].sort();

  if (!years.length) {
    return (
      <Panel
        title="Share of voice, year by year"
        subtitle={`${fmt(0)} messages · 0 years`}
        className="xl:col-span-3"
      >
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const radius = radiusFor(years.length);
  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      ...TOOLTIP,
      formatter: (p: any) =>
        `${p.seriesName} · ${p.name}<br/><b>${fmt(Number(p.value))}</b> (${p.percent}%)`,
    },
    series: years.map((year, yearIndex) => {
      const rows: Slice[] = [...(byYear.get(year) ?? new Map<number, number>())]
        .map(([index, value]) => ({ name: payload.authors[index]?.name ?? "?", value, index }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value);
      const slices = foldSlices(rows);
      return {
        name: String(year),
        type: "pie" as const,
        radius,
        center: [`${((yearIndex + 0.5) / years.length) * 100}%`, "52%"],
        padAngle: 1,
        itemStyle: { borderColor: "#11141c", borderWidth: 1.5 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 5, itemStyle: { borderColor: "#e7eaf2" } },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: slice.index >= 0 ? swatch(slice.index) : OTHER_COLOR },
        })),
      };
    }),
    graphic: years.map((year, yearIndex) => ({
      type: "text",
      left: `${((yearIndex + 0.5) / years.length) * 100}%`,
      top: "90%",
      style: { text: String(year), fill: "#8a93a8", fontSize: 11 },
      silent: true,
    })),
  };

  return (
    <Panel
      title="Share of voice, year by year"
      subtitle={`${fmt(total)} messages · ${yearCountLabel(years.length)} · one doughnut per year`}
      className="xl:col-span-3"
    >
      <EChart option={option} height={300} />
    </Panel>
  );
}
