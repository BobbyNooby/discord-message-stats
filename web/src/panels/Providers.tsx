import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import type { Filters } from "../filters/reducer";

/**
 * "Embed providers" — the mockup's `drawProviders`.
 *
 * A part-of-whole with few categories, so §11.5 allows a doughnut; a chat can
 * still have more providers than the eye can tell apart, so the tail folds into
 * one "Others" wedge rather than growing an eighth indistinguishable colour.
 *
 * `providers` is a flat [name, embeds] list with no day or author column, so it
 * cannot re-aggregate under a filter, and says so (§11.2).
 */

const MAX_SLICES = 6;
const OTHER_COLOR = "#607d8b";
const COLORS = ["#eb459e", "#5865f2", "#57f287", "#fee75c", "#00b0f4", "#f57731", "#9b59b6", "#1abc9c"];

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export type EmbedsSlice = { name: string; value: number; index: number };

export function foldEmbeds(rows: [string, number][], max = MAX_SLICES): EmbedsSlice[] {
  if (rows.length <= max) return rows.map(([name, value], index) => ({ name, value, index }));
  const head = rows.slice(0, max - 1).map(([name, value], index) => ({ name, value, index }));
  const tail = rows.slice(max - 1).reduce((sum, [, value]) => sum + value, 0);
  return [...head, { name: "Others", value: tail, index: -1 }];
}

export function Providers({ payload, }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const slices = useMemo(() => foldEmbeds(payload.providers ?? []), [payload]);
  const total = useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices]);
  const folded = slices.length < (payload.providers ?? []).length;

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
      title="Embed providers"
      badge={<GlobalOnlyBadge what="The provider rollup" />}
      subtitle={`who Discord unfurled · ${fmt(total)} embeds${
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
