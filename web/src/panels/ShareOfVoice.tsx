import type { EChartsOption } from "echarts";

import { EmptyState, Panel } from "../components/Panel";
import { selectAuthors } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import {
  LEGEND,
  TOOLTIP,
  emptyLabel,
  fmt,
  foldSlices,
  otherColor,
  type PanelProps,
  type Slice,
} from "./timeAggregates";
import { colorBarsOption } from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { useChartShape, usePanelFilters } from "./panelScope";

/**
 * Share of voice — `drawSov` from the mockup: one wedge per author, coloured by
 * the author's index so the colour means the same thing in every panel.
 *
 * §11.5 caps a doughnut at "few categories", so authors past the fifth fold into
 * one "Others" wedge; the total and the tooltip still carry them. The bar keeps
 * every author, and colour follows the author there too.
 */
export function ShareOfVoice({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("share-of-voice", fallbackFilters);
  const shape = useChartShape("share-of-voice");
  const rows: Slice[] = selectAuthors(payload, filters)
    .map((author, index) => ({ name: author.name, value: author.msgs, index }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (!rows.length) {
    return (
      <Panel title="Share of voice" subtitle={`${fmt(0)} messages · 0 authors`}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const slices = foldSlices(rows);
  const folded = slices.length < rows.length;

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      ...TOOLTIP,
      formatter: (p: any) => `${p.name}<br/><b>${fmt(Number(p.value))}</b> (${p.percent}%)`,
    },
    legend: { ...LEGEND, bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["42%", "74%"],
        center: ["50%", "43%"],
        padAngle: 1.5,
        itemStyle: { borderColor: "#11141c", borderWidth: 2 },
        label: {
          color: "#8a93a8",
          fontSize: 10,
          formatter: (p: any) => (p.percent >= 3 ? `${p.percent.toFixed(0)}%` : ""),
        },
        labelLine: { lineStyle: { color: "#3a4257" } },
        emphasis: { label: { color: "#e7eaf2", fontSize: 12, fontWeight: 600 } },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: slice.index >= 0 ? swatch(slice.index) : otherColor() },
        })),
      },
    ],
  };

  return (
    <Panel
      title="Share of voice"
      subtitle={
        shape === "bar"
          ? `${fmt(total)} messages · ${rows.length} authors`
          : `${fmt(total)} messages · ${rows.length} authors${
              folded ? " · top 5, rest as Others" : ""
            }`
      }
    >
      {shape === "bar" ? (
        <EChart
          option={colorBarsOption(
            rows.map((row) => ({ name: row.name, value: row.value, color: swatch(row.index) })),
          )}
          height={300}
        />
      ) : (
        <EChart option={option} height={300} />
      )}
    </Panel>
  );
}
