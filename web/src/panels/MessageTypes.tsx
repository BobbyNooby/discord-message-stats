import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { hasTimeFilter } from "../filters/selectors";
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

const TITLE = "Message types";

/**
 * Calls, pins, polls, joins… The payload keeps one row per type with no date
 * or author column, so a time filter cannot change it — it says so instead.
 */
export function MessageTypes({ payload, filters }: MediaPanelProps) {
  const rows = typeRows(payload);
  const blank =
    globalEmpty(payload, filters) ?? (rows.length ? null : "No message types in this history.");
  const total = sumRows(rows);

  return (
    <Panel
      title={TITLE}
      subtitle={`calls, pins, polls, joins… · ${fmt(total)} messages across ${rows.length} types`}
      badge={hasTimeFilter(filters) ? <GlobalOnlyBadge what={TITLE} /> : null}
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
