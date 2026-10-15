import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { hasTimeFilter } from "../filters/selectors";
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

const TITLE = "Emoji in text";

/** Counted from message bodies. Global only: `rollup_emoji` has no date. */
export function Emoji({ payload, filters }: MediaPanelProps) {
  const rows = pairRows(payload.emoji, 14);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : "No emoji in this history.");

  return (
    <Panel
      title={TITLE}
      subtitle={`counted from message bodies · ${fmt(pairTotal(payload.emoji))} uses across ${pairCount(
        payload.emoji,
      )} emoji`}
      badge={hasTimeFilter(filters) ? <GlobalOnlyBadge what={TITLE} /> : null}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart height={330} option={horizontalBarsOption(rows, EMOJI_COLOR, 14)} />
      )}
    </Panel>
  );
}
