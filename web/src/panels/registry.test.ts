import { describe, expect, it } from "vitest";

import {
  DIMENSIONS,
  PANELS,
  SECTIONS,
  dimensionReach,
  isPanelId,
  offeredDimensions,
  panelsHonouring,
  panelsIgnoring,
  reachLabel,
  specFor,
  specForLabel,
} from "./registry";

/** The panel sources as text, read the way Vite reads them — no node types. */
const SOURCES = import.meta.glob("./*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Reads a JSX attribute value: `"text"` or a balanced `{expression}`. */
function readAttribute(text: string, start: number): string | null {
  if (text[start] === '"') {
    const end = text.indexOf('"', start + 1);
    return end < 0 ? null : text.slice(start + 1, end);
  }
  if (text[start] !== "{") return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** `title` values a panel declares, with simple `TITLE` constants resolved. */
function titlesInSource(): { file: string; titles: string[] }[] {
  const out: { file: string; titles: string[] }[] = [];
  for (const [file, text] of Object.entries(SOURCES).sort()) {
    if (file.endsWith(".test.tsx")) continue;
    if (!/<Panel\b/.test(text)) continue;
    const constants = new Map<string, string>();
    for (const match of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/g)) {
      constants.set(match[1], match[2]);
    }
    const titles: string[] = [];
    for (const match of text.matchAll(/<Panel\b[^>]*?\btitle=\s*/gs)) {
      const raw = readAttribute(text, match.index + match[0].length);
      if (raw === null) continue;
      if (!raw.startsWith("{")) {
        titles.push(raw);
        continue;
      }
      const expression = raw.slice(1, -1);
      const identifier = constants.get(expression.trim());
      if (identifier) {
        titles.push(identifier);
        continue;
      }
      // A conditional title (`word ? \`Who says ${word}\` : "Who says it"`)
      // still names the card in one of its branches.
      for (const literal of expression.matchAll(/"([^"]*)"/g)) titles.push(literal[1]);
    }
    out.push({ file, titles });
  }
  return out;
}

describe("the panel registry", () => {
  const rendered = titlesInSource();
  const labels = new Set(Object.values(PANELS).map((spec) => spec.label));

  it("reads a title off every panel the source renders", () => {
    // Guards the scan itself: a regex that silently matched nothing would make
    // the coverage test below pass for the wrong reason.
    expect(rendered.length).toBeGreaterThanOrEqual(30);
  });

  it("declares a spec for every panel the app renders", () => {
    for (const { file, titles } of rendered) {
      expect(titles.length, `${file} has a title this scan cannot read`).toBeGreaterThan(0);
      expect(
        titles.some((title) => labels.has(title)),
        `${file} renders ${titles.join(" | ")}, which no PanelSpec declares`,
      ).toBe(true);
    }
  });

  it("has no spec for a panel nobody renders", () => {
    const sourceLabels = new Set(rendered.flatMap((entry) => entry.titles));
    for (const spec of Object.values(PANELS)) {
      expect(sourceLabels.has(spec.label), `${spec.label} is declared but not rendered`).toBe(true);
    }
  });

  it("keys every spec by its own id", () => {
    for (const [key, spec] of Object.entries(PANELS)) expect(spec.id).toBe(key);
    expect(new Set(Object.values(PANELS).map((spec) => spec.label)).size).toBe(
      Object.values(PANELS).length,
    );
  });

  it("keeps defaultShape inside shapes", () => {
    for (const spec of Object.values(PANELS)) expect(spec.shapes).toContain(spec.defaultShape);
  });

  it("offers a pie only where the payload ships the whole list", () => {
    // Closed vocabularies: `rollup_type` (no LIMIT, every message has exactly
    // one type) and `rollup_embed_type` (one row per Discord embed kind). Then
    // the three cards whose part already sums to the whole: the two two-way
    // splits over all filtered messages, and Share of voice, which covers every
    // message with an author. Providers, mime types, emoji and reactions come
    // from `query.pairs(..., limit=30)` — an open vocabulary cut to its thirty
    // biggest rows — so a full circle would claim a total that is not there.
    const pie = Object.values(PANELS)
      .filter((spec) => spec.shapes.includes("pie"))
      .map((spec) => spec.id)
      .sort();
    expect(pie).toEqual([
      "embed-types",
      "message-types",
      "replies-vs-standalone",
      "share-of-voice",
      "text-vs-media",
    ]);
  });

  it("names the panels that honour a dimension, and only those", () => {
    expect(panelsHonouring("time")).toEqual(
      Object.values(PANELS)
        .filter((spec) => spec.honours.includes("time"))
        .map((spec) => spec.id),
    );
    expect(panelsHonouring("provider")).toEqual(["most-reposted", "embeds-by-provider"]);
    expect(panelsHonouring("word").sort()).toEqual(["who-says-it", "word-index"]);
  });

  it("states a dimension's reach from the registry, so a label cannot drift", () => {
    const total = Object.keys(PANELS).length;
    for (const dimension of DIMENSIONS) {
      expect(dimensionReach(dimension)).toEqual({
        honoured: panelsHonouring(dimension).length,
        total,
      });
      expect(reachLabel("X", dimension)).toBe(`X · ${panelsHonouring(dimension).length} of ${total} cards`);
    }
  });

  it("reports the measured reach the sidebar labels show", () => {
    // The brief measured 39 cards / 20 time / 29 author against an earlier
    // registry; the code carries 40 (chat-health added) and the numbers below.
    expect(dimensionReach("time")).toEqual({ honoured: 21, total: 40 });
    expect(dimensionReach("author")).toEqual({ honoured: 30, total: 40 });
    expect(dimensionReach("word")).toEqual({ honoured: 2, total: 40 });
    expect(dimensionReach("provider")).toEqual({ honoured: 2, total: 40 });
    expect(dimensionReach("kind")).toEqual({ honoured: 1, total: 40 });
  });

  it("offers only dimensions a rendered card honours", () => {
    // Every declared dimension currently has a card, so nothing is removed;
    // the gate exists so a future dimension with no card is never offered.
    expect(offeredDimensions()).toEqual([...DIMENSIONS]);
    for (const dimension of offeredDimensions()) {
      expect(panelsHonouring(dimension).length).toBeGreaterThan(0);
    }
  });

  it("partitions every card into exactly one section", () => {
    const seen = SECTIONS.flatMap((section) => section.panels);
    // One card can only be explained once: a duplicate would put two notes on
    // the same card, and a missing card would carry no note at all.
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(Object.keys(PANELS).sort());
  });

  it("names the cards a section cannot move with a dimension", () => {
    expect(panelsIgnoring("overview", "time")).toEqual([]);
    expect(panelsIgnoring("time", "time")).toEqual([]);
    expect(panelsIgnoring("people", "time").sort()).toEqual(
      [
        "how-fast-people-reply",
        "reply-balance",
        "reply-matrix",
        "who-replies-to-whom",
        "who-starts-conversations",
      ].sort(),
    );
    expect(panelsIgnoring("links", "time").sort()).toEqual(
      ["embed-providers", "embed-types", "most-reposted-links", "where-the-chat-lives"].sort(),
    );
    // Every one of these cards honours nothing, which is why none renders a
    // scope control any more.
    expect(panelsIgnoring("media", "time").sort()).toEqual(
      ["emoji-in-text", "message-types", "reactions", "what-gets-attached"].sort(),
    );
    expect(panelsIgnoring("rich-media", "time").sort()).toEqual(["embeds-by-provider", "most-reposted"].sort());
    expect(panelsIgnoring("words", "time").sort()).toEqual(
      ["who-says-it", "word-cloud", "word-index", "word-lift"].sort(),
    );
  });

  it("resolves a spec by id and by the label a card shows", () => {
    expect(specFor("messages-over-time").label).toBe("Messages over time");
    expect(specForLabel("Who talks the most")?.id).toBe("who-talks-the-most");
    expect(specForLabel("Not a panel")).toBeUndefined();
  });

  it("tells a panel id from an arbitrary string", () => {
    expect(isPanelId("word-cloud")).toBe(true);
    expect(isPanelId("sec-people")).toBe(false);
  });
});
