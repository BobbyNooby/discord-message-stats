import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  MEDIA_COLOR,
  REMAINDER_COLOR,
  doughnutOption,
  fmt,
  mediaCells,
  mediaShare,
  pctOf,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const TITLE = "Text vs media";

/** Share of messages carrying an attachment or an embed (§5.10). */
export function TextVsMedia({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("text-vs-media", fallbackFilters);
  const { cells, empty } = mediaCells(payload, filters);
  const { media, textOnly, total } = mediaShare(cells);
  const blank = empty ?? (total > 0 ? null : "No messages match the active filters.");

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
        <EChart
          height={300}
          option={doughnutOption(
            [
              { name: "with media", value: media, color: MEDIA_COLOR },
              { name: "text only", value: textOnly, color: REMAINDER_COLOR },
            ],
            "messages",
          )}
        />
      )}
    </Panel>
  );
}
