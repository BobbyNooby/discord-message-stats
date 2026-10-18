import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  reactionColor,
  fmt,
  globalEmpty,
  horizontalBarsOption,
  pairCount,
  pairRows,
  pairTotal,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const TITLE = "Reactions";

/** Reactions from the raw JSON column. Global only: `rollup_reaction` has no date. */
export function Reactions({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("reactions", fallbackFilters);
  const rows = pairRows(payload.reactions, 14);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : "No reactions yet — ingest, or upload a database from the Admin board.");

  return (
    <Panel
      title={TITLE}
      subtitle={`from the raw JSON column · ${fmt(pairTotal(payload.reactions))} reactions across ${pairCount(
        payload.reactions,
      )} emoji`}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart height={330} option={horizontalBarsOption(rows, reactionColor(), 13)} />
      )}
    </Panel>
  );
}
