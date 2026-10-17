import { describe, expect, it } from "vitest";

import { csvFromOption } from "./csvFromOption";

/**
 * The export is derived from the option the chart drew, so these fixtures are
 * the shapes the real panels hand to ECharts — one per chart family here.
 */
describe("csvFromOption", () => {
  it("reads a category axis with one series per column", () => {
    expect(
      csvFromOption({
        xAxis: { type: "category", data: ["Jan", "Feb"] },
        series: [{ name: "replies %", type: "line", data: [4.5, 8] }],
      }),
    ).toEqual([
      ["category", "replies %"],
      ["Jan", 4.5],
      ["Feb", 8],
    ]);
  });

  it("keeps a multi-series chart's columns aligned to the axis", () => {
    expect(
      csvFromOption({
        xAxis: { type: "category", data: ["2024-01", "2024-02"] },
        series: [
          { name: "Ada", type: "line", data: [3, 5] },
          { name: "Bob", type: "line", data: [1, 2] },
          { name: "TOTAL", type: "line", data: [4, 7] },
        ],
      }),
    ).toEqual([
      ["category", "Ada", "Bob", "TOTAL"],
      ["2024-01", 3, 1, 4],
      ["2024-02", 5, 2, 7],
    ]);
  });

  it("reads a horizontal bar chart off its y axis", () => {
    expect(
      csvFromOption({
        yAxis: { type: "category", data: ["Ada", "Bob"] },
        series: [{ type: "bar", data: [{ value: 120 }, { value: 90 }] }],
      }),
    ).toEqual([
      ["name", "value 1"],
      ["Ada", 120],
      ["Bob", 90],
    ]);
  });

  it("reads a pie's named slices", () => {
    expect(
      csvFromOption({
        series: [
          {
            type: "pie",
            data: [
              { name: "with media", value: 8 },
              { name: "text only", value: 172 },
            ],
          },
        ],
      }),
    ).toEqual([
      ["name", "value"],
      ["with media", 8],
      ["text only", 172],
    ]);
  });

  it("reads a heatmap against both category axes", () => {
    expect(
      csvFromOption({
        xAxis: { type: "category", data: ["00", "01"] },
        yAxis: { type: "category", data: ["Sun", "Mon"] },
        series: [
          {
            type: "heatmap",
            data: [
              [0, 0, 12],
              [1, 0, 4],
              [0, 1, 30],
              [1, 1, 9],
            ],
          },
        ],
      }),
    ).toEqual([
      ["x", "y", "value"],
      ["00", "Sun", 12],
      ["01", "Sun", 4],
      ["00", "Mon", 30],
      ["01", "Mon", 9],
    ]);
  });

  it("reads one row per gauge", () => {
    expect(
      csvFromOption({
        series: [
          { type: "gauge", data: [{ value: 10, name: "Replies" }] },
          { type: "gauge", data: [{ value: 70, name: "With media" }] },
        ],
      }),
    ).toEqual([
      ["metric", "value"],
      ["Replies", 10],
      ["With media", 70],
    ]);
  });

  it("reads a radar as one row per author across the traits", () => {
    expect(
      csvFromOption({
        radar: { indicator: [{ name: "volume" }, { name: "replies" }] },
        series: [
          { type: "radar", name: "Ada", data: [{ value: [100, 40] }] },
          { type: "radar", name: "Bob", data: [{ value: [60, 80] }] },
        ],
      }),
    ).toEqual([
      ["author", "volume", "replies"],
      ["Ada", 100, 40],
      ["Bob", 60, 80],
    ]);
  });

  it("reads a scatter's named pairs", () => {
    expect(
      csvFromOption({
        series: [
          {
            type: "scatter",
            data: [
              { name: "Ada", value: [30, 12] },
              { name: "Bob", value: [5, 20] },
            ],
          },
        ],
      }),
    ).toEqual([
      ["name", "value 1", "value 2"],
      ["Ada", 30, 12],
      ["Bob", 5, 20],
    ]);
  });

  it("has nothing to say about a chart with no rows", () => {
    expect(csvFromOption({ series: [] })).toEqual([]);
    expect(csvFromOption({ series: [{ type: "graph", data: [] }] })).toEqual([]);
  });
});
