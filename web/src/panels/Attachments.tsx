import { useMemo } from "react";

import { horizontalBarsOption } from "../charts/bars";
import { attachColor } from "../charts/roles";
import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../charts/echart";
import { emptyFor, globalEmpty } from "../lib/empty";
import { fmt } from "../lib/format";
import { pairCount, pairRows, pairTotal } from "../selectors/media";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

const TITLE = "What gets attached";

/** Mime types from the raw JSON. Global only: `rollup_attachment` has no date. */
export function Attachments({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("what-gets-attached", fallbackFilters);
  const rows = useMemo(() => pairRows(payload.attachments, 8), [payload]);
  const option = useMemo(() => horizontalBarsOption(rows, attachColor(), 9.5), [rows]);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : emptyFor("attachments"));

  return (
    <Panel
      title={TITLE}
      subtitle={`mime types from the raw JSON · ${fmt(pairTotal(payload.attachments))} attachments across ${pairCount(
        payload.attachments,
      )} mime types`}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart height={300} option={option} />
      )}
    </Panel>
  );
}
