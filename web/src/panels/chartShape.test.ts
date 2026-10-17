import { describe, expect, it } from "vitest";

import {
  MAX_PIE_SLICES,
  OTHER_SLICE,
  foldPie,
  pieNote,
  pieOption,
  type ShapeRow,
} from "./chartShape";

/** Twelve rows, deliberately out of order, so sorting is the helper's job. */
const rows: ShapeRow[] = [
  { name: "g", value: 6 },
  { name: "a", value: 12 },
  { name: "j", value: 3 },
  { name: "b", value: 11 },
  { name: "l", value: 1 },
  { name: "c", value: 10 },
  { name: "d", value: 9 },
  { name: "k", value: 2 },
  { name: "e", value: 8 },
  { name: "f", value: 7 },
  { name: "h", value: 5 },
  { name: "i", value: 4 },
];

type PieData = { name: string; value: number; itemStyle?: { color?: string } };
type PieSeries = { type: string; data: PieData[]; label?: unknown; radius?: unknown };

function seriesOf(option: ReturnType<typeof pieOption>): PieSeries {
  return (option.series as unknown as PieSeries[])[0];
}

describe("the pie's honesty rule", () => {
  it("sorts desc and folds everything past the eighth slice into one Other", () => {
    const slices = foldPie(rows);

    expect(slices).toHaveLength(MAX_PIE_SLICES + 1);
    expect(slices.slice(0, MAX_PIE_SLICES).map((slice) => slice.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
    // The tail (i=4, j=3, k=2, l=1) is one slice, not four.
    expect(slices[MAX_PIE_SLICES]).toEqual({ name: OTHER_SLICE, value: 10 });
  });

  it("leaves eight rows or fewer alone", () => {
    const slices = foldPie(rows.slice(0, 8));
    expect(slices).toHaveLength(8);
    expect(slices.map((slice) => slice.name)).not.toContain(OTHER_SLICE);
  });

  it("does not reorder the caller's array", () => {
    const given = [{ name: "small", value: 1 }, { name: "big", value: 9 }];
    foldPie(given);
    expect(given.map((row) => row.name)).toEqual(["small", "big"]);
  });

  it("keeps no slice whose value is zero", () => {
    const slices = foldPie([...rows, { name: "empty", value: 0 }]);
    const tail = slices[MAX_PIE_SLICES];
    expect(tail).toEqual({ name: OTHER_SLICE, value: 10 });
    expect(slices.map((slice) => slice.name)).not.toContain("empty");
  });

  it("states what its 100% covers, so a folded pie never implies the whole", () => {
    expect(pieNote(rows, "types")).toBe("top 8 of 12 types + Other");
    expect(pieNote(rows.slice(0, 4), "types")).toBe("4 types");
    expect(pieNote(rows.slice(0, 1), "types")).toBe("1 type");
    expect(pieNote([], "types")).toBe("no types");
  });

  it("draws one series whose slices sum to the same denominator the note states", () => {
    const slices = foldPie(rows);
    const series = seriesOf(pieOption(slices, "messages"));

    expect(series.type).toBe("pie");
    expect(series.data).toHaveLength(9);
    expect(series.data[0]).toMatchObject({ name: "a", value: 12 });
    // Every slice carries its own colour: a pie with a repeating colour is two
    // categories the reader cannot tell apart.
    expect(new Set(series.data.map((slice) => slice.itemStyle?.color)).size).toBe(9);
    expect(series.data.reduce((sum, slice) => sum + slice.value, 0)).toBe(
      rows.reduce((sum, row) => sum + row.value, 0),
    );
  });

  it("shows a share, not a raw count, on each slice", () => {
    const series = seriesOf(pieOption(foldPie(rows), "messages"));
    const label = series.label as { formatter?: (params: { percent?: number }) => string };
    expect(label.formatter?.({ percent: 12.5 })).toBe("13%");
    expect(label.formatter?.({ percent: 1.2 })).toBe("");
  });
});
