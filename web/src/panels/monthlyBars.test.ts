import { describe, expect, it } from "vitest";

import type { Author } from "../api/types";
import { monthLabel, monthlyStacks, monthRange } from "./MonthlyBars";

const authors: Author[] = [
  { id: "u1", name: "Ada", msgs: 10 },
  { id: "u2", name: "Bo", msgs: 5, accounts: ["u2", "u2alt"] },
];

describe("monthly stacks", () => {
  it("fills the quiet months and crosses a year end", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthLabel("2026-02")).toBe("Feb 2026");
  });

  it("folds a merged alt into its person and honours the author switches", () => {
    const rows = [
      { month: "2026-01", id: "u1", count: 2 },
      { month: "2026-03", id: "u2alt", count: 5 },
    ];
    const both = monthlyStacks(rows, authors, [true, true]);
    expect(both.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(both.series.map((s) => [s.name, s.data])).toEqual([
      ["Ada", [2, 0, 0]],
      ["Bo", [0, 0, 5]],
    ]);
    expect(both.peak).toEqual({ month: "2026-03", count: 5 });
    const adaOnly = monthlyStacks(rows, authors, [true, false]);
    expect(adaOnly.months).toEqual(["2026-01"]);
    expect(adaOnly.total).toBe(2);
  });

  it("is empty, not broken, when every row is switched off", () => {
    const none = monthlyStacks([{ month: "2026-01", id: "u1", count: 2 }], authors, [false, false]);
    expect(none).toEqual({ months: [], series: [], peak: null, first: null, total: 0 });
  });
});
