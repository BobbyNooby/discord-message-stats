import { describe, expect, it } from "vitest";

import { initialFilters } from "../filters/reducer";
import { fourDayPayload } from "../test/payload";
import { voiceRows, yearMix, yearTotals } from "./overview";

/** Alice posts 2 + 1 messages in 2023; Bob posts 2 in 2023 and 1 in 2024. */
const payload = fourDayPayload();
const all = initialFilters(payload);

describe("the overview numbers", () => {
  it("ranks the authors in view, busiest first, keeping their palette index", () => {
    expect(voiceRows(payload, all)).toEqual([
      { name: "Alice", value: 3, index: 0 },
      { name: "Bob", value: 3, index: 1 },
    ]);
    expect(voiceRows(payload, { ...all, years: [2024] })).toEqual([{ name: "Bob", value: 1, index: 1 }]);
  });

  it("totals the messages per calendar year, oldest first", () => {
    expect(yearTotals(payload, all)).toEqual({ years: [2023, 2024], values: [5, 1], total: 6 });
    expect(yearTotals(payload, { ...all, active: [true, false] })).toEqual({
      years: [2023],
      values: [3],
      total: 3,
    });
  });

  it("splits each year by author", () => {
    const mix = yearMix(payload, all);
    expect(mix.years).toEqual([2023, 2024]);
    expect([...(mix.byYear.get(2023) ?? [])]).toEqual([
      [0, 3],
      [1, 2],
    ]);
    expect([...(mix.byYear.get(2024) ?? [])]).toEqual([[1, 1]]);
    expect(mix.total).toBe(6);
  });
});
