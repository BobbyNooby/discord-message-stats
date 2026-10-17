import { createContext, useContext, useMemo, type ReactNode } from "react";

import { EMPTY_FILTERS, type Filters, type Scopes } from "../filters/reducer";
import type { Charts } from "../filters/persist";
import { isPanelId, specFor, type ChartKind, type PanelId } from "./registry";
import { effective } from "../filters/selectors";

/**
 * What the cards sit inside: the global filters they all start from, the patches
 * individual cards have applied, and the one way to open a card's scope.
 *
 * A card's *body* needs its resolved filters, and threading one `Filters` value
 * per card through six sections would turn every section into a pass-through
 * that knows nothing about scoping. One context gives each card its own view.
 */
type PanelScopeValue = {
  filters: Filters;
  scopes: Scopes;
  onOpenScope: ((panelId: PanelId) => void) | null;
  charts: Charts;
  onShapeChange: ((panelId: PanelId, shape: ChartKind) => void) | null;
};

const PanelScope = createContext<PanelScopeValue | null>(null);

/** One shared empty map, so a provider with no shapes does not re-render its cards. */
const NO_CHARTS: Charts = {};

export function PanelScopeProvider({
  filters,
  scopes,
  onOpenScope = null,
  charts = NO_CHARTS,
  onShapeChange = null,
  children,
}: {
  filters: Filters;
  scopes: Scopes;
  onOpenScope?: ((panelId: PanelId) => void) | null;
  charts?: Charts;
  onShapeChange?: ((panelId: PanelId, shape: ChartKind) => void) | null;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ filters, scopes, onOpenScope, charts, onShapeChange }),
    [filters, scopes, onOpenScope, charts, onShapeChange],
  );
  return <PanelScope.Provider value={value}>{children}</PanelScope.Provider>;
}

/**
 * A card's effective filters: the global set with its own applied patch over the
 * top. A card rendered without a shell (a test, a preview) falls back to the
 * filters it was handed, so nothing here requires a provider to exist.
 */
export function usePanelFilters(panelId: PanelId | string, fallback?: Filters): Filters {
  const value = useContext(PanelScope);
  const filters = value?.filters ?? fallback;
  const scopes = value?.scopes;
  return useMemo(
    // A card with no shell at all still renders: it simply sees the filters it
    // was handed, or the pre-payload defaults.
    () => effective(filters ?? fallback ?? EMPTY_FILTERS, scopes?.[panelId]),
    [filters, fallback, scopes, panelId],
  );
}

/** The "…" target, or null when a card renders on its own outside the shell. */
export function usePanelScopeTarget(): ((panelId: PanelId) => void) | null {
  return useContext(PanelScope)?.onOpenScope ?? null;
}

/**
 * The shape a card is drawn in: what the reader chose, else the default its own
 * spec declares. A card rendered outside the shell (a test, a preview) simply
 * gets the registry's default rather than a missing value.
 */
export function useChartShape(panelId: PanelId | string): ChartKind {
  const chosen = useContext(PanelScope)?.charts[panelId];
  if (chosen) return chosen;
  return isPanelId(panelId) ? specFor(panelId).defaultShape : "bar";
}

/** The one way to record a shape, or null where there is no shell to remember it. */
export function useShapeChange(): ((panelId: PanelId, shape: ChartKind) => void) | null {
  return useContext(PanelScope)?.onShapeChange ?? null;
}

/** A card may be told its own id; it reads its scope through the context above. */
export type WithPanelId = { panelId?: PanelId };
