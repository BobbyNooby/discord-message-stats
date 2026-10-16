import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";

/**
 * "Most reposted links" — the mockup's `drawTopLinks`.
 *
 * `topLinks` arrives already normalised (host + path, query and fragment
 * stripped, §5.11) as one flat list. It has no day or author column, so unlike
 * "Where the chat lives" it cannot honour either filter — and §11.2 says a panel
 * that ignores a filter has to say so rather than quietly showing global numbers.
 */

const TOP_LINKS = 13;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const kfmt = (n: number) => {
  const value = Math.round(n);
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
};

/** True when a filter is set that this panel's payload cannot re-aggregate. */
export function narrowed(filters: Filters): boolean {
  return hasTimeFilter(filters) || filters.active.some((on) => !on);
}

export function TopLinks({ payload, filters }: { payload: Payload; filters: Filters }) {
  const rows = useMemo(
    () => (payload.topLinks ?? []).slice(0, TOP_LINKS).sort((a, b) => b[1] - a[1]),
    [payload],
  );

  const option = useMemo<EChartsOption>(
    () => {
      const sorted = rows.slice().reverse();
      return {
        tooltip: {
          backgroundColor: "#171b25",
          borderColor: "#2b3244",
          textStyle: { color: "#e7eaf2", fontSize: 12 },
          formatter: (p: any) => `${sorted[p.dataIndex]?.[0] ?? ""}<br><b>${fmt(p.value as number)}</b> posts`,
        },
        grid: { left: 6, right: 52, top: 6, bottom: 6, containLabel: true },
        xAxis: {
          type: "value",
          axisLabel: { color: "#8a93a8", fontSize: 10.5, formatter: (v: number) => kfmt(v) },
          splitLine: { lineStyle: { color: "#1b202c" } },
        },
        yAxis: {
          type: "category",
          data: sorted.map(([link]) => link),
          axisLabel: { color: "#8a93a8", fontSize: 10, width: 170, overflow: "truncate" },
          axisLine: { lineStyle: { color: "#2b3244" } },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barWidth: "62%",
            data: sorted.map(([, posts]) => posts),
            itemStyle: { color: "#1abc9c", borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right",
              color: "#8a93a8",
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
      badge={narrowed(filters) ? <GlobalOnlyBadge what="The normalised link list" /> : undefined}
      subtitle="normalised · query strings and fragments stripped"
    >
      {!rows.length ? (
        <EmptyState>No links in this payload.</EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
