import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import { useWords } from "../api/queries";
import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { axisLabel, axisLine, splitLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { EMPTY_AUTHORS, noAuthorsSelected } from "../lib/empty";
import { fmt } from "../lib/format";
import { swatch, token } from "../lib/palette";
import { monthLabel, monthlyStacks } from "../selectors/months";
import { answerFor, inPeriod, periodLabel, periodOf } from "../selectors/wordPeriod";
import { remoteRows, whoSaysItRows } from "../selectors/words";
import { MonthlyBars } from "./MonthlyBars";
import { usePanelFilters } from "./panelScope";

/**
 * "Who says it" — the mockup's `drawWordLead`, plus when they said it.
 *
 * The per-author bars come from the payload when the word is in the shipped
 * slice; any other word is answered by `/api/words`, which reads the full
 * index. That same request carries the word's month-by-month timeline, so a
 * word nobody would find in the top 500 still gets both charts.
 */

export const OUTSIDE_SLICE = "No per-author breakdown — outside the indexed slice.";

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
  const yearsKey = filters.years.join(",");
  const period = useMemo(
    () => periodOf({ from: filters.from, to: filters.to, years: yearsKey ? yearsKey.split(",").map(Number) : [] }),
    [filters.from, filters.to, yearsKey],
  );
  // One request per picked word (never per keystroke): the timeline for any
  // word, and the breakdown too when the slice has none.
  const remote = useWords(word ?? "", Boolean(word));
  // Under a time filter the all-time payload slice is the wrong count, so
  // every number comes from the word's own months, cut to the period. Memoised
  // because the cut is a new object, which would redraw both charts on every render.
  const found = useMemo(() => answerFor(remote.data, period), [remote.data, period]);
  const inSlice = !period && Boolean(word && payload.wordAuthors[word]);
  const waiting = Boolean(period && word && !remote.data);
  const unbuilt = Boolean(period && remote.data && !remote.data.months);
  const rows = useMemo(
    () =>
      inSlice || !found ? whoSaysItRows(payload, filters, word) : remoteRows(payload, filters, found.authors),
    [payload, filters, word, inSlice, found],
  );
  const indexed = inSlice || Boolean(found && found.total > 0);
  const stacks = useMemo(
    () =>
      found?.months
        ? monthlyStacks(found.months.filter((row) => inPeriod(row.month, period)), payload.authors, filters.active)
        : null,
    [found, period, payload.authors, filters.active],
  );
  // The bars honour the author selection, so the total has to as well or the
  // subtitle would disagree with the chart beside it.
  const total = useMemo(() => rows.reduce((sum, row) => sum + row.value, 0), [rows]);
  const allOff = noAuthorsSelected(payload, filters);

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: {
        ...tooltip(),
        formatter: (p: any) => `${p.name}<br><b>${fmt(p.value as number)}</b> uses of “${word}”`,
      },
      grid: { left: 6, right: 52, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { ...axisLabel(10.5), interval: 0, width: 96, overflow: "truncate" },
        splitLine: splitLine(),
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.name),
        axisLabel: axisLabel(10.5),
        axisLine: axisLine(),
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
            color: token("--color-muted"),
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
      subtitle={
        word
          ? period
            ? `${fmt(total)} uses in ${periodLabel(period)}`
            : `${fmt(total)} uses total`
          : "click a word in the index"
      }
    >
      {!word ? (
        <EmptyState>Click a word in the index to see who says it.</EmptyState>
      ) : waiting ? (
        <EmptyState>{`Counting “${word}” for ${periodLabel(period!)}…`}</EmptyState>
      ) : unbuilt ? (
        <EmptyState>Words by year need one rebuild — Recalculate on the Admin board.</EmptyState>
      ) : !indexed ? (
        <EmptyState>
          {remote.isFetching
            ? `Looking “${word}” up in the full index…`
            : period
              ? `Nobody said “${word}” in ${periodLabel(period)}.`
              : OUTSIDE_SLICE}
        </EmptyState>
      ) : allOff ? (
        <EmptyState>{EMPTY_AUTHORS}</EmptyState>
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
