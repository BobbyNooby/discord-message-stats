import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { axisLabel, axisLine, tooltip } from "../lib/chartStyle";
import { EChart } from "../lib/echart";
import { EMPTY_AUTHORS, emptyFor } from "../lib/empty";
import { TERMS } from "../lib/glossary";
import { ramp, token } from "../lib/palette";
import { periodNote, periodPrefix, useWordView } from "../selectors/wordPeriod";
import { liftGrid, type LiftCell } from "../selectors/words";
import { usePanelFilters } from "./panelScope";

/** "Whose word is it" — the mockup's `drawLift`; the numbers are `liftGrid`'s. */
export function WordLift({ payload: full, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("word-lift", fallbackFilters);
  // The payload's words, or the period's while a time filter is on.
  const view = useWordView(full, filters);
  const payload = view.payload;
  const note = periodNote(view);
  const grid = useMemo(() => liftGrid(payload, filters), [payload, filters]);
  const anyActive = payload.authors.some((_, index) => filters.active[index] !== false);

  const option = useMemo<EChartsOption>(() => {
    // Rare to 3×+, read when the option is built so a theme reaches it.
    const steps = ramp("--chart-lift");
    return {
      tooltip: {
        ...tooltip(),
        formatter: (p: any) => {
          const [x, y, lift] = p.value as LiftCell;
          return `${grid.names[x]} · “${grid.words[y]}”<br>lift <b>${lift.toFixed(2)}×</b> their normal rate`;
        },
      },
      grid: { left: 6, right: 14, top: 8, bottom: 14, containLabel: true },
      xAxis: {
        type: "category",
        data: grid.names,
        axisLabel: { ...axisLabel(9.5), rotate: 38, interval: 0 },
        axisLine: axisLine(),
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: grid.words,
        axisLabel: axisLabel(10.5),
        axisLine: axisLine(),
        axisTick: { show: false },
      },
      visualMap: {
        type: "piecewise",
        orient: "horizontal",
        left: "center",
        bottom: -4,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: token("--color-muted"), fontSize: 9.5 },
        pieces: [
          { min: 3, label: "3×+", color: steps[4] },
          { min: 2, max: 2.999, label: "2×", color: steps[3] },
          { min: 1.3, max: 1.999, label: "1.3×", color: steps[2] },
          { min: 0.8, max: 1.299, label: "avg", color: steps[1] },
          { max: 0.799, label: "rare", color: steps[0] },
        ],
      },
      series: [
        {
          type: "heatmap",
          data: grid.cells,
          progressive: 1000,
          itemStyle: { borderColor: token("--chart-heat-edge"), borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: token("--color-text"), borderWidth: 1 } },
        },
      ],
    };
  }, [grid]);

  return (
    <Panel
      title="Whose word is it"
      subtitle={`${periodPrefix(view)}lift = how much more this person uses a word than their share of all words · 1.0 = exactly average`}
      help={TERMS.lift}
    >
      {note ? (
        <EmptyState>{note}</EmptyState>
      ) : !payload.words.length ? (
        <EmptyState>{emptyFor("words")}</EmptyState>
      ) : !anyActive ? (
        <EmptyState>{EMPTY_AUTHORS}</EmptyState>
      ) : (
        <EChart option={option} height={430} />
      )}
    </Panel>
  );
}
