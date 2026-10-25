import { useMemo } from "react";

import type { Payload } from "../../api/types";
import { EmptyState, Panel } from "../../components/Panel";
import type { Filters } from "../../app/reducer";
import { EChart } from "../../charts/echart";
import { EMPTY_FILTER } from "../../lib/empty";
import { fmt, kfmt } from "../../lib/format";
import { leaderLabel, leaderRows } from "../../selectors/people";
import { usePanelFilters } from "../panelScope";
import { hbarOption } from "../../charts/bars";

/** "Who talks the most" — cells, so it honours the time filter (§11.1). Its
 *  twin, "Who writes the most", ranks the same cells by characters. */
export function Leaderboard({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-talks-the-most", fallbackFilters);
  const rows = useMemo(() => leaderRows(payload, filters, "msgs"), [payload, filters]);
  const option = useMemo(
    () =>
      hbarOption(rows, {
        axis: kfmt,
        tooltip: (row) => `${row.name}<br><b>${fmt(row.value)}</b> ${leaderLabel("msgs")}`,
      }),
    [rows],
  );
  const label = `by ${leaderLabel("msgs")}`;

  if (!rows.length) {
    return (
      <Panel title="Who talks the most" subtitle={label}>
        <EmptyState>{EMPTY_FILTER}</EmptyState>
      </Panel>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Panel
      title="Who talks the most"
      subtitle={`${label} · ${fmt(total)} ${leaderLabel("msgs")} across ${rows.length} authors`}
    >
      <EChart option={option} height={Math.max(180, rows.length * 26)} />
    </Panel>
  );
}
