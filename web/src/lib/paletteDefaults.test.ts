// @vitest-environment node
import { describe, expect, it } from "vitest";

import { PALETTE, THEME_DEFAULTS } from "./palette";

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
  });

  it("match every other theme colour styles.css declares", async () => {
    const source = await stylesheet();

    for (const [name, colour] of Object.entries(THEME_DEFAULTS)) {
      expect(source, `${name} drifted from its fallback`).toContain(`${name}: ${colour};`);
    }
  });
});
