import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import type { Filters } from "../filters/reducer";

/**
 * "Embed types" — the mockup's `drawEmbedTypes`, a doughnut for the same reason
 * as providers: six named categories that are a part of one whole (§11.5).
 *
 * `embedTypes` has neither a day nor an author column, so it is a global view and
 * shows the badge when any filter is set.
 */

const MAX_SLICES = 6;
const OTHER_COLOR = "#607d8b";
const COLORS = ["#f57731", "#eb459e", "#5865f2", "#57f287", "#fee75c", "#00b0f4", "#9b59b6"];

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export type EmbedTypeSlice = { name: string; value: number; index: number };

export function foldEmbedTypes(rows: [string, number][], max = MAX_SLICES): EmbedTypeSlice[] {
  if (rows.length <= max) return rows.map(([name, value], index) => ({ name, value, index }));
  const head = rows.slice(0, max - 1).map(([name, value], index) => ({ name, value, index }));
  const tail = rows.slice(max - 1).reduce((sum, [, value]) => sum + value, 0);
  return [...head, { name: "Others", value: tail, index: -1 }];
}

export function EmbedTypes({ payload, }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const slices = useMemo(() => foldEmbedTypes(payload.embedTypes ?? []), [payload]);
  const total = useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices]);
  const folded = slices.length < (payload.embedTypes ?? []).length;
  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        backgroundColor: "#171b25",
        borderColor: "#2b3244",
        textStyle: { color: "#e7eaf2", fontSize: 12 },
        formatter: (p: any) => `${p.name}<br><b>${fmt(p.value as number)}</b> embeds (${p.percent}%)`,
      },
      legend: {
        type: "scroll",
        bottom: 0,
        itemGap: 11,
        textStyle: { color: "#8a93a8", fontSize: 10.5 },
        inactiveColor: "#3a4257",
        itemWidth: 10,
        itemHeight: 8,
      },
      series: [
        {
          type: "pie",
          radius: ["46%", "72%"],
          center: ["50%", "43%"],
          avoidLabelOverlap: true,
          padAngle: 1.5,
          itemStyle: { borderColor: "#11141c", borderWidth: 2 },
          label: {
            color: "#8a93a8",
            fontSize: 10,
            formatter: (p: any) => (p.percent >= 4 ? `${p.percent.toFixed(0)}%` : ""),
          },
          labelLine: { lineStyle: { color: "#3a4257" } },
          emphasis: { label: { color: "#e7eaf2", fontSize: 12, fontWeight: 600 } },
          data: slices.map((slice) => ({
            name: slice.name,
            value: slice.value,
            itemStyle: { color: slice.index >= 0 ? COLORS[slice.index % COLORS.length] : OTHER_COLOR },
          })),
        },
      ],
    }),
    [slices],
  );

  return (
    <Panel
      title="Embed types"
      badge={<GlobalOnlyBadge what="The embed-type rollup" />}
      subtitle={`video, gifv, link, article… · ${fmt(total)} embeds${
        folded ? ` · top ${MAX_SLICES - 1}, rest as Others` : ""
      }`}
    >
      {!slices.length ? (
        <EmptyState>No embed data in this payload.</EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
