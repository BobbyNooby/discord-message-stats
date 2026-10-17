import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  gaugeOption,
  healthGauges,
  mediaCells,
  totalMessages,
  type MediaPanelProps,
} from "./mediaData";
import type { WithPanelId } from "./panelScope";
import { usePanelFilters } from "./panelScope";

const TITLE = "Chat health";

/**
 * Three percentages of the filtered window, so a year filter reads against
 * that year rather than against all six years of history. Decorative by the
 * spec's own note (§11.1) — the numbers are also in the subtitle.
 */
export function ChatHealth({ payload, filters: fallbackFilters }: MediaPanelProps & WithPanelId) {
  const filters = usePanelFilters("chat-health", fallbackFilters);
  const { cells, empty } = mediaCells(payload, filters);
  const gauges = healthGauges(cells);
  const msgs = totalMessages(cells);
  const blank = empty ?? (msgs > 0 ? null : "No messages match the active filters — widen the time range, or switch an author back on.");

  return (
    <Panel
      title={TITLE}
      subtitle={`replies ${gauges[0].value.toFixed(1)}% · with media ${gauges[1].value.toFixed(
        1,
      )}% · active days ${gauges[2].value.toFixed(1)}%`}
    >
      {blank ? <EmptyState>{blank}</EmptyState> : <EChart height={330} option={gaugeOption(gauges)} />}
    </Panel>
  );
}
