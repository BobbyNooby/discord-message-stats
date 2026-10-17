import type { Payload } from "../api/types";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { EChart } from "../lib/echart";
import { fmt, hbarOption, kfmt, leaderLabel, leaderRows } from "./people";
import { usePanelFilters } from "./panelScope";

/** "Who talks the most" — cells, so it honours the time filter (§11.1). Its
 *  twin, "Who writes the most", ranks the same cells by characters. */
export function Leaderboard({ payload, filters: fallbackFilters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const filters = usePanelFilters("who-talks-the-most", fallbackFilters);
  const rows = leaderRows(payload, filters, "msgs");
  const label = `by ${leaderLabel("msgs")}`;

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
      subtitle={`${label} · ${fmt(total)} ${leaderLabel("msgs")} across ${rows.length} authors`}
    >
      <EChart
        option={hbarOption(rows, {
          axis: kfmt,
          tooltip: (row) => `${row.name}<br><b>${fmt(row.value)}</b> ${leaderLabel("msgs")}`,
        })}
        height={Math.max(180, rows.length * 26)}
      />
    </Panel>
  );
}
