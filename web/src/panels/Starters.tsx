import { useMemo } from "react";

import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { EChart } from "../lib/echart";
import { emptyFor } from "../lib/empty";
import { fmt, kfmt } from "../lib/format";
import { starterRows } from "../selectors/people";
import { usePanelFilters } from "./panelScope";
import { hbarOption } from "../charts/bars";

/** "Who starts conversations" — `rollup_starter`, so the time filter cannot apply. */
export function Starters({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-starts-conversations", fallbackFilters);
  const rows = useMemo(() => starterRows(payload, filters), [payload, filters]);
  const option = useMemo(
    () =>
      hbarOption(rows, {
        axis: kfmt,
        tooltip: (row) => `${row.name}<br>started <b>${fmt(row.value)}</b> conversations`,
      }),
    [rows],
  );

  if (!rows.length) {
    return (
      <Panel title="Who starts conversations">
        <EmptyState>{emptyFor("conversation starts")}</EmptyState>
      </Panel>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Panel
      title="Who starts conversations"
      subtitle={`${fmt(total)} conversations started · ${rows.length} authors`}
    >
      <EChart option={option} height={Math.max(180, rows.length * 26)} />
    </Panel>
  );
}
