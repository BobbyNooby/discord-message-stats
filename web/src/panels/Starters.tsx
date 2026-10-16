import type { Payload } from "../api/types";
import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import type { Filters } from "../filters/reducer";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";
import { fmt, hbarOption, kfmt, starterRows } from "./people";

/** "Who starts conversations" — `rollup_starter`, so the time filter cannot apply. */
export function Starters({ payload, filters }: { payload: Payload; filters: Filters }) {
  const rows = starterRows(payload, filters);
  const badge = hasTimeFilter(filters) ? <GlobalOnlyBadge what="Conversation starters" /> : null;

  if (!rows.length) {
    return (
      <Panel title="Who starts conversations" badge={badge}>
        <EmptyState>No conversation starts in the payload.</EmptyState>
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
