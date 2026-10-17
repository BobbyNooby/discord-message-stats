import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  EMOJI_COLOR,
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

const TITLE = "Emoji in text";

/** Counted from message bodies. Global only: `rollup_emoji` has no date. */
export function Emoji({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("emoji-in-text", fallbackFilters);
  const rows = pairRows(payload.emoji, 14);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : "No emoji yet — ingest, or upload a database from the Admin board.");

  return (
    <Panel
      title={TITLE}
      subtitle={`counted from message bodies · ${fmt(pairTotal(payload.emoji))} uses across ${pairCount(
        payload.emoji,
      )} emoji`}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart height={330} option={horizontalBarsOption(rows, EMOJI_COLOR, 14)} />
      )}
    </Panel>
  );
}
