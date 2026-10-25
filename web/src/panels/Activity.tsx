import { useMemo, useState } from "react";
import type { EChartsOption, LineSeriesOption } from "echarts";

import type { Payload } from "../api/types";
import { Chip } from "../components/AppShell";
import { EmptyState, Panel } from "../components/Panel";
import { axis, axisLabel, legend, splitLine, tooltip } from "../charts/style";
import { EChart } from "../charts/echart";
import { emptyLabel } from "../lib/empty";
import { bucketCountLabel, fmt, kfmt } from "../lib/format";
import { swatch, token } from "../charts/palette";
import { activeAuthorIndices, bucketSeries, type BucketSeries } from "../selectors/time";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

type Mode = "stacked" | "lines" | "total";

const MODES: { id: Mode; label: string }[] = [
  { id: "stacked", label: "Stacked" },
  { id: "lines", label: "Lines" },
  { id: "total", label: "Total" },
];

function activityOption(
  payload: Payload,
  buckets: BucketSeries,
  authors: number[],
  mode: Mode,
): EChartsOption {
  const lines: LineSeriesOption[] = [];
  if (mode !== "total") {
    for (const index of authors) {
      const data = buckets.order.map((key) => buckets.per[index]?.[key] ?? 0);
      const shared = {
        name: payload.authors[index]?.name ?? `#${index}`,
        type: "line" as const,
        showSymbol: false,
        itemStyle: { color: swatch(index) },
        emphasis: { focus: "series" as const },
        data,
      };
      lines.push(
        mode === "stacked"
          ? { ...shared, stack: "t", lineStyle: { width: 1 }, areaStyle: { opacity: 0.62 } }
          : { ...shared, lineStyle: { width: 1.8 }, areaStyle: { opacity: 0.07 } },
      );
    }
  }
  lines.push({
    name: "TOTAL",
    type: "line",
    showSymbol: false,
    z: 10,
    lineStyle: { width: 2.4, color: token("--color-text") },
    itemStyle: { color: token("--color-text") },
    data: buckets.order.map((key) => buckets.sums[key] ?? 0),
  });

  return {
    tooltip: {
      trigger: "axis",
      ...tooltip(),
      axisPointer: { type: "line", lineStyle: { color: token("--chart-guide") } },
    },
    legend: legend(),
    grid: { left: 50, right: 16, top: 12, bottom: 52 },
    xAxis: { ...axis(), type: "category", boundaryGap: false, data: buckets.order },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(11), formatter: kfmt },
      splitLine: splitLine(),
    },
    series: lines,
  };
}

/**
 * Messages over time — `drawActivity`: stacked area ↔ multi-line ↔ total-only.
 *
 * The three modes are one chart, not three: the reader picks the one that
 * answers their question without leaving the panel. The TOTAL line is always
 * drawn so a mode switch never hides the headline number.
 */
export function Activity({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("messages-over-time", fallbackFilters);
  const [mode, setMode] = useState<Mode>("stacked");
  const buckets = useMemo(() => bucketSeries(payload, filters), [payload, filters]);
  const authors = useMemo(() => activeAuthorIndices(payload, filters), [payload, filters]);
  const option = useMemo(
    () => activityOption(payload, buckets, authors, mode),
    [payload, buckets, authors, mode],
  );
  const nothing = buckets.order.length === 0;

  return (
    <Panel
      title="Messages over time"
      subtitle={`${fmt(buckets.total)} messages across ${bucketCountLabel(
        buckets.order.length,
        filters.bucket,
      )} · ${authors.length} authors`}
      badge={
        <div className="flex gap-1">
          {MODES.map((entry) => (
            <Chip
              key={entry.id}
              active={mode === entry.id}
              onClick={() => setMode(entry.id)}
              title={`Show messages as ${entry.label.toLowerCase()}`}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
      }
    >
      {nothing ? (
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      ) : (
        <EChart option={option} height={300} />
      )}
    </Panel>
  );
}
