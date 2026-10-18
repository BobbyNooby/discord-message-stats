// @vitest-environment node
import { describe, expect, it } from "vitest";

/** Read the real sources the way Vite reads them — no filesystem types. */
const RAW = import.meta.glob("./*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TOKEN_FILE = new URL("../../theme/tokens.css", import.meta.url);

/** The theme file lives outside the Vite root, so read it straight off disk. */
async function readTokens(): Promise<string> {
  // @ts-ignore the web package ships no @types/node; Vitest runs on Node.
  const { readFileSync } = await import("node:fs");
  return readFileSync(TOKEN_FILE, "utf8") as string;
}

/** The variables a theme is allowed to override (spec §The theme surface). */
const TOKENS_REQUIRED = [
  "--color-ink",
  "--color-surface",
  "--color-surface-2",
  "--color-line",
  "--color-text",
  "--color-muted",
  "--color-accent",
];

describe("the theme seam", () => {
  it("ships the full token set from theme/tokens.css", async () => {
    const source = await readTokens();
    expect(source, "theme/tokens.css is empty").not.toBe("");
    // A `:root` block ties the base `:root` on specificity, so later order
    // is what makes the override win — see the import-order test below.
    expect(source).toContain(":root");
    for (const token of TOKENS_REQUIRED) {
      expect(source, `${token} is not declared in theme/tokens.css`).toContain(token);
    }
  });

  it("loads the theme after the base stylesheet, so its overrides win", () => {
    const main = RAW["./main.tsx"];
    expect(main, "main.tsx is missing").toBeTruthy();
    const base = main.indexOf('"./styles.css"');
    const theme = main.indexOf('"../../theme/tokens.css"');
    expect(base, "main.tsx no longer imports ./styles.css").toBeGreaterThanOrEqual(0);
    expect(theme, "main.tsx does not import ../../theme/tokens.css").toBeGreaterThanOrEqual(0);
    // CSS order in the bundle follows JS import order: last import wins.
    expect(theme).toBeGreaterThan(base);
  });
});
