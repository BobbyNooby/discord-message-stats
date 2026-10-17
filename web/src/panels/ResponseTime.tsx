import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { TERMS } from "../lib/glossary";
import { EChart } from "../lib/echart";
import { dur, fmt, hbarOption, responseRows, weightedAverage } from "./people";
import { usePanelFilters } from "./panelScope";

/** "How fast people reply" — `rollup_response`, so the time filter cannot apply. */
export function ResponseTime({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("how-fast-people-reply", fallbackFilters);
  const rows = responseRows(payload, filters);

  if (!rows.length) {
    return (
      <Panel title="How fast people reply">
        <EmptyState>No reply latencies yet — ingest, or upload a database from the Admin board.</EmptyState>
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
      <EChart
        option={hbarOption(rows, {
          axis: dur,
          label: (row) => dur(row.value),
          tooltip: (row) =>
            `${row.name}<br>averages <b>${dur(row.value)}</b> before replying, over ${fmt(row.n)} replies`,
        })}
        height={Math.max(180, rows.length * 26)}
      />
    </Panel>
  );
}
