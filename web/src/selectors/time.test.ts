import { describe, expect, it } from "vitest";

import { initialFilters } from "../filters/reducer";
import { fourDayPayload } from "../test/payload";
import { byHour, heatGrid, monthTotals, repliesByBucket } from "./time";

const payload = fourDayPayload();
const all = initialFilters(payload);

describe("the time numbers", () => {
  it("states replies as a share of each bucket's messages", () => {
    expect(repliesByBucket(payload, all)).toEqual({
      order: ["2023-01", "2023-06", "2024-01"],
      series: [33.33, 0, 100],
      msgs: 6,
      replies: 2,
    });
    expect(repliesByBucket(payload, { ...all, bucket: "year" }).order).toEqual(["2023", "2024"]);
  });

  it("pools every year into twelve months", () => {
    const totals = monthTotals(payload, all);
    expect(totals.months).toEqual([4, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0]);
    expect(totals.years).toBe(2);
    expect(totals.total).toBe(6);
  });

  it("finds the busiest weekday and hour, and folds the grid into hours", () => {
    const heat = heatGrid(payload, all);
    expect(heat).toMatchObject({ total: 7, max: 4, peakDow: 0, peakHour: 9 });
    expect(byHour(heat.grid)[9]).toBe(4);
    // `rollup_heat` has no day grain, so a year is the finest time it honours.
    expect(heatGrid(payload, { ...all, years: [2024] }).total).toBe(2);
  });
});
