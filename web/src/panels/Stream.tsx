import type { EChartsOption, LineSeriesOption } from "echarts";

import { EmptyState, Panel } from "../components/Panel";
import { axis, axisLabel, legend, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { emptyLabel } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { swatch } from "../lib/palette";
import {
  activeAuthorIndices,
  bucketCountLabel,
  bucketSeries,
  type PanelProps,
} from "./timeAggregates";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

/**
 * Who was talking, when — `drawStream`: a streamgraph, which is "Messages over
 * time" in stacked mode with the silhouette smoothed out and the per-author
 * line weights removed, so compositional shifts are what you see first.
 */
export function Stream({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("who-was-talking-when", fallbackFilters);
  const buckets = bucketSeries(payload, filters);
  const authors = activeAuthorIndices(payload, filters);
  const nothing = buckets.order.length === 0;

  const series: LineSeriesOption[] = authors.map((index) => ({
    name: payload.authors[index]?.name ?? `#${index}`,
    type: "line",
    stack: "s",
    showSymbol: false,
    smooth: true,
    lineStyle: { width: 0 },
    areaStyle: { opacity: 0.85 },
    emphasis: { focus: "series" },
    itemStyle: { color: swatch(index) },
    data: buckets.order.map((key) => buckets.per[index]?.[key] ?? 0),
  }));

  const option: EChartsOption = {
    tooltip: { trigger: "axis", ...tooltip() },
    legend: legend(),
    grid: { left: 52, right: 16, top: 14, bottom: 52 },
    xAxis: { ...axis(), type: "category", boundaryGap: false, data: buckets.order },
    yAxis: {
      type: "value",
      axisLabel: { ...axisLabel(10.5), formatter: kfmt },
      splitLine: splitLine(),
    },
    series,
  };

  return (
    <Panel
      title="Who was talking, when"
      subtitle={`${fmt(buckets.total)} messages across ${bucketCountLabel(
        buckets.order.length,
        filters.bucket,
      )} · ${authors.length} authors`}
    >
      {nothing ? (
        <EmptyState>{emptyLabel(payload, filters)}</EmptyState>
      ) : (
        <EChart option={option} height={320} />
      )}
    </Panel>
  );
}
