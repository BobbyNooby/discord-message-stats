import { describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import {
  dashboardReducer,
  filtersReducer,
  initialDashboardState,
  initialFilters,
  initialScopeState,
  scopesReducer,
  type Filters,
} from "./reducer";
import { effective } from "./selectors";

const payload = {
  authors: [{ id: "u1", name: "Alice", msgs: 10 }, { id: "u2", name: "Bob", msgs: 4 }],
} as unknown as Payload;

const GLOBAL: Filters = {
  ...initialFilters(payload),
  from: "2024-01-01",
  to: "2024-06-30",
  bucket: "month",
  rankBy: "msgs",
  word: null,
};

describe("effective", () => {
  it("composes a patch over the global filters", () => {
    const patch = { active: [true, false], word: "cat" };
    const merged = effective(GLOBAL, patch);
    expect(merged.active).toEqual([true, false]);
    expect(merged.word).toBe("cat");
    expect(merged.from).toBe("2024-01-01");
    expect(merged.bucket).toBe("month");
  });

  it("never mutates the filters it is handed", () => {
    const before = structuredClone(GLOBAL);
    const patch = { active: [false, false], years: [2023] };
    const merged = effective(GLOBAL, patch);
    expect(GLOBAL).toEqual(before);
    // The patch's own arrays are copied, so neither side can alias the other.
    merged.active[0] = true;
    merged.years.push(2024);
    expect(patch.active).toEqual([false, false]);
    expect(patch.years).toEqual([2023]);
  });

  it("ignores keys a patch left undefined and returns the global when empty", () => {
    expect(effective(GLOBAL, { word: undefined })).toBe(GLOBAL);
    expect(effective(GLOBAL)).toBe(GLOBAL);
    expect(effective(GLOBAL, {})).toBe(GLOBAL);
    expect(effective(GLOBAL, { word: undefined }).word).toBe(null);
  });
});

describe("scoped filter state", () => {
  it("keeps a draft out of the applied scope until Apply", () => {
    let state = initialScopeState();
    state = scopesReducer(state, { type: "openScope", panelId: "who-talks-the-most" });
    expect(state.mode).toEqual({ kind: "scoped", panelId: "who-talks-the-most", draft: {} });

    state = scopesReducer(state, {
      type: "patchScope",
      panelId: "who-talks-the-most",
      patch: { active: [true, false] },
    });
    expect(state.scopes).toEqual({});
    expect(effective(GLOBAL, state.scopes["who-talks-the-most"]).active).toEqual([true, true]);

    state = scopesReducer(state, { type: "applyScope", panelId: "who-talks-the-most" });
    expect(state.scopes).toEqual({ "who-talks-the-most": { active: [true, false] } });
    expect(effective(GLOBAL, state.scopes["who-talks-the-most"]).active).toEqual([true, false]);
  });

  it("discards a draft on back-to-global but keeps what was applied", () => {
    let state = initialScopeState();
    state = scopesReducer(state, { type: "openScope", panelId: "word-cloud" });
    state = scopesReducer(state, { type: "patchScope", panelId: "word-cloud", patch: { word: "cat" } });
    state = scopesReducer(state, { type: "applyScope", panelId: "word-cloud" });
    state = scopesReducer(state, { type: "patchScope", panelId: "word-cloud", patch: { word: "dog" } });
    state = scopesReducer(state, { type: "closeScope" });

    expect(state.mode).toEqual({ kind: "global" });
    expect(state.scopes).toEqual({ "word-cloud": { word: "cat" } });
  });

  it("applies nothing when the draft is empty", () => {
    let state = initialScopeState();
    state = scopesReducer(state, { type: "openScope", panelId: "word-cloud" });
    state = scopesReducer(state, { type: "applyScope", panelId: "word-cloud" });
    expect(state.scopes).toEqual({});
  });

  it("clears one panel's scope and leaves the others alone", () => {
    let state = initialScopeState({
      "word-cloud": { word: "cat" },
      "who-talks-the-most": { active: [true, false] },
    });
    state = scopesReducer(state, { type: "openScope", panelId: "who-talks-the-most" });
    state = scopesReducer(state, { type: "clearScope", panelId: "who-talks-the-most" });
    expect(state.scopes).toEqual({ "word-cloud": { word: "cat" } });
    expect(state.mode).toEqual({ kind: "scoped", panelId: "who-talks-the-most", draft: {} });
    expect(effective(GLOBAL, state.scopes["who-talks-the-most"])).toEqual(GLOBAL);
  });

  it("clears every scope and returns the sidebar to global", () => {
    let state = initialScopeState({ "word-cloud": { word: "cat" }, "word-index": { word: "dog" } });
    state = scopesReducer(state, { type: "openScope", panelId: "word-cloud" });
    state = scopesReducer(state, { type: "clearScopes" });
    expect(state).toEqual({ scopes: {}, mode: { kind: "global" } });
  });

  it("patches an applied scope directly when that panel is not the one on screen", () => {
    let state = initialScopeState({ "word-cloud": { word: "cat" } });
    state = scopesReducer(state, { type: "patchScope", panelId: "word-cloud", patch: { word: "dog" } });
    expect(state.mode).toEqual({ kind: "global" });
    expect(state.scopes).toEqual({ "word-cloud": { word: "dog" } });
  });
});

describe("dashboardReducer", () => {
  it("routes global actions at the filters and scope actions at the scopes", () => {
    let state = initialDashboardState(payload);
    expect(state.filters.active).toEqual([true, true]);

    state = dashboardReducer(state, { type: "toggleAuthor", index: 0 });
    expect(state.filters.active).toEqual([false, true]);
    expect(state.scopes).toEqual({});

    state = dashboardReducer(state, { type: "openScope", panelId: "who-talks-the-most" });
    state = dashboardReducer(state, {
      type: "patchScope",
      panelId: "who-talks-the-most",
      patch: { active: [false, true] },
    });
    state = dashboardReducer(state, { type: "applyScope", panelId: "who-talks-the-most" });

    expect(state.mode).toMatchObject({ kind: "scoped", panelId: "who-talks-the-most" });
    expect(effective(state.filters, state.scopes["who-talks-the-most"]).active).toEqual([false, true]);
    // The global filters are untouched by anything scoped to one card.
    expect(state.filters.active).toEqual([false, true]);
    state = dashboardReducer(state, { type: "reset" });
    expect(state.filters).toMatchObject({ bucket: "month", from: null });
    expect(state.scopes).toEqual({ "who-talks-the-most": { active: [false, true] } });
  });

  it("leaves the untouched global reducer's contract intact", () => {
    expect(filtersReducer(GLOBAL, { type: "setWord", word: "cat" }).word).toBe("cat");
  });
});
