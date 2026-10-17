import { beforeEach, describe, expect, it } from "vitest";

import type { Payload } from "../api/types";
import {
  CHARTS_KEY,
  SCOPES_KEY,
  loadCharts,
  loadScopes,
  readMediaOpen,
  readUrlState,
  saveCharts,
  saveScopes,
  writeMediaState,
  writeUrlState,
} from "./persist";

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

  it("drops a word the payload no longer has, and says which", () => {
    saveScopes({ "word-cloud": { word: "dog" } });
    const gone = { ...payload, words: [["cat", 9]] } as unknown as Payload;

    const { scopes, dropped } = loadScopes(gone);

    expect(scopes["word-cloud"]).toBeUndefined();
    expect(dropped).toEqual([{ panelId: "word-cloud", dimension: "word", key: "dog" }]);
  });

  it("ignores a scope for a card the registry no longer has", () => {
    saveScopes({ "no-such-card": { word: "cat" } });
    const { scopes, dropped } = loadScopes(payload);
    expect(scopes).toEqual({});
    expect(dropped).toEqual([{ panelId: "no-such-card", dimension: "kind", key: "scope" }]);
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
