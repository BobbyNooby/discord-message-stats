import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  REMAINDER_COLOR,
  colorBarsOption,
  doughnutOption,
  fmt,
  mediaCells,
  mediaColor,
  mediaShare,
  pctOf,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { useChartShape, usePanelFilters } from "./panelScope";

const TITLE = "Text vs media";

/** Share of messages carrying an attachment or an embed (§5.10). */
export function TextVsMedia({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("text-vs-media", fallbackFilters);
  const shape = useChartShape("text-vs-media");
  const { cells, empty } = mediaCells(payload, filters);
  const { media, textOnly, total } = mediaShare(cells);
  const blank = empty ?? (total > 0 ? null : "No messages match the active filters — widen the time range, or switch an author back on.");
  // Both shapes read the same two numbers, and together they are the whole of
  // the filtered total, which is why this card declares a pie.
  const rows = [
    { name: "with media", value: media, color: mediaColor() },
    { name: "text only", value: textOnly, color: REMAINDER_COLOR },
  ];

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
      ) : shape === "bar" ? (
        <EChart height={300} option={colorBarsOption(rows)} />
      ) : (
        <EChart height={300} option={doughnutOption(rows, "messages")} />
      )}
    </Panel>
  );
}
