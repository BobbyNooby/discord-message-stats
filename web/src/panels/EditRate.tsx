import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";

import type { Payload } from "../api/types";
import { Chip } from "../components/AppShell";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { axisLabel, splitLine, tooltip } from "../charts/style";
import { EChart } from "../charts/echart";
import { dur, fmt } from "../lib/format";
import { swatch } from "../charts/palette";
import {
  editRateRows,
  editTrend,
  weightedAverage,
  type EditMetric,
  type EditTrend,
  type Row,
} from "../selectors/people";
import { usePanelFilters } from "./panelScope";
import { hbarOption } from "../charts/bars";

const TITLE = "Who proofreads";

const METRICS: { key: EditMetric; label: string }[] = [
  { key: "rate", label: "edited %" },
  { key: "speed", label: "time to edit" },
];

function rankingOption(rows: Row[], metric: EditMetric): EChartsOption {
  const speed = metric === "speed";
  const barAxis = speed ? dur : (value: number) => `${value.toFixed(1)}%`;
  return hbarOption(rows, {
    axis: barAxis,
    label: (row) => barAxis(row.value),
    tooltip: (row) =>
      speed
        ? `${row.name}<br>averages <b>${dur(row.value)}</b> before fixing, over ${fmt(row.n)} edits`
        : `${row.name}<br><b>${row.value.toFixed(2)}%</b> of their messages (${fmt(row.n)}) were edited`,
  });
}

function trendOption(trend: EditTrend): EChartsOption {
  return {
    tooltip: {
      ...tooltip(),
      trigger: "axis",
      valueFormatter: (value: any) => `${value}%`,
    },
    grid: { left: 44, right: 16, top: 24, bottom: 26 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trend.order,
      axisLabel: axisLabel(10),
    },
    yAxis: {
      type: "value",
      axisLabel: {
        ...axisLabel(10.5),
        formatter: (value: number) => `${value}%`,
      },
      splitLine: splitLine(),
    },
    series: [
      {
        type: "line",
        name: "edited %",
        showSymbol: false,
        lineStyle: { width: 2, color: swatch(3) },
        itemStyle: { color: swatch(3) },
        areaStyle: { opacity: 0.12, color: swatch(3) },
        data: trend.pct,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: swatch(1), type: "dashed", width: 1 },
          label: {
            color: swatch(1),
            fontSize: 10,
            formatter: `avg ${trend.overall.toFixed(1)}%`,
          },
          data: [{ yAxis: trend.overall }],
        },
      },
    ],
  };
}

/**
 * "Who proofreads" — the rate reads edited cells (so the time filter applies),
 * the time-to-edit toggle reads `rollup_edit_speed`, which has no date column
 * and therefore gets the badge when a time filter is on (§11.2). The trend line
 * under the bars is always the filtered edit share per bucket (§5.12).
 */
export function EditRate({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-proofreads", fallbackFilters);
  const [metric, setMetric] = useState<EditMetric>("rate");
  const rows = useMemo(() => editRateRows(payload, filters, metric), [payload, filters, metric]);
  const trend = useMemo(() => editTrend(payload, filters), [payload, filters]);
  const ranking = useMemo(() => rankingOption(rows, metric), [rows, metric]);
  const trendLine = useMemo(() => trendOption(trend), [trend]);
  const speed = metric === "speed";
  const edits = rows.reduce((sum, row) => sum + row.n, 0);

  const badge = (
    <div className="flex items-center gap-2">
      {speed ? <GlobalOnlyBadge what="Time to edit" /> : null}
      <div className="flex gap-1">
        {METRICS.map((entry) => (
          <Chip
            key={entry.key}
            active={metric === entry.key}
            onClick={() => setMetric(entry.key)}
            title={
              entry.key === "speed"
                ? "Average time between posting and editing; this rollup has no date column"
                : "Share of an author's messages that were edited"
            }
          >
            {entry.label}
          </Chip>
        ))}
      </div>
    </div>
  );

  if (!rows.length && !trend.order.length) {
    return (
      <Panel title={TITLE} badge={badge}>
        <EmptyState>No edits match the active filters — widen the time range.</EmptyState>
      </Panel>
    );
  }

  const subtitle = speed
    ? `${fmt(edits)} edits · ${dur(weightedAverage(rows))} average wait before fixing`
    : `${fmt(edits)} edits · ${trend.overall.toFixed(2)}% of messages edited`;
  // The card carries two charts but offers one export, and the chart this card
  // is named for is the ranking — the trend line's own rows would arrive with
  // no author names on them. Handing the ranking over explicitly is what
  // settles which of the two the file holds.
  const csv = rows.length
    ? {
        name: TITLE,
        rows: [
          ["author", speed ? "average seconds to edit" : "edited %", "edits"],
          ...rows.map((row) => [row.name, Number(row.value.toFixed(2)), row.n]),
        ],
      }
    : undefined;

  return (
    <Panel title={TITLE} subtitle={subtitle} badge={badge} csv={csv}>
      {rows.length ? (
        <EChart option={ranking} height={Math.max(160, rows.length * 24)} />
      ) : (
        <EmptyState>No edits to show for this measure.</EmptyState>
      )}
      {trend.order.length ? (
        <EChart option={trendLine} height={170} />
      ) : null}
    </Panel>
  );
}
