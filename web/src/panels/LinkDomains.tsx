import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { EMPTY_AUTHORS, noAuthorsSelected } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { domainRows } from "../selectors/links";
import { usePanelFilters } from "./panelScope";

/**
 * "Where the chat lives" — the mockup's `drawDomains`. The one Links panel that
 * honours both filters: `linkCells` is [day, author, domain, uses], so time and
 * author selection re-aggregate here in the browser (§11.2).
 *
 * The panel header carries the payload's three link totals verbatim, which is
 * what §5.11 measures: messages with a link, distinct domains, and the
 * subset that Discord also unfurled.
 */

export function linkStatsLine(stats: Payload["linkStats"]): string {
  return `${fmt(stats.msgs)} msgs · ${fmt(stats.domains)} domains · ${fmt(stats.both)} unfurled`;
}

export function LinkDomains({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("where-the-chat-lives", fallbackFilters);
  const rows = useMemo(() => domainRows(payload, filters), [payload, filters]);
  const allOff = noAuthorsSelected(payload, filters);

  const option = useMemo<EChartsOption>(
    () => {
      const sorted = rows.slice().sort((a, b) => a[1] - b[1]);
      return {
        tooltip: {
          ...tooltip(),
          formatter: (p: any) => `<b>${fmt(p.value as number)}</b> links to ${sorted[p.dataIndex]?.[0] ?? ""}`,
        },
        grid: { left: 6, right: 52, top: 6, bottom: 6, containLabel: true },
        xAxis: {
          type: "value",
          axisLabel: { ...axisLabel(10.5), formatter: (v: number) => kfmt(v) },
          splitLine: splitLine(),
        },
        yAxis: {
          type: "category",
          data: sorted.map(([domain]) => domain),
          axisLabel: { ...axisLabel(10), interval: 0, width: 150, overflow: "truncate" },
          axisLine: axisLine(),
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barWidth: "62%",
            data: sorted.map(([, uses]) => uses),
            itemStyle: { color: swatch(4), borderRadius: [0, 4, 4, 0] },
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
    <Panel title="Where the chat lives" subtitle={linkStatsLine(payload.linkStats)}>
      <p className="mb-2 text-xs text-[var(--color-muted)]">
        domains posted, extracted from message text — not from embeds
      </p>
      {!rows.length ? (
        <EmptyState>
          {allOff
            ? EMPTY_AUTHORS
            : "No links match the active filters — widen the time range, or switch an author back on."}
        </EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
