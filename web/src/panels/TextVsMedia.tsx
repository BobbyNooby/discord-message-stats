import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { EMPTY_FILTER } from "../lib/empty";
import { fmt, pctOf } from "../lib/format";
import {
  colorBarsOption,
  doughnutOption,
  mediaCells,
  mediaColor,
  mediaShare,
  remainderColor,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { useChartShape, usePanelFilters } from "./panelScope";

const TITLE = "Text vs media";

/** Share of messages carrying an attachment or an embed (§5.10). */
export function TextVsMedia({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("text-vs-media", fallbackFilters);
  const shape = useChartShape("text-vs-media");
  const { cells, empty } = useMemo(() => mediaCells(payload, filters), [payload, filters]);
  const share = useMemo(() => mediaShare(cells), [cells]);
  const { media, total } = share;
  const blank = empty ?? (total > 0 ? null : EMPTY_FILTER);
  const option = useMemo(() => {
    // Both shapes read the same two numbers, and together they are the whole of
    // the filtered total, which is why this card declares a pie.
    const rows = [
      { name: "with media", value: share.media, color: mediaColor() },
      { name: "text only", value: share.textOnly, color: remainderColor() },
    ];
    return shape === "bar" ? colorBarsOption(rows) : doughnutOption(rows, "messages");
  }, [share, shape]);

  return (
    <Panel
      title={TITLE}
      subtitle={`share carrying an attachment or embed · ${fmt(media)} of ${fmt(total)} messages (${pctOf(
        media,
        total,
      )}%)`}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart height={300} option={option} />
      )}
    </Panel>
  );
}
