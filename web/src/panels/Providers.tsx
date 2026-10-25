import { useMemo } from "react";

import type { Payload } from "../api/types";
import { horizontalBarsOption } from "../charts/bars";
import { EmptyState, Panel } from "../components/Panel";
import type { Filters } from "../app/reducer";
import { EChart } from "../lib/echart";
import { emptyFor } from "../lib/empty";
import { fmt } from "../lib/format";
import { providerLabel } from "../lib/mediaLabels";
import { swatch } from "../lib/palette";
import { providerRows } from "../selectors/links";
import { sumRows } from "../selectors/media";
import { usePanelFilters } from "./panelScope";

/**
 * "Embed providers" — who Discord unfurled, as a ranked bar.
 *
 * It used to be a five-slice doughnut, and that was the dishonest shape: the
 * provider rollup reaches the payload as its thirty biggest rows out of the
 * hundreds a chat has (678 on the reference data), so a full circle would have
 * claimed a total the payload never shipped. A bar makes no such claim, and it
 * says in words which slice of the ranking it is drawing.
 *
 * `providers` is a flat [name, embeds] list with no day or author column, so it
 * cannot re-aggregate under a filter, and says so (§11.2). A provider scope is
 * the one thing it can honour: narrowing the ranking to that provider.
 */

/** Bars are only readable while the labels do not collide. */
const MAX_BARS = 12;

export function Providers({ payload, filters }: { panelId?: string; payload: Payload; filters?: Filters }) {
  const scoped = usePanelFilters("embed-providers", filters);
  const provider = scoped.provider ?? null;
  const all = useMemo(() => providerRows(payload, provider), [payload, provider]);
  const rows = useMemo(() => all.slice(0, MAX_BARS), [all]);
  const option = useMemo(() => horizontalBarsOption(rows, swatch(0), 11), [rows]);
  const total = sumRows(rows);
  const scope = provider
    ? `only ${providerLabel(provider, provider)}`
    : all.length <= MAX_BARS
      ? "every provider the payload carries"
      : `the ${MAX_BARS} biggest providers`;

  return (
    <Panel
      title="Embed providers"
      subtitle={`who Discord unfurled · ${fmt(total)} embeds from ${scope}`}
    >
      {!rows.length ? (
        <EmptyState>{emptyFor("embeds")}</EmptyState>
      ) : (
        <EChart option={option} height={340} />
      )}
    </Panel>
  );
}
