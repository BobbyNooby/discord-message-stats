import { describe, expect, it } from "vitest";

import { answerFor, inPeriod, periodLabel, periodOf } from "./wordPeriod";

describe("a word period", () => {
  it("is nothing without a time filter, so the default view never asks", () => {
    expect(periodOf({ from: null, to: null, years: [] })).toBeNull();
  });

  it("rounds a day range out to the months it touches and sorts the years", () => {
    expect(periodOf({ from: "2024-03-15", to: "2024-05-02", years: [2024, 2021] })).toEqual({
      from: "2024-03",
      to: "2024-05",
      years: [2021, 2024],
    });
  });

  it("keeps a month only when it is in range and in a picked year", () => {
    const period = { from: "2021-06", to: null, years: [2021, 2023] };
    expect(inPeriod("2021-05", period)).toBe(false);
    expect(inPeriod("2021-06", period)).toBe(true);
    expect(inPeriod("2022-01", period)).toBe(false);
    expect(inPeriod("2023-12", period)).toBe(true);
    expect(inPeriod("1999-01", null)).toBe(true);
  });

  it("says which stretch it counts, and that a range is whole months", () => {
    expect(periodLabel({ from: null, to: null, years: [2021, 2023] })).toBe("2021, 2023");
    expect(periodLabel({ from: "2024-03", to: "2024-05", years: [] })).toBe("Mar 2024 – May 2024 (whole months)");
    expect(periodLabel({ from: "2024-03", to: null, years: [] })).toBe("Mar 2024 – now (whole months)");
  });

  it("cuts a word's all-time answer down to the period", () => {
    const found = {
      word: "grandma",
      total: 9,
      authors: [
        { id: "u1", name: "Ada", count: 6 },
        { id: "u2", name: "Bo", count: 3 },
      ],
      months: [
        { month: "2022-01", id: "u1", count: 6 },
        { month: "2023-04", id: "u2", count: 2 },
        { month: "2023-09", id: "u2", count: 1 },
      ],
    };
    const cut = answerFor(found, { from: null, to: null, years: [2023] });
    expect(cut?.total).toBe(3);
    expect(cut?.authors).toEqual([{ id: "u2", name: "Bo", count: 3 }]);
    expect(answerFor(found, null)).toBe(found);
  });
});
