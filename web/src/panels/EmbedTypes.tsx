import { useMemo } from "react";

import { EmptyState, Panel } from "../components/Panel";
import { EChart } from "../lib/echart";
import { emptyFor } from "../lib/empty";
import { fmt } from "../lib/format";
import { swatch } from "../lib/palette";
import type { Payload } from "../api/types";
import { foldPie, pieNote, pieOption } from "./chartShape";
import { allPairRows, horizontalBarsOption, sumRows } from "./mediaData";
import type { Filters } from "../filters/reducer";
import { useChartShape } from "./panelScope";

/**
 * "Embed types" — video, gifv, link, article… Discord's embed kinds are a
 * closed set, and `rollup_embed_type` carries one row per kind, so this is one
 * of the two cards whose whole the payload really knows: a pie here covers
 * every embed rather than a cut of them.
 *
 * `embedTypes` has neither a day nor an author column; the Links section note
 * says once which cards a date filter cannot move.
 */
export function EmbedTypes({ payload, }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const shape = useChartShape("embed-types");
  const rows = useMemo(() => allPairRows(payload.embedTypes), [payload]);
  const option = useMemo(
    () => (shape === "pie" ? pieOption(foldPie(rows), "embeds") : horizontalBarsOption(rows, swatch(5), 11)),
    [rows, shape],
  );
  const total = sumRows(rows);

  return (
    <Panel
      title="Embed types"
      subtitle={
        shape === "pie"
          ? `video, gifv, link, article… · ${pieNote(rows, "types")} · ${fmt(total)} embeds`
          : `video, gifv, link, article… · ${fmt(total)} embeds across ${rows.length} types`
      }
    >
      {!rows.length ? (
        <EmptyState>{emptyFor("embeds")}</EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
