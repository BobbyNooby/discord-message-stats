import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The option the panel hands its chart — the closest a unit test can get to a
 * drawn colour without a canvas. */
const captured = vi.hoisted(() => ({ option: null as unknown }));

vi.mock("../lib/echart", () => ({
  EChart: ({ option }: { option: unknown }) => {
    captured.option = option;
    return null;
  },
}));

import type { Payload } from "../api/types";
import { initialFilters } from "../filters/reducer";
import { MessagesPerYear } from "./MessagesPerYear";

const payload = {
  authors: [{ id: "u1", name: "A", msgs: 5 }],
  days: ["2023-01-01", "2024-01-01"],
  cells: [
    [0, 0, 2, 10, 1, 0, 0],
    [1, 0, 3, 20, 1, 0, 0],
  ],
  meta: { types: [[0, "default", 5]], stale: false, can_admin: false, timezone: "UTC", total: 5 },
} as unknown as Payload;

/** jsdom cannot resolve CSS custom properties; stand in for the browser. */
function cssValues(variables: Record<string, string>): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) => variables[name] ?? "",
      }) as unknown as CSSStyleDeclaration,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("a chart's series colour follows the theme", () => {
  it("draws the overridden --chart-1 and --chart-peak once the variables resolve", () => {
    cssValues({ "--chart-1": "#ff00ff", "--chart-peak": "#00ff00" });
    render(<MessagesPerYear payload={payload} filters={initialFilters(payload)} />);

    const series = (captured.option as { series: { data: { itemStyle: { color: string } }[] }[] })
      .series[0];
    // Ascending years: 2023 is the plain bar, 2024 the peak.
    expect(series.data.map((row) => row.itemStyle.color)).toEqual(["#ff00ff", "#00ff00"]);
  });

  it("draws the upstream colours when nothing overrides them", () => {
    render(<MessagesPerYear payload={payload} filters={initialFilters(payload)} />);

    const series = (captured.option as { series: { data: { itemStyle: { color: string } }[] }[] })
      .series[0];
    expect(series.data.map((row) => row.itemStyle.color)).toEqual(["#5865f2", "#c9cdfc"]);
  });
});
