import { describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import { EMPTY_FILTERS, filtersReducer, initialFilters } from "./reducer";
import { selectAuthors, selectTotals, selectVisibleCells } from "./selectors";

const payload = {
  authors: [
    { id: "u1", name: "A", msgs: 3 },
    { id: "u2", name: "B", msgs: 2 },
  ],
  days: ["2023-01-01", "2023-06-01", "2024-01-01"],
  cells: [
    [0, 0, 2, 10, 1, 0, 0],
    [1, 0, 1, 5, 0, 1, 0],
    [2, 1, 2, 8, 0, 0, 1],
  ],
} as unknown as Payload;

const filters = () => initialFilters(payload);

describe("filtersReducer", () => {
  it("toggles one author at a time", () => {
    const next = filtersReducer(filters(), { type: "toggleAuthor", index: 1 });
    expect(next.active).toEqual([true, false]);
  });

  it("reset shows everybody again without forgetting how many there are", () => {
    const hidden = filtersReducer(filters(), { type: "noAuthors" });
    expect(filtersReducer(hidden, { type: "reset" }).active).toEqual([true, true]);
  });

  it("keeps years unique and sorted", () => {
    let state = filtersReducer(filters(), { type: "toggleYear", year: 2024 });
    state = filtersReducer(state, { type: "toggleYear", year: 2023 });
    expect(state.years).toEqual([2023, 2024]);
    expect(filtersReducer(state, { type: "toggleYear", year: 2023 }).years).toEqual([2024]);
  });

  it("sets a provider and clears a kind that provider may not have", () => {
    let state = filtersReducer(filters(), { type: "setKind", kind: "gifv" });
    state = filtersReducer(state, { type: "setProvider", provider: "YouTube" });
    expect(state.provider).toBe("YouTube");
    expect(state.kind).toBeNull();

    state = filtersReducer(state, { type: "setKind", kind: "video" });
    expect(state.kind).toBe("video");
  });
});

describe("selectors", () => {
  it("re-aggregates in the browser from the payload", () => {
    const state = { ...filters(), years: [2023] };
    expect(selectTotals(payload, state).msgs).toBe(3);
    expect(selectTotals(payload, state).days).toBe(2);
  });

  it("an empty author selection yields zeros, never NaN", () => {
    const totals = selectTotals(payload, { ...filters(), active: [false, false] });
    expect(totals).toEqual({
      msgs: 0,
      chars: 0,
      days: 0,
      authors: 0,
      media: 0,
      replies: 0,
      edits: 0,
    });
    expect(Number.isNaN(totals.msgs)).toBe(false);
  });

  it("filters cells by author and by range", () => {
    const state = { ...filters(), active: [true, false] };
    expect(selectVisibleCells(payload, state)).toHaveLength(2);
    expect(selectVisibleCells(payload, { ...state, from: "2023-06-01" })).toHaveLength(1);
  });

  it("gives each author its own filtered totals", () => {
    const authors = selectAuthors(payload, { ...filters(), years: [2023] });
    expect(authors.map((a) => a.msgs)).toEqual([3, 0]);
  });

  it("EMPTY_FILTERS hides nobody once the payload is in", () => {
    expect(EMPTY_FILTERS.active).toEqual([]);
    expect(filters().active).toEqual([true, true]);
  });
});
