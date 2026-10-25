import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { globalEmpty, emptyFor } from "../lib/empty";
import { fmt } from "../lib/format";
import {
  emojiColor,
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
  const rows = useMemo(() => pairRows(payload.emoji, 14), [payload]);
  const option = useMemo(() => horizontalBarsOption(rows, emojiColor(), 14), [rows]);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : emptyFor("emoji"));

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
        <EChart height={330} option={option} />
      )}
    </Panel>
  );
}
