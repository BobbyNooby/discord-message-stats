import { createContext, useContext, useMemo, type ReactNode } from "react";

import { EMPTY_FILTERS, type Filters, type Scopes } from "../filters/reducer";
import { isPanelId, type PanelId } from "./registry";
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
};

const PanelScope = createContext<PanelScopeValue | null>(null);

export function PanelScopeProvider({
  filters,
  scopes,
  onOpenScope = null,
  children,
}: {
  filters: Filters;
  scopes: Scopes;
  onOpenScope?: ((panelId: PanelId) => void) | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ filters, scopes, onOpenScope }), [filters, scopes, onOpenScope]);
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

/** A card may be told its own id; it reads its scope through the context above. */
export type WithPanelId = { panelId?: PanelId };

/** Whether an id a panel was handed is one the registry knows. */
export function knownPanelId(value: string | undefined): PanelId | null {
  return value && isPanelId(value) ? value : null;
}
