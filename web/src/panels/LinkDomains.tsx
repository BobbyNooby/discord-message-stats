import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { inRange } from "../filters/selectors";
import { EChart } from "../lib/echart";

/**
 * "Where the chat lives" — the mockup's `drawDomains`. The one Links panel that
 * honours both filters: `linkCells` is [day, author, domain, uses], so time and
 * author selection re-aggregate here in the browser (§11.2).
 *
 * The panel header carries the payload's three link totals verbatim, which is
 * what §5.11 measures: messages with a link, distinct domains, and the
 * subset that Discord also unfurled.
 */

/** The top cut §5.11 documents; the long tail is already dropped from the payload. */
const TOP_DOMAINS = 15;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const kfmt = (n: number) => {
  const value = Math.round(n);
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
};

export function linkStatsLine(stats: Payload["linkStats"]): string {
  return `${fmt(stats.msgs)} msgs · ${fmt(stats.domains)} domains · ${fmt(stats.both)} unfurled`;
}

export function domainRows(
  payload: Payload,
  filters: Filters,
  top = TOP_DOMAINS,
): [string, number][] {
  const totals = new Map<number, number>();
  for (const [dayIndex, authorIndex, domainIndex, uses] of payload.linkCells ?? []) {
    if (filters.active[authorIndex] === false) continue;
    if (!inRange(payload, filters, dayIndex)) continue;
    totals.set(domainIndex, (totals.get(domainIndex) ?? 0) + uses);
  }
  return [...totals.entries()]
    .map(([index, uses]): [string, number] => [payload.linkDomains[index] ?? `#${index}`, uses])
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
}

export function LinkDomains({ payload, filters }: { payload: Payload; filters: Filters }) {
  const rows = useMemo(() => domainRows(payload, filters), [payload, filters]);
  const allOff =
    payload.authors.length > 0 && filters.active.length > 0 && !filters.active.some(Boolean);

  const option = useMemo<EChartsOption>(
    () => {
      const sorted = rows.slice().sort((a, b) => a[1] - b[1]);
      return {
        tooltip: {
          backgroundColor: "#171b25",
          borderColor: "#2b3244",
          textStyle: { color: "#e7eaf2", fontSize: 12 },
          formatter: (p: any) => `<b>${fmt(p.value as number)}</b> links to ${sorted[p.dataIndex]?.[0] ?? ""}`,
        },
        grid: { left: 6, right: 52, top: 6, bottom: 6, containLabel: true },
        xAxis: {
          type: "value",
          axisLabel: { color: "#8a93a8", fontSize: 10.5, formatter: (v: number) => kfmt(v) },
          splitLine: { lineStyle: { color: "#1b202c" } },
        },
        yAxis: {
          type: "category",
          data: sorted.map(([domain]) => domain),
          axisLabel: { color: "#8a93a8", fontSize: 10, width: 150, overflow: "truncate" },
          axisLine: { lineStyle: { color: "#2b3244" } },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barWidth: "62%",
            data: sorted.map(([, uses]) => uses),
            itemStyle: { color: "#00b0f4", borderRadius: [0, 4, 4, 0] },
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
    <Panel title="Where the chat lives" subtitle={linkStatsLine(payload.linkStats)}>
      <p className="mb-2 text-xs text-[var(--color-muted)]">
        domains posted, extracted from message text — not from embeds
      </p>
      {!rows.length ? (
        <EmptyState>{allOff ? "No authors selected." : "No links in this filter."}</EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
