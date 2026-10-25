import { useMemo } from "react";

import { gaugeOption } from "../charts/gauge";
import { activeDaysColor, mediaColor, replyColor } from "../charts/roles";
import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { EMPTY_FILTER } from "../lib/empty";
import { healthGauges, mediaCells, totalMessages } from "../selectors/media";
import { usePanelFilters, type PanelProps, type WithPanelId } from "./panelScope";

const TITLE = "Chat health";

/** Replies, with media, active days — the order `healthGauges` answers in. */
const DIAL_COLORS = [replyColor, mediaColor, activeDaysColor];

/**
 * Three percentages of the filtered window, so a year filter reads against
 * that year rather than against all six years of history. Decorative by the
 * spec's own note (§11.1) — the numbers are also in the subtitle.
 */
export function ChatHealth({ payload, filters: fallbackFilters }: PanelProps & WithPanelId) {
  const filters = usePanelFilters("chat-health", fallbackFilters);
  const { cells, empty } = useMemo(() => mediaCells(payload, filters), [payload, filters]);
  const gauges = useMemo(() => healthGauges(cells), [cells]);
  const option = useMemo(
    () => gaugeOption(gauges.map((gauge, index) => ({ ...gauge, color: DIAL_COLORS[index]() }))),
    [gauges],
  );
  const msgs = totalMessages(cells);
  const blank = empty ?? (msgs > 0 ? null : EMPTY_FILTER);

  return (
    <Panel
      title={TITLE}
      subtitle={`replies ${gauges[0].value.toFixed(1)}% · with media ${gauges[1].value.toFixed(
        1,
      )}% · active days ${gauges[2].value.toFixed(1)}%`}
    >
      {blank ? <EmptyState>{blank}</EmptyState> : <EChart height={330} option={option} />}
    </Panel>
  );
}
