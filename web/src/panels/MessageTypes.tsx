import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { PALETTE } from "../lib/palette";
import {
  doughnutOption,
  fmt,
  globalEmpty,
  sumRows,
  typeRows,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const TITLE = "Message types";

/**
 * Calls, pins, polls, joins… The payload keeps one row per type with no date
 * or author column, so a time filter cannot change it — it says so instead.
 */
export function MessageTypes({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("message-types", fallbackFilters);
  const rows = typeRows(payload);
  const blank =
    globalEmpty(payload, filters) ?? (rows.length ? null : "No message types in this history.");
  const total = sumRows(rows);

  return (
    <Panel
      title={TITLE}
      subtitle={`calls, pins, polls, joins… · ${fmt(total)} messages across ${rows.length} types`}
      badge={<GlobalOnlyBadge what={TITLE} />}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart
          height={300}
          option={doughnutOption(
            rows.map((row, index) => ({ ...row, color: PALETTE[index % PALETTE.length] })),
            "messages",
          )}
        />
      )}
    </Panel>
  );
}
