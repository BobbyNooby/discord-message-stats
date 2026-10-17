import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { fmt, hbarOption, kfmt, leaderRows, rankLabel } from "./people";
import { usePanelFilters } from "./panelScope";

/** "Who talks the most" — cells, so it honours the time filter and `rankBy` (§11.1). */
export function Leaderboard({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-talks-the-most", fallbackFilters);
  const rows = leaderRows(payload, filters);
  const label = `by ${rankLabel(filters.rankBy)}`;

  if (!rows.length) {
    return (
      <Panel title="Who talks the most" subtitle={label}>
        <EmptyState>No messages match the active filters — widen the time range, or switch an author back on.</EmptyState>
      </Panel>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <Panel
      title="Who talks the most"
      subtitle={`${label} · ${fmt(total)} ${rankLabel(filters.rankBy)} across ${rows.length} authors`}
    >
      <EChart
        option={hbarOption(rows, {
          axis: kfmt,
          tooltip: (row) => `${row.name}<br><b>${fmt(row.value)}</b> ${rankLabel(filters.rankBy)}`,
        })}
        height={Math.max(180, rows.length * 26)}
      />
    </Panel>
  );
}
