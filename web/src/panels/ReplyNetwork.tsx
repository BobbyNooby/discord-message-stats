import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { EMPTY_AUTHORS } from "../lib/empty";
import { fmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { activeEdges, authorName, globalTotals } from "./people";
import { usePanelFilters } from "./panelScope";

type Network = {
  nodes: { name: string; index: number; msgs: number }[];
  links: { source: string; target: string; value: number }[];
  replies: number;
};

/** The switched-on authors as nodes, sized by their date-less totals, and every reply pair between them. */
function replyNetwork(payload: Payload, filters: Filters): Network {
  const edges = activeEdges(payload, filters);
  const totals = globalTotals(payload, filters);
  const nodes = payload.authors
    .map((author, index) => ({ name: author.name, index, msgs: totals[index]?.msgs ?? 0 }))
    .filter((node) => filters.active[node.index] !== false);
  const links = edges.map(([from, to, msgs]) => ({
    source: authorName(payload, from),
    target: authorName(payload, to),
    value: msgs,
  }));
  return { nodes, links, replies: edges.reduce((sum, edge) => sum + edge[2], 0) };
}

function networkOption({ nodes, links }: Network): EChartsOption {
  return {
    tooltip: {
      ...tooltip(),
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
          name: node.name,
          value: node.msgs,
          symbolSize: Math.max(15, Math.sqrt(node.msgs) / 9),
          itemStyle: { color: swatch(node.index), opacity: 0.92 },
          label: { show: true, color: token("--color-text"), fontSize: 10 },
        })),
        links,
        force: { repulsion: 210, edgeLength: [44, 130], gravity: 0.09, friction: 0.22 },
        lineStyle: { color: token("--chart-link"), curveness: 0.14, opacity: 0.7 },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 6,
        emphasis: { focus: "adjacency", lineStyle: { width: 3, color: token("--chart-link-emphasis") } },
        label: { position: "right" },
      },
    ],
  };
}

/**
 * "Who replies to whom" — `rollup_reply`, which has no date column. Node sizes
 * come from the author-filtered global totals, not from the visible cells, so
 * the picture does not move when the time filter does (§11.2).
 */
export function ReplyNetwork({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-replies-to-whom", fallbackFilters);
  const network = useMemo(() => replyNetwork(payload, filters), [payload, filters]);
  const option = useMemo(() => networkOption(network), [network]);
  const { nodes, links, replies } = network;

  if (!nodes.length) {
    return (
      <Panel title="Who replies to whom">
        <EmptyState>{EMPTY_AUTHORS}</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="Who replies to whom"
      subtitle={`${nodes.length} authors · ${links.length} reply pairs · ${fmt(replies)} replies`}
    >
      <EChart option={option} height={320} />
    </Panel>
  );
}
