import { EmptyState, GlobalOnlyBadge, Panel } from "../components/Panel";
import { hasTimeFilter } from "../filters/selectors";
import { EChart } from "../lib/echart";
import {
  REACTION_COLOR,
  fmt,
  globalEmpty,
  horizontalBarsOption,
  pairCount,
  pairRows,
  pairTotal,
  type MediaPanelProps,
} from "./mediaData";

const TITLE = "Reactions";

/** Reactions from the raw JSON column. Global only: `rollup_reaction` has no date. */
export function Reactions({ payload, filters }: MediaPanelProps) {
  const rows = pairRows(payload.reactions, 14);
  const blank = globalEmpty(payload, filters) ?? (rows.length ? null : "No reaction data.");

  return (
    <Panel
      title={TITLE}
      subtitle={`from the raw JSON column · ${fmt(pairTotal(payload.reactions))} reactions across ${pairCount(
        payload.reactions,
      )} emoji`}
      badge={hasTimeFilter(filters) ? <GlobalOnlyBadge what={TITLE} /> : null}
    >
      {blank ? (
        <EmptyState>{blank}</EmptyState>
      ) : (
        <EChart height={330} option={horizontalBarsOption(rows, REACTION_COLOR, 13)} />
      )}
    </Panel>
  );
}
