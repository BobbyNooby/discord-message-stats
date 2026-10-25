import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyFor } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { topLinkRows } from "../selectors/links";

/**
 * "Most reposted links" — the mockup's `drawTopLinks`.
 *
 * `topLinks` arrives already normalised (host + path, query and fragment
 * stripped, §5.11) as one flat list. It has no day or author column, so unlike
 * "Where the chat lives" it cannot honour either filter; the Links section note
 * names it once rather than badging the card.
 */

export function TopLinks({ payload, }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const rows = useMemo(() => topLinkRows(payload), [payload]);

  const option = useMemo<EChartsOption>(
    () => {
      const sorted = rows.slice().reverse();
      return {
        tooltip: {
          ...tooltip(),
          formatter: (p: any) => `${sorted[p.dataIndex]?.[0] ?? ""}<br><b>${fmt(p.value as number)}</b> posts`,
        },
        grid: { left: 6, right: 52, top: 6, bottom: 6, containLabel: true },
        xAxis: {
          type: "value",
          axisLabel: { ...axisLabel(10.5), formatter: (v: number) => kfmt(v) },
          splitLine: splitLine(),
        },
        yAxis: {
          type: "category",
          data: sorted.map(([link]) => link),
          axisLabel: { ...axisLabel(10), interval: 0, width: 170, overflow: "truncate" },
          axisLine: axisLine(),
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barWidth: "62%",
            data: sorted.map(([, posts]) => posts),
            itemStyle: { color: swatch(7), borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right",
              color: token("--color-muted"),
              fontSize: 10,
              formatter: (p: any) => kfmt(p.value as number),
            },
          },
        ],
      };
    },
    [rows],
  );

  return (
    <Panel
      title="Most reposted links"
      subtitle="normalised · query strings and fragments stripped"
    >
      {!rows.length ? (
        <EmptyState>{emptyFor("links")}</EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
