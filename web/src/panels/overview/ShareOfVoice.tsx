import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { colorBarsOption } from "../../charts/bars";
import { foldSlices, otherColor, type Slice } from "../../charts/pie";
import { EmptyState, Panel } from "../../components/Panel";
import { legend, tooltip } from "../../charts/style";
import { EChart } from "../../charts/echart";
import { emptyLabel } from "../../lib/empty";
import { fmt } from "../../lib/format";
import { swatch, token } from "../../charts/palette";
import { voiceRows } from "../../selectors/overview";
import { useChartShape, usePanelFilters, type PanelProps, type WithPanelId } from "../panelScope";

function doughnut(slices: Slice[]): EChartsOption {
  return {
    tooltip: {
      trigger: "item",
      ...tooltip(),
      formatter: (p: any) => `${p.name}<br/><b>${fmt(Number(p.value))}</b> (${p.percent}%)`,
    },
    legend: { ...legend(), bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["42%", "74%"],
        center: ["50%", "43%"],
        padAngle: 1.5,
        itemStyle: { borderColor: token("--chart-heat-edge"), borderWidth: 2 },
        label: {
          color: token("--color-muted"),
          fontSize: 10,
          formatter: (p: any) => (p.percent >= 3 ? `${p.percent.toFixed(0)}%` : ""),
        },
        labelLine: { lineStyle: { color: token("--chart-guide") } },
        emphasis: { label: { color: token("--color-text"), fontSize: 12, fontWeight: 600 } },
        data: slices.map((slice) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: slice.index >= 0 ? swatch(slice.index) : otherColor() },
        })),
      },
    ],
  };
}

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
  const rows = useMemo(() => voiceRows(payload, filters), [payload, filters]);
  const slices = useMemo(() => foldSlices(rows), [rows]);
  // Built only when the rows or the shape change, so another card's scope
  // leaves this chart as it is.
  const option = useMemo(
    () =>
      shape === "bar"
        ? colorBarsOption(rows.map((row) => ({ name: row.name, value: row.value, color: swatch(row.index) })))
        : doughnut(slices),
    [rows, slices, shape],
  );
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (!rows.length) {
    return (
      <Panel title="Share of voice" subtitle={`${fmt(0)} messages · 0 authors`}>
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      </Panel>
    );
  }

  const folded = slices.length < rows.length;

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
      <EChart option={option} height={300} />
    </Panel>
  );
}
