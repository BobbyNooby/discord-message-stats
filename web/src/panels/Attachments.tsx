import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  attachColor,
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

const TITLE = "What gets attached";

/** Mime types from the raw JSON. Global only: `rollup_attachment` has no date. */
export function Attachments({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("what-gets-attached", fallbackFilters);
  const rows = pairRows(payload.attachments, 8);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : "No attachments yet — ingest, or upload a database from the Admin board.");

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
        <EChart height={300} option={horizontalBarsOption(rows, attachColor(), 9.5)} />
      )}
    </Panel>
  );
}
