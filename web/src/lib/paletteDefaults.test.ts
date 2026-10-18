// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CHART_DEFAULTS, PALETTE } from "./palette";

/** The real stylesheet, so the declared defaults and the fallbacks cannot drift. */
const STYLES = new URL("../styles.css", import.meta.url);

async function stylesheet(): Promise<string> {
  // @ts-ignore the web package ships no @types/node; Vitest runs on Node.
  const { readFileSync } = await import("node:fs");
  return readFileSync(STYLES, "utf8") as string;
}

describe("the chart palette defaults", () => {
  it("match the --chart-* values styles.css declares", async () => {
    const source = await stylesheet();

    PALETTE.forEach((colour, index) => {
      expect(source, `--chart-${index + 1} drifted from PALETTE[${index}]`).toContain(
        `--chart-${index + 1}: ${colour}`,
      );
    });
    expect(source).toContain(`--chart-peak: ${CHART_DEFAULTS.peak}`);
    CHART_DEFAULTS.heat.forEach((colour, index) => {
      expect(source).toContain(`--chart-heat-${index + 1}: ${colour}`);
    });
    expect(source).toContain(`--chart-heat-edge: ${CHART_DEFAULTS.heatEdge}`);
    expect(source).toContain(`--chart-tooltip-bg: ${CHART_DEFAULTS.tooltipBg}`);
    expect(source).toContain(`--chart-axis-dim: ${CHART_DEFAULTS.axisDim}`);
  });
});
