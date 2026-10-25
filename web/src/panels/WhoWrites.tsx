import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { EMPTY_FILTER } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { leaderLabel, leaderRows } from "../selectors/people";
import { usePanelFilters } from "./panelScope";
import { hbarOption } from "../charts/bars";

/**
 * "Who writes the most" — the same activity cells as "Who talks the most", ranked
 * by characters instead of messages. Two cards rather than one global "rank by"
 * switch: the question is which leaderboard you want, and a card can say that
 * itself (§UI/UX — no invisible global reordering).
 */
export function WhoWrites({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-writes-the-most", fallbackFilters);
  const rows = useMemo(() => leaderRows(payload, filters, "chars"), [payload, filters]);
  const option = useMemo(
    () =>
      hbarOption(rows, {
        axis: kfmt,
        tooltip: (row) => `${row.name}<br><b>${fmt(row.value)}</b> ${leaderLabel("chars")}`,
      }),
    [rows],
  );
  const label = `by ${leaderLabel("chars")}`;

  if (!rows.length) {
    return (
      <Panel title="Who writes the most" subtitle={label}>
        <EmptyState>{EMPTY_FILTER}</EmptyState>
      </Panel>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Panel
      title="Who writes the most"
      subtitle={`${label} · ${fmt(total)} ${leaderLabel("chars")} across ${rows.length} authors`}
    >
      <EChart option={option} height={Math.max(180, rows.length * 26)} />
    </Panel>
  );
}
