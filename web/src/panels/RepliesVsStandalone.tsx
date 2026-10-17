import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  REMAINDER_COLOR,
  REPLY_COLOR,
  doughnutOption,
  fmt,
  mediaCells,
  pctOf,
  replyShare,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const TITLE = "Replies vs standalone";

/** Share of messages that quote another message. */
export function RepliesVsStandalone({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("replies-vs-standalone", fallbackFilters);
  const { cells, empty } = mediaCells(payload, filters);
  const { replies, standalone, total } = replyShare(cells);
  const blank = empty ?? (total > 0 ? null : "No messages match the active filters.");

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
        <EChart
          height={300}
          option={doughnutOption(
            [
              { name: "replies", value: replies, color: REPLY_COLOR },
              { name: "standalone", value: standalone, color: REMAINDER_COLOR },
            ],
            "messages",
          )}
        />
      )}
    </Panel>
  );
}
