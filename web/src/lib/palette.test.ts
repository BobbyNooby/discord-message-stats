import { afterEach, describe, expect, it, vi } from "vitest";

import { CHART_DEFAULTS, PALETTE, chartHeat, chartPeak, swatch, token } from "./palette";

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

describe("the chart palette's variable door", () => {
  it("falls back to the upstream values when CSS cannot compute a variable", () => {
    // jsdom returns "" for every custom property, so this is the unit-test path.
    expect(swatch(0)).toBe(PALETTE[0]);
    expect(swatch(3)).toBe(PALETTE[3]);
    expect(swatch(PALETTE.length)).toBe(PALETTE[0]);
    expect(token("--color-muted")).toBe("#8a93a8");
    expect(chartHeat()).toEqual([...CHART_DEFAULTS.heat]);
  });

  it("reads a --chart-N override off the document root", () => {
    cssValues({ "--chart-1": "#ff00ff" });

    expect(swatch(0)).toBe("#ff00ff");
    expect(swatch(12)).toBe("#ff00ff");
    // An untouched slot keeps its default rather than inheriting the override.
    expect(swatch(1)).toBe(PALETTE[1]);
  });

  it("reads the chart-only tokens through the same door", () => {
    cssValues({ "--chart-peak": "#123456", "--chart-heat-3": "#abcdef" });

    expect(chartPeak()).toBe("#123456");
    expect(chartHeat()[2]).toBe("#abcdef");
  });
});
