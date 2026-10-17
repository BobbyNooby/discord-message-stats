import type { EChartsOption } from "echarts";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { activeEdges, authorName, fmt, globalTotals, TOOLTIP } from "./people";
import { usePanelFilters } from "./panelScope";

/**
 * "Who replies to whom" — `rollup_reply`, which has no date column. Node sizes
 * come from the author-filtered global totals, not from the visible cells, so
 * the picture does not move when the time filter does (§11.2).
 */
export function ReplyNetwork({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-replies-to-whom", fallbackFilters);
  const edges = activeEdges(payload, filters);
  const totals = globalTotals(payload, filters);
  const nodes = payload.authors
    .map((author, index) => ({ author, index, msgs: totals[index]?.msgs ?? 0 }))
    .filter((node) => filters.active[node.index] !== false);

  if (!nodes.length) {
    return (
      <Panel
        title="Who replies to whom"
        badge={true ? <GlobalOnlyBadge what="Reply pairs" /> : null}
      >
        <EmptyState>No authors selected.</EmptyState>
      </Panel>
    );
  }

  const replies = edges.reduce((sum, edge) => sum + edge[2], 0);
  const links = edges.map(([from, to, msgs]) => ({
    source: authorName(payload, from),
    target: authorName(payload, to),
    value: msgs,
  }));

  const option: EChartsOption = {
    tooltip: {
      ...TOOLTIP,
      formatter: (params: any) =>
        params.dataType === "edge"
          ? `${params.data.source} → ${params.data.target}<br><b>${fmt(params.data.value ?? 0)}</b> replies`
          : `${params.data.name}<br><b>${fmt(params.data.value ?? 0)}</b> messages`,
    },
    series: [
      {
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        data: nodes.map((node) => ({
          name: node.author.name,
          value: node.msgs,
          symbolSize: Math.max(15, Math.sqrt(node.msgs) / 9),
          itemStyle: { color: swatch(node.index), opacity: 0.92 },
          label: { show: true, color: "#e7eaf2", fontSize: 10 },
        })),
        links,
        force: { repulsion: 210, edgeLength: [44, 130], gravity: 0.09, friction: 0.22 },
        lineStyle: { color: "#4a5570", curveness: 0.14, opacity: 0.7 },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 6,
        emphasis: { focus: "adjacency", lineStyle: { width: 3, color: "#8ea1ff" } },
        label: { position: "right" },
      },
    ],
  };

  return (
    <Panel
      title="Who replies to whom"
      subtitle={`${nodes.length} authors · ${links.length} reply pairs · ${fmt(replies)} replies`}
      badge={true ? <GlobalOnlyBadge what="Reply pairs" /> : null}
    >
      <EChart option={option} height={320} />
    </Panel>
  );
}
