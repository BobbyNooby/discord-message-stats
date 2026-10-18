import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { swatch } from "../lib/palette";
import { foldPie, pieNote, pieOption } from "./chartShape";
import {
  allTypeRows,
  fmt,
  globalEmpty,
  horizontalBarsOption,
  sumRows,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { useChartShape, usePanelFilters } from "./panelScope";

const TITLE = "Message types";

/**
 * Calls, pins, polls, joins… The payload keeps one row per type with no date
 * or author column, so a time filter cannot change it; the Media section note
 * names it once.
 *
 * Both shapes read the same rows: the bar draws every type, the pie folds the
 * tail into "Other" and says how much of the list that is (`pieNote`), because
 * `rollup_type` is the one rollup here that ships every row rather than a cut.
 */
export function MessageTypes({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("message-types", fallbackFilters);
  const shape = useChartShape("message-types");
  const rows = allTypeRows(payload);
  const total = sumRows(rows);
  const blank =
    globalEmpty(payload, filters) ?? (rows.length ? null : "No message types in this history.");

  return (
    <Panel
      title={TITLE}
      subtitle={
        shape === "pie"
          ? `calls, pins, polls, joins… · ${pieNote(rows, "types")} · ${fmt(total)} messages`
          : `calls, pins, polls, joins… · ${fmt(total)} messages across ${rows.length} types`
      }
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : shape === "pie" ? (
        <EChart height={300} option={pieOption(foldPie(rows), "messages")} />
      ) : (
        <EChart height={300} option={horizontalBarsOption(rows, swatch(1), 11)} />
      )}
    </Panel>
  );
}
