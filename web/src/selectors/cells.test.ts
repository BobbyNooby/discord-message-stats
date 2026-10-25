import { describe, expect, it } from "vitest";

import { initialFilters } from "../app/reducer";
import { testPayload } from "../test/payload";
import { selectVisibleCells } from "./cells";

const payload = testPayload({
  authors: [
    { id: "u1", name: "Ada", msgs: 5 },
    { id: "u2", name: "Bo", msgs: 2 },
  ],
  days: ["2023-05-01", "2024-02-01"],
  cells: [
    [0, 0, 3, 9, 0, 0, 0],
    [1, 0, 2, 4, 0, 0, 0],
    [1, 1, 2, 8, 0, 0, 0],
  ],
});

describe("the visible cells", () => {
  it("keeps the cells the filters let through", () => {
    const filters = { ...initialFilters(payload), years: [2024], active: [true, false] };
    expect(selectVisibleCells(payload, filters)).toEqual([[1, 0, 2, 4, 0, 0, 0]]);
  });

  it("hands every card under the same filters the same array", () => {
    // Cards with no scope of their own share the global filters object, so a
    // dozen of them filtering the same cells cost one pass.
    const filters = initialFilters(payload);
    expect(selectVisibleCells(payload, filters)).toBe(selectVisibleCells(payload, filters));
  });

  it("answers a new filters object, or a new payload, afresh", () => {
    const filters = initialFilters(payload);
    const narrowed = { ...filters, years: [2023] };
    expect(selectVisibleCells(payload, narrowed)).toHaveLength(1);
    expect(selectVisibleCells(payload, filters)).toHaveLength(3);
    const smaller = { ...payload, cells: payload.cells.slice(0, 1) };
    expect(selectVisibleCells(smaller, filters)).toHaveLength(1);
  });

  it("refuses to be changed in place, since every caller shares it", () => {
    const cells = selectVisibleCells(payload, initialFilters(payload));
    expect(Object.isFrozen(cells)).toBe(true);
    expect(() => (cells as unknown[]).push([0, 0, 0, 0, 0, 0, 0])).toThrow(TypeError);
  });
});
