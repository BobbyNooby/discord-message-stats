import type { Payload } from "../api/types";
import type { PanelId } from "../panels/registry";

/** One reducer owns every filter; charts are pure functions of (data, filters). */
export type Filters = {
  from: string | null;
  to: string | null;
  years: number[];
  active: boolean[];
  bucket: "day" | "month" | "year";
  word: string | null;
  /** Discord's exact provider string, as `/api/media` filters on it. */
  provider: string | null;
  /** One embed kind (`gifv`, `video`, …), as `/api/media` filters on it. */
  kind: string | null;
};

export type Action =
  | { type: "toggleAuthor"; index: number }
  | { type: "onlyAuthor"; index: number }
  | { type: "allAuthors" }
  | { type: "noAuthors" }
  | { type: "setRange"; from: string | null; to: string | null }
  | { type: "toggleYear"; year: number }
  | { type: "clearYears" }
  | { type: "setBucket"; bucket: Filters["bucket"] }
  | { type: "setWord"; word: string | null }
  | { type: "setProvider"; provider: string | null }
  | { type: "setKind"; kind: string | null }
  | { type: "reset" };

/** Filters before the payload arrives: nobody is known yet, so nobody is hidden. */
export const EMPTY_FILTERS: Filters = {
  from: null,
  to: null,
  years: [],
  active: [],
  bucket: "month",
  word: null,
  provider: null,
  kind: null,
};

/** One author per identity, all switched on — the payload's own default view. */
export function initialFilters(payload: Payload): Filters {
  return { ...EMPTY_FILTERS, active: payload.authors.map(() => true) };
}

export function filtersReducer(state: Filters, action: Action): Filters {
  switch (action.type) {
    case "toggleAuthor": {
      const active = [...state.active];
      active[action.index] = !active[action.index];
      return { ...state, active };
    }
    case "onlyAuthor":
      return { ...state, active: state.active.map((_, i) => i === action.index) };
    case "allAuthors":
      return { ...state, active: state.active.map(() => true) };
    case "noAuthors":
      return { ...state, active: state.active.map(() => false) };
    case "setRange":
      return { ...state, from: action.from, to: action.to };
    case "toggleYear": {
      const years = state.years.includes(action.year)
        ? state.years.filter((year) => year !== action.year)
        : [...state.years, action.year].sort();
      return { ...state, years };
    }
    case "clearYears":
      return { ...state, years: [] };
    case "setBucket":
      return { ...state, bucket: action.bucket };
    case "setWord":
      return { ...state, word: action.word };
    case "setProvider":
      // A provider that does not have a kind makes the kind invisible, so it
      // goes with the provider rather than filtering the card to nothing.
      return { ...state, provider: action.provider, kind: null };
    case "setKind":
      return { ...state, kind: action.kind };
    case "reset":
      // `active` keeps its length: resetting shows everybody, it does not forget
      // how many people there are.
      return { ...EMPTY_FILTERS, active: state.active.map(() => true) };
    default:
      return state;
  }
}

/* ---------- per-card scopes ---------- */

/** What one card overrides: any subset of the global filters. */
export type FilterPatch = Partial<Filters>;

/** Card id to its own override. The global filters still apply underneath. */
export type Scopes = Record<string, FilterPatch>;

/** Which filters the sidebar is editing: the global set, or one card's draft. */
export type SidebarMode =
  | { kind: "global" }
  | { kind: "scoped"; panelId: PanelId; draft: FilterPatch };

export type ScopeAction =
  | { type: "openScope"; panelId: PanelId }
  | { type: "patchScope"; panelId: PanelId; patch: FilterPatch }
  | { type: "applyScope"; panelId: PanelId }
  | { type: "replaceScope"; panelId: PanelId; patch: FilterPatch }
  | { type: "clearScope"; panelId: PanelId }
  | { type: "clearScopes" }
  | { type: "closeScope" };

export type ScopeState = { scopes: Scopes; mode: SidebarMode };

export const GLOBAL_MODE: SidebarMode = { kind: "global" };

export function initialScopeState(scopes: Scopes = {}): ScopeState {
  return { scopes, mode: GLOBAL_MODE };
}

/** A patch of nothing is not a scope: that card is simply unfiltered. */
function clean(patch: FilterPatch): FilterPatch {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as FilterPatch;
}

function merge(base: FilterPatch, patch: FilterPatch): FilterPatch {
  return { ...base, ...clean(patch) };
}

export function scopesReducer(state: ScopeState, action: ScopeAction): ScopeState {
  const scoped = state.mode.kind === "scoped" ? state.mode : null;
  switch (action.type) {
    case "openScope":
      // Opening a card picks up what it already applies, so the sidebar never
      // shows something other than the state the card is in.
      return {
        ...state,
        mode: {
          kind: "scoped",
          panelId: action.panelId,
          draft: state.scopes[action.panelId] ?? {},
        },
      };
    case "patchScope": {
      // While the card's scope is open, an edit is a draft. Anywhere else it is
      // an edit to what that card already applies.
      if (scoped && scoped.panelId === action.panelId) {
        return { ...state, mode: { ...scoped, draft: merge(scoped.draft, action.patch) } };
      }
      return {
        ...state,
        scopes: { ...state.scopes, [action.panelId]: merge(state.scopes[action.panelId] ?? {}, action.patch) },
      };
    }
    case "applyScope": {
      if (!scoped || scoped.panelId !== action.panelId) return state;
      const patch = clean(scoped.draft);
      const scopes = { ...state.scopes };
      if (Object.keys(patch).length) scopes[action.panelId] = patch;
      else delete scopes[action.panelId];
      return { ...state, scopes };
    }
    case "replaceScope": {
      // Removing an applied chip: the applied patch becomes exactly this, and
      // the dimensions it dropped leave the open draft too — the sidebar must
      // not keep showing a filter the card no longer has.
      const patch = clean(action.patch);
      const previous = state.scopes[action.panelId] ?? {};
      const scopes = { ...state.scopes };
      if (Object.keys(patch).length) scopes[action.panelId] = patch;
      else delete scopes[action.panelId];

      if (!scoped || scoped.panelId !== action.panelId) return { ...state, scopes };
      const draft = { ...scoped.draft };
      for (const key of Object.keys(previous)) {
        if (!(key in patch)) delete draft[key as keyof Filters];
      }
      return { scopes, mode: { ...scoped, draft } };
    }
    case "clearScope": {
      const scopes = { ...state.scopes };
      delete scopes[action.panelId];
      return {
        scopes,
        mode: scoped?.panelId === action.panelId ? { ...scoped, draft: {} } : state.mode,
      };
    }
    case "clearScopes":
      // Nothing is left to be scoped to, so the sidebar goes back to global.
      return { scopes: {}, mode: GLOBAL_MODE };
    case "closeScope":
      // Leaving the draft behind would silently apply it on the next Apply.
      return { ...state, mode: GLOBAL_MODE };
    default:
      return state;
  }
}

/* ---------- one reducer for the dashboard ---------- */

export type DashboardAction = Action | ScopeAction;

export type DashboardState = { filters: Filters; scopes: Scopes; mode: SidebarMode };

/** `view` is the sidebar's filters as a link carried them (`?view=`). */
export function initialDashboardState(payload: Payload, view: FilterPatch = {}): DashboardState {
  const filters = initialFilters(payload);
  // A view from another build may name a different number of people; only a
  // list that lines up with this payload's authors replaces the default.
  const active = view.active?.length === filters.active.length ? view.active : filters.active;
  return { filters: { ...filters, ...view, active }, scopes: {}, mode: GLOBAL_MODE };
}

const SCOPE_ACTIONS = [
  "openScope",
  "patchScope",
  "applyScope",
  "replaceScope",
  "clearScope",
  "clearScopes",
  "closeScope",
] as const;

function isScopeAction(action: DashboardAction): action is ScopeAction {
  return (SCOPE_ACTIONS as readonly string[]).includes(action.type);
}

/**
 * `useReducer(dashboardReducer, payload, initialDashboardState)` — the sidebar
 * holds one dispatch, and a global action can never land on a card's scope.
 */
export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  if (isScopeAction(action)) return { ...state, ...scopesReducer(state, action) };
  return { ...state, filters: filtersReducer(state.filters, action) };
}
