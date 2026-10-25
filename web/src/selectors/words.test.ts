import { describe, expect, it } from "vitest";

import { initialFilters } from "../filters/reducer";
import { testPayload } from "../test/payload";
import { cloudRows, remoteRows, whoSaysItRows } from "./words";

const payload = testPayload({
  authors: [
    { id: "u1", name: "Ada", msgs: 30 },
    { id: "u2", name: "Bo", msgs: 10, accounts: ["u2", "u2alt"] },
  ],
  words: [
    ["car", 42],
    ["gpu", 9],
    ["care", 12],
  ],
  // "gpu" has no per-author breakdown, like 80 of the real 500 words.
  wordAuthors: { car: [[0, 40], [1, 2]], care: [[1, 12]] },
});
const all = initialFilters(payload);
const adaOnly = { ...all, active: [true, false] };

describe("the word numbers", () => {
  it("lists who says a word, fewest uses first, for the authors switched on", () => {
    expect(whoSaysItRows(payload, all, "car")).toEqual([
      { name: "Bo", value: 2, index: 1 },
      { name: "Ada", value: 40, index: 0 },
    ]);
    expect(whoSaysItRows(payload, adaOnly, "car")).toEqual([{ name: "Ada", value: 40, index: 0 }]);
    expect(whoSaysItRows(payload, all, null)).toEqual([]);
  });

  it("folds a merged alt's server count into its person", () => {
    const rows = remoteRows(payload, all, [
      { id: "u2", count: 3 },
      { id: "u2alt", count: 4 },
      { id: "u1", count: 1 },
      { id: "stranger", count: 99 },
    ]);
    expect(rows).toEqual([
      { name: "Ada", value: 1, index: 0 },
      { name: "Bo", value: 7, index: 1 },
    ]);
  });

  it("keeps the payload's own ranking with everyone on, and recounts for a smaller selection", () => {
    expect(cloudRows(payload, all)).toEqual(payload.words);
    // Under Ada alone only the words with a breakdown can be recounted.
    expect(cloudRows(payload, adaOnly)).toEqual([["car", 40]]);
    expect(cloudRows(payload, all, 2)).toHaveLength(2);
  });
});
