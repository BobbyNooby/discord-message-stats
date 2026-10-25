import { useMemo } from "react";

import { horizontalBarsOption } from "../charts/bars";
import { reactionColor } from "../charts/roles";
import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { emptyFor, globalEmpty } from "../lib/empty";
import { fmt } from "../lib/format";
import { pairCount, pairRows, pairTotal } from "../selectors/media";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

const TITLE = "Reactions";

/** Reactions from the raw JSON column. Global only: `rollup_reaction` has no date. */
export function Reactions({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("reactions", fallbackFilters);
  const rows = useMemo(() => pairRows(payload.reactions, 14), [payload]);
  const option = useMemo(() => horizontalBarsOption(rows, reactionColor(), 13), [rows]);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : emptyFor("reactions"));

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
        <EChart height={330} option={option} />
      )}
    </Panel>
  );
}
