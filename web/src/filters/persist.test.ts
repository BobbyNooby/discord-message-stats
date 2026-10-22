import { beforeEach, describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import {
  CHARTS_KEY,
  SCOPES_KEY,
  describeDropped,
  loadCharts,
  loadScopes,
  readMediaOpen,
  readUrlState,
  readView,
  saveCharts,
  saveScopes,
  writeMediaState,
  writeUrlState,
} from "./persist";
import { initialDashboardState } from "./reducer";

const payload = {
  authors: [
    { id: "u1", name: "Alice", msgs: 10 },
    { id: "u2", name: "Bob", msgs: 4 },
    { id: "u3", name: "Carol", msgs: 2 },
  ],
  words: [
    ["cat", 9],
    ["dog", 4],
  ],
  providers: [["Tenor", 7]],
} as unknown as Payload;

beforeEach(() => {
  localStorage.clear();
});

describe("scope storage", () => {
  it("round-trips scopes through storage", () => {
    const scopes = { "who-talks-the-most": { active: [false, true, false], word: "cat" } };
    saveScopes(scopes);
    expect(loadScopes(payload).scopes).toEqual(scopes);
  });

  it("drops an author the payload no longer has, and says which", () => {
    // Bob is off and Carol is on: only the author the reader picked can be
    // called out as pruned, so only Carol is reported.
    saveScopes({ "who-talks-the-most": { active: [true, false, true] } }, ["Alice", "Bob", "Carol"]);
    const gone = {
      ...payload,
      authors: [{ id: "u1", name: "Alice", msgs: 10 }],
    } as unknown as Payload;

    const { scopes, dropped } = loadScopes(gone);

    // Bob is not in the rebuilt payload: the scope must not filter everything
    // to nothing, so the bit goes and the card falls back to the global view.
    expect(scopes["who-talks-the-most"].active).toEqual([true]);
    expect(dropped).toEqual([
      { panelId: "who-talks-the-most", dimension: "author", key: "Carol" },
    ]);
  });

  it("falls back to everybody when every author the reader kept is gone", () => {
    // The reader narrowed the card to Bob, and the rebuild no longer has him.
    // Writing an all-off list back would draw an empty card that looks broken
    // rather than filtered — the one state a saved scope must not produce.
    saveScopes({ "who-talks-the-most": { active: [false, true, false] } }, ["Alice", "Bob", "Carol"]);
    const gone = { ...payload, authors: [{ id: "u1", name: "Alice", msgs: 10 }] } as unknown as Payload;

    const { scopes, dropped } = loadScopes(gone);

    expect(scopes["who-talks-the-most"]).toBeUndefined();
    expect(dropped).toEqual([{ panelId: "who-talks-the-most", dimension: "author", key: "Bob" }]);
  });

  it("keeps a deliberate nobody, which is a state the reader can ask for", () => {
    saveScopes({ "who-talks-the-most": { active: [false, false, false] } }, ["Alice", "Bob", "Carol"]);

    const { scopes } = loadScopes(payload);

    expect(scopes["who-talks-the-most"].active).toEqual([false, false, false]);
  });

  it("drops a word the payload no longer has, and says which", () => {
    saveScopes({ "word-cloud": { word: "dog" } });
    const gone = { ...payload, words: [["cat", 9]] } as unknown as Payload;

    const { scopes, dropped } = loadScopes(gone);

    expect(scopes["word-cloud"]).toBeUndefined();
    expect(dropped).toEqual([{ panelId: "word-cloud", dimension: "word", key: "dog" }]);
  });

  it("round-trips a provider and kind scope", () => {
    const scopes = { "most-reposted": { provider: "Tenor", kind: "gifv" } };
    saveScopes(scopes);
    expect(loadScopes(payload).scopes).toEqual(scopes);
  });

  it("drops a provider the payload no longer has, and says which", () => {
    saveScopes({ "most-reposted": { provider: "YouTube" } });
    const gone = { ...payload, providers: [["Tenor", 7]] } as unknown as Payload;

    const { scopes, dropped } = loadScopes(gone);

    expect(scopes["most-reposted"]).toBeUndefined();
    expect(dropped).toEqual([
      { panelId: "most-reposted", dimension: "provider", key: "YouTube" },
    ]);
  });

  it("ignores a scope for a card the registry no longer has", () => {
    saveScopes({ "no-such-card": { word: "cat" } });
    const { scopes, dropped } = loadScopes(payload);
    expect(scopes).toEqual({});
    expect(dropped).toEqual([{ panelId: "no-such-card", card: true }]);
    // The banner names the card, not a dimension it never had: "kind “scope”"
    // told a reader nothing about what was dropped.
    expect(describeDropped(dropped, () => "unused")).toBe(
      "a filter for “no-such-card”, a card this build no longer has",
    );
  });

  it("never half-reads a payload written by another version", () => {
    localStorage.setItem(SCOPES_KEY, JSON.stringify({ version: 2, scopes: { "word-cloud": { word: "cat" } } }));
    expect(loadScopes(payload).scopes).toEqual({});

    localStorage.setItem(SCOPES_KEY, "not json at all");
    expect(loadScopes(payload).scopes).toEqual({});

    localStorage.setItem(SCOPES_KEY, JSON.stringify({ version: 1, scopes: { "word-cloud": "nope" } }));
    expect(loadScopes(payload).scopes).toEqual({});
  });
});

describe("chart storage", () => {
  it("round-trips the shapes a reader chose", () => {
    saveCharts({ "message-types": "pie" });
    expect(loadCharts()).toEqual({ "message-types": "pie" });
  });

  it("drops a shape the card no longer offers, rather than drawing one it cannot", () => {
    localStorage.setItem(
      CHARTS_KEY,
      JSON.stringify({ version: 1, charts: { "message-types": "pie", "emoji-in-text": "pie" } }),
    );
    expect(loadCharts()).toEqual({ "message-types": "pie" });
  });

  it("ignores a version it does not know, rather than half-reading it", () => {
    localStorage.setItem(CHARTS_KEY, JSON.stringify({ version: 9, charts: { "message-types": "pie" } }));
    expect(loadCharts()).toEqual({});

    localStorage.setItem(CHARTS_KEY, JSON.stringify({ version: 1, charts: { "message-types": "donut" } }));
    expect(loadCharts()).toEqual({});
  });
});

describe("the url mirror", () => {
  it("round-trips what is open through the query string", () => {
    const state = {
      scopes: {
        "who-talks-the-most": { active: [true, false, true] },
        "word-cloud": { word: "cat" },
        "messages-over-time": { from: "2024-01-01", to: "2024-06-30" },
      },
      authors: payload.authors.map((author) => author.name),
    };

    writeUrlState(state);
    expect(window.location.search).toContain("scope=");
    const { authors, ...rest } = state;
    expect(authors).toHaveLength(3);
    // Chart shapes live in their own storage key, never in the query string.
    expect(readUrlState(payload)).toEqual(rest);
  });

  it("resolves author names against the payload, not a stored index", () => {
    writeUrlState({
      scopes: { "word-cloud": { active: [false, true, true] } },
      authors: payload.authors.map((author) => author.name),
    });
    // A name is what the URL carries, so a reordered payload still means Bob.
    const reordered = {
      ...payload,
      authors: [payload.authors[2], payload.authors[1], payload.authors[0]],
    } as unknown as Payload;
    expect(readUrlState(reordered).scopes["word-cloud"].active).toEqual([true, true, false]);
  });

  it("returns nothing when the url names a card the registry does not have", () => {
    writeUrlState({ scopes: { "not-a-card": { word: "cat" } } });
    expect(readUrlState(payload).scopes).toEqual({});
  });

  it("round-trips a provider and kind scope through the query string", () => {
    writeUrlState({ scopes: { "most-reposted": { provider: "Tenor", kind: "gifv" } } });
    expect(readUrlState(payload).scopes["most-reposted"]).toEqual({
      provider: "Tenor",
      kind: "gifv",
    });
  });

  it("keeps a comma inside an author name from splitting the scope in two", () => {
    // "Smith, John" is one person. The URL joined names with a comma after
    // escaping, so the name's own comma looked like the separator and the card
    // silently narrowed to two people who do not exist.
    const withComma = {
      ...payload,
      authors: [
        { id: "u1", name: "Alice", msgs: 10 },
        { id: "u2", name: "Smith, John", msgs: 4 },
        { id: "u3", name: "Carol", msgs: 2 },
      ],
    } as unknown as Payload;

    writeUrlState({
      scopes: { "who-talks-the-most": { active: [true, true, false] } },
      authors: withComma.authors.map((author) => author.name),
    });

    expect(readUrlState(withComma).scopes["who-talks-the-most"].active).toEqual([true, true, false]);
  });

  it("round-trips a lone author whose name has a comma", () => {
    const withComma = {
      ...payload,
      authors: [
        { id: "u1", name: "Alice", msgs: 10 },
        { id: "u2", name: "Smith, John", msgs: 4 },
      ],
    } as unknown as Payload;

    writeUrlState({
      scopes: { "who-talks-the-most": { active: [false, true] } },
      authors: withComma.authors.map((author) => author.name),
    });

    expect(readUrlState(withComma).scopes["who-talks-the-most"].active).toEqual([false, true]);
  });

  it("still reads a link the old encoding wrote", () => {
    // Before names were escaped one at a time the whole list was encoded with
    // the comma still as its separator, which surfaces here as %2C.
    const old = new URLSearchParams({
      scope: `who-talks-the-most:author=${encodeURIComponent(["Alice", "Carol"].join(","))}`,
    }).toString();

    expect(readUrlState(payload, `?${old}`).scopes["who-talks-the-most"].active).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe("the sidebar's view in the url", () => {
  const names = payload.authors.map((author) => author.name);
  const base = { from: null, to: null, years: [], active: [true, true, true], bucket: "month" as const,
    word: null, provider: null, kind: null };

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("round-trips years, dates, people, bucket and word", () => {
    const view = { ...base, years: [2021, 2023], from: "2023-02-01", to: "2023-11-30",
      active: [true, false, true], bucket: "year" as const, word: "grandma" };
    writeUrlState({ scopes: {}, authors: names, view });
    expect(window.location.search).toContain("view=");
    expect(readView(payload)).toEqual({
      years: [2021, 2023], from: "2023-02-01", to: "2023-11-30",
      active: [true, false, true], bucket: "year", word: "grandma",
    });
  });

  it("writes nothing for the default view", () => {
    writeUrlState({ scopes: {}, authors: names, view: base });
    expect(window.location.search).not.toContain("view=");
    expect(readView(payload)).toEqual({});
  });

  it("keeps a card's scope and the view apart", () => {
    writeUrlState({ scopes: { "word-cloud": { word: "cat" } }, authors: names, view: { ...base, years: [2024] } });
    expect(readUrlState(payload).scopes).toEqual({ "word-cloud": { word: "cat" } });
    expect(readView(payload)).toEqual({ years: [2024] });
  });

  it("drops people who no longer match anyone rather than switching everyone off", () => {
    window.history.replaceState(null, "", "/?view=author%3D2%7CNobody");
    expect(readView(payload)).toEqual({});
  });

  it("starts the dashboard from the view a link carries", () => {
    window.history.replaceState(null, "", "/");
    writeUrlState({ scopes: {}, authors: names, view: { ...base, years: [2022], active: [false, true, false] } });
    const state = initialDashboardState(
      { ...payload, days: [] } as unknown as Payload,
      readView(payload),
    );
    expect(state.filters.years).toEqual([2022]);
    expect(state.filters.active).toEqual([false, true, false]);
  });
});

describe("the media view's url state", () => {
  it("reads ?media=1 as open, and anything else as closed", () => {
    expect(readMediaOpen("?media=1")).toBe(true);
    expect(readMediaOpen("?media=1&scope=x")).toBe(true);
    expect(readMediaOpen("?media=0")).toBe(false);
    expect(readMediaOpen("?scope=x")).toBe(false);
    expect(readMediaOpen("")).toBe(false);
  });

  it("sets and clears the flag without disturbing the rest of the view", () => {
    const url = new URL("https://example.test/?scope=foo");
    expect(writeMediaState(true, url)).toBe("https://example.test/?scope=foo&media=1");
    expect(writeMediaState(false, new URL("https://example.test/?scope=foo&media=1"))).toBe(
      "https://example.test/?scope=foo",
    );
  });
});
