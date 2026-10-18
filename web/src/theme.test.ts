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
const TOKENS_DOCUMENTED = [
  "--color-ink",
  "--color-surface",
  "--color-surface-2",
  "--color-line",
  "--color-text",
  "--color-muted",
  "--color-accent",
  "--chart-1",
  "--chart-12",
  "--chart-peak",
  "--chart-heat-1",
  "--chart-heat-5",
  "--chart-heat-edge",
  "--chart-tooltip-bg",
  "--chart-axis-dim",
];

/** What is left after the comments: the file's real declarations. */
function declarations(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

describe("the theme seam", () => {
  it("documents the available tokens without declaring any", async () => {
    const source = await readTokens();
    expect(source, "theme/tokens.css is empty").not.toBe("");
    // Comment-only by design: the defaults live upstream, so an upstream
    // palette change is not masked by a stale copy in this file.
    expect(declarations(source), "theme/tokens.css must declare nothing by default").toBe("");
    for (const token of TOKENS_DOCUMENTED) {
      // The colon keeps `--chart-1` from matching `--chart-12`.
      expect(source, `${token} is not documented in theme/tokens.css`).toContain(`${token}:`);
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
