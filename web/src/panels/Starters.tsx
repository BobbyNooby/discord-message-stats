import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { fmt, hbarOption, kfmt, starterRows } from "./people";
import { usePanelFilters } from "./panelScope";

/** "Who starts conversations" — `rollup_starter`, so the time filter cannot apply. */
export function Starters({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-starts-conversations", fallbackFilters);
  const rows = starterRows(payload, filters);
  const badge = true ? <GlobalOnlyBadge what="Conversation starters" /> : null;

  if (!rows.length) {
    return (
      <Panel title="Who starts conversations" badge={badge}>
        <EmptyState>No conversation starts yet — ingest, or upload a database from the Admin board.</EmptyState>
      </Panel>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Panel
      title="Who starts conversations"
      subtitle={`${fmt(total)} conversations started · ${rows.length} authors`}
      badge={badge}
    >
      <EChart
        option={hbarOption(rows, {
          axis: kfmt,
          tooltip: (row) => `${row.name}<br>started <b>${fmt(row.value)}</b> conversations`,
        })}
        height={Math.max(180, rows.length * 26)}
      />
    </Panel>
  );
}
