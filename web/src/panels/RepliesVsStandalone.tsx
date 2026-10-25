import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { EMPTY_FILTER } from "../lib/empty";
import { fmt, pctOf } from "../lib/format";
import {
  colorBarsOption,
  doughnutOption,
  mediaCells,
  remainderColor,
  replyColor,
  replyShare,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { useChartShape, usePanelFilters } from "./panelScope";

const TITLE = "Replies vs standalone";

/** Share of messages that quote another message. */
export function RepliesVsStandalone({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("replies-vs-standalone", fallbackFilters);
  const shape = useChartShape("replies-vs-standalone");
  const { cells, empty } = useMemo(() => mediaCells(payload, filters), [payload, filters]);
  const share = useMemo(() => replyShare(cells), [cells]);
  const { replies, total } = share;
  const blank = empty ?? (total > 0 ? null : EMPTY_FILTER);
  const option = useMemo(() => {
    // Two parts that add up to every filtered message: a nameable whole.
    const rows = [
      { name: "replies", value: share.replies, color: replyColor() },
      { name: "standalone", value: share.standalone, color: remainderColor() },
    ];
    return shape === "bar" ? colorBarsOption(rows) : doughnutOption(rows, "messages");
  }, [share, shape]);

  return (
    <Panel
      title={TITLE}
      subtitle={`share quoting another message · ${fmt(replies)} of ${fmt(total)} messages (${pctOf(
        replies,
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
