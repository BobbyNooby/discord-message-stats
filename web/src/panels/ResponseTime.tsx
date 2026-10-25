import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { TERMS } from "../lib/glossary";
import { EChart } from "../charts/echart";
import { emptyFor } from "../lib/empty";
import { dur, fmt } from "../lib/format";
import { responseRows, weightedAverage } from "../selectors/people";
import { usePanelFilters } from "./panelScope";
import { hbarOption } from "../charts/bars";

/** "How fast people reply" — `rollup_response`, so the time filter cannot apply. */
export function ResponseTime({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("how-fast-people-reply", fallbackFilters);
  const rows = useMemo(() => responseRows(payload, filters), [payload, filters]);
  const option = useMemo(
    () =>
      hbarOption(rows, {
        axis: dur,
        label: (row) => dur(row.value),
        tooltip: (row) =>
          `${row.name}<br>averages <b>${dur(row.value)}</b> before replying, over ${fmt(row.n)} replies`,
      }),
    [rows],
  );

  if (!rows.length) {
    return (
      <Panel title="How fast people reply">
        <EmptyState>{emptyFor("reply latencies")}</EmptyState>
      </Panel>
    );
  }

  const replies = rows.reduce((sum, row) => sum + row.n, 0);
  return (
    <Panel
      title="How fast people reply"
      subtitle={`${fmt(replies)} replies · ${dur(weightedAverage(rows))} average wait across ${rows.length} authors`}
      help={TERMS.averageWait}
    >
      <EChart option={option} height={Math.max(180, rows.length * 26)} />
    </Panel>
  );
}
