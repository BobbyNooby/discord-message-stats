import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import {
  gaugeOption,
  healthGauges,
  mediaCells,
  totalMessages,
  type MediaPanelProps,
} from "./mediaData";

const TITLE = "Chat health";

/**
 * Three percentages of the filtered window, so a year filter reads against
 * that year rather than against all six years of history. Decorative by the
 * spec's own note (§11.1) — the numbers are also in the subtitle.
 */
export function ChatHealth({ payload, filters }: MediaPanelProps) {
  const { cells, empty } = mediaCells(payload, filters);
  const gauges = healthGauges(cells);
  const msgs = totalMessages(cells);
  const blank = empty ?? (msgs > 0 ? null : "No messages match the active filters.");

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
