import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { fmt, tint, TOOLTIP, treemapData } from "./people";
import { usePanelFilters } from "./panelScope";

/** "Volume by author and year" — activity cells, so both filters apply. */
export function Treemap({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("volume-by-author-and-year", fallbackFilters);
  const nodes = treemapData(payload, filters);

  if (!nodes.length) {
    return (
      <Panel title="Volume by author and year">
        <EmptyState>No messages match the current filters.</EmptyState>
      </Panel>
    );
  }

  const total = nodes.reduce((sum, node) => sum + node.total, 0);
  const years = new Set(nodes.flatMap((node) => node.years.map(([year]) => year)));

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      // The tiles are labelled by year, so the tooltip is where the author's
      // name has to come from (§11.1 groups this panel by author *and* year).
      formatter: (params: any) => {
        const author = params.treePathInfo?.[1]?.name;
        return `${author ? `${author} · ` : ""}${params.name}<br><b>${fmt(params.value)}</b> messages`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        top: 4,
        left: 4,
        right: 4,
        bottom: 4,
        itemStyle: { borderColor: "#11141c", borderWidth: 1.5, gapWidth: 1.5 },
        label: { show: true, color: "#0b0e14", fontSize: 10.5, fontWeight: 600 },
        upperLabel: { show: false },
        data: nodes.map((node) => ({
          name: node.name,
          itemStyle: { color: swatch(node.index) },
          children: node.years.map(([year, value], position) => ({
            name: year,
            value,
            itemStyle: { color: tint(swatch(node.index), 0.08 + 0.16 * (position % 4)) },
          })),
        })),
      },
    ],
  };

  return (
    <Panel
      title="Volume by author and year"
      subtitle={`${nodes.length} authors · ${years.size} years · ${fmt(total)} messages`}
    >
      <EChart option={option} height={330} />
    </Panel>
  );
}
