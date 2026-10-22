import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { useWords } from "../api/queries";
import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { authorIndexById, monthLabel, MonthlyBars, monthlyStacks } from "./MonthlyBars";
import { usePanelFilters } from "./panelScope";

/**
 * "Who says it" — the mockup's `drawWordLead`, plus when they said it.
 *
 * The per-author bars come from the payload when the word is in the shipped
 * slice; any other word is answered by `/api/words`, which reads the full
 * index. That same request carries the word's month-by-month timeline, so a
 * word nobody would find in the top 500 still gets both charts.
 */

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export const OUTSIDE_SLICE = "No per-author breakdown — outside the indexed slice.";

export type WhoSaysItRow = { name: string; value: number; index: number };

/** The selected word's rows, filtered to the authors still switched on. */
export function whoSaysItRows(payload: Payload, filters: Filters, word: string | null): WhoSaysItRow[] {
  if (!word) return [];
  return (payload.wordAuthors[word] ?? [])
    .filter(([authorIndex]) => filters.active[authorIndex] !== false)
    .map(([authorIndex, uses]) => ({
      name: payload.authors[authorIndex]?.name ?? `#${authorIndex}`,
      value: uses,
      index: authorIndex,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => a.value - b.value);
}

/** The same rows from the server's answer, for a word outside the slice. */
export function remoteRows(
  payload: Payload,
  filters: Filters,
  authors: { id: string; count: number }[],
): WhoSaysItRow[] {
  const byId = authorIndexById(payload.authors);
  const combined = new Map<number, number>();
  for (const author of authors) {
    const index = byId.get(author.id);
    if (index === undefined || filters.active[index] === false) continue;
    combined.set(index, (combined.get(index) ?? 0) + author.count);
  }
  return [...combined.entries()]
    .map(([index, value]) => ({ name: payload.authors[index]?.name ?? `#${index}`, value, index }))
    .filter((row) => row.value > 0)
    .sort((a, b) => a.value - b.value);
}

export function WhoSaysIt({
  payload,
  filters: fallbackFilters,
  word,
}: { panelId?: string;
  payload: Payload;
  filters?: Filters;
  word: string | null;
}) {
  const filters = usePanelFilters("who-says-it", fallbackFilters);
  const inSlice = Boolean(word && payload.wordAuthors[word]);
  // One request per picked word (never per keystroke): the timeline for any
  // word, and the breakdown too when the slice has none.
  const remote = useWords(word ?? "", Boolean(word));
  const found = remote.data;
  const rows = useMemo(
    () =>
      inSlice || !found ? whoSaysItRows(payload, filters, word) : remoteRows(payload, filters, found.authors),
    [payload, filters, word, inSlice, found],
  );
  const indexed = inSlice || Boolean(found && found.total > 0);
  const stacks = useMemo(
    () => (found?.months ? monthlyStacks(found.months, payload.authors, filters.active) : null),
    [found, payload.authors, filters.active],
  );
  // The bars honour the author selection, so the total has to as well or the
  // subtitle would disagree with the chart beside it.
  const total = useMemo(() => rows.reduce((sum, row) => sum + row.value, 0), [rows]);
  const allOff =
    payload.authors.length > 0 && filters.active.length > 0 && !filters.active.some(Boolean);

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        backgroundColor: "#171b25",
        borderColor: "#2b3244",
        textStyle: { color: "#e7eaf2", fontSize: 12 },
        formatter: (p: any) => `${p.name}<br><b>${fmt(p.value as number)}</b> uses of “${word}”`,
      },
      grid: { left: 6, right: 52, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { color: "#8a93a8", fontSize: 10.5, interval: 0, width: 96, overflow: "truncate" },
        splitLine: { lineStyle: { color: "#1b202c" } },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.name),
        axisLabel: { color: "#8a93a8", fontSize: 10.5 },
        axisLine: { lineStyle: { color: "#2b3244" } },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          barWidth: "62%",
          data: rows.map((row) => ({
            value: row.value,
            itemStyle: { color: swatch(row.index), borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: "right",
            color: "#8a93a8",
            fontSize: 10,
            formatter: (p: any) => fmt(p.value as number),
          },
        },
      ],
    }),
    [rows, word],
  );

  return (
    <Panel
      // The title names the selected word, so the card states its own id.
      panelId="who-says-it"
      title={word ? `Who says “${word}”` : "Who says it"}
      subtitle={word ? `${fmt(total)} uses total` : "click a word in the index"}
    >
      {!word ? (
        <EmptyState>Click a word in the index to see who says it.</EmptyState>
      ) : !indexed ? (
        <EmptyState>
          {remote.isFetching ? `Looking “${word}” up in the full index…` : OUTSIDE_SLICE}
        </EmptyState>
      ) : allOff ? (
        <EmptyState>No authors selected — switch one back on in the filters.</EmptyState>
      ) : !rows.length ? (
        <EmptyState>None of the selected authors use this word.</EmptyState>
      ) : (
        <>
          <EChart option={option} height={Math.min(330, 64 + rows.length * 44)} />
          <WordTimeline word={word} stacks={stacks} pending={remote.isFetching} unbuilt={found?.months === null} />
        </>
      )}
    </Panel>
  );
}

function WordTimeline({
  word,
  stacks,
  pending,
  unbuilt,
}: {
  word: string;
  stacks: ReturnType<typeof monthlyStacks> | null;
  pending: boolean;
  unbuilt: boolean;
}) {
  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      <h3 className="text-xs font-medium text-[var(--color-text)]">When “{word}” gets said</h3>
      {unbuilt ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          The month-by-month view needs one rebuild — Recalculate on the Admin board.
        </p>
      ) : !stacks ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{pending ? "Loading the timeline…" : "No timeline yet."}</p>
      ) : !stacks.series.length ? (
        <p className="mt-1 text-xs text-[var(--color-muted)]">None of the selected authors use this word.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            first seen {monthLabel(stacks.first as string)} · busiest{" "}
            {monthLabel(stacks.peak!.month)} ({fmt(stacks.peak!.count)} uses)
          </p>
          <MonthlyBars stacks={stacks} unit="uses" aria-label={`Uses of “${word}” per month`} />
        </>
      )}
    </div>
  );
}
