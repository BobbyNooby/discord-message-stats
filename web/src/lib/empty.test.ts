import { describe, expect, it } from "vitest";

import { initialFilters } from "../app/reducer";
import { testPayload } from "../test/payload";
import {
  EMPTY_AUTHORS,
  EMPTY_DATABASE,
  EMPTY_FILTER,
  emptyFor,
  emptyLabel,
  globalEmpty,
  noAuthorsSelected,
} from "./empty";

/**
 * An empty state is a dead end unless it names the way out. These three are the
 * whole page's dead ends, so each one has to carry an instruction.
 */
describe("empty states", () => {
  it("tells the reader how to get data in", () => {
    expect(EMPTY_DATABASE).toMatch(/ingest|upload/i);
    expect(emptyFor("embeds")).toMatch(/ingest|upload/i);
    expect(emptyFor("embeds")).toContain("embeds");
  });

  it("tells the reader which filter to loosen", () => {
    expect(EMPTY_FILTER).toMatch(/widen the time range/i);
    expect(EMPTY_FILTER).toMatch(/switch an author back on/i);
  });

  it("says which control turns the authors back on", () => {
    expect(EMPTY_AUTHORS).toMatch(/switch one back on in the filters/i);
  });
});

describe("which empty state applies", () => {
  const payload = testPayload({
    authors: [
      { id: "u1", name: "Ada", msgs: 3 },
      { id: "u2", name: "Bo", msgs: 1 },
    ],
    days: ["2024-01-01"],
    cells: [[0, 0, 3, 9, 0, 0, 0]],
  });
  const allOn = initialFilters(payload);
  const allOff = { ...allOn, active: [false, false] };

  it("calls an empty database an empty database, whatever the filters", () => {
    const empty = testPayload({ authors: payload.authors });
    expect(emptyLabel(empty, allOff)).toBe(EMPTY_DATABASE);
    expect(globalEmpty(empty, allOn)).toBe(EMPTY_DATABASE);
  });

  it("names the author switch when every author is off", () => {
    expect(noAuthorsSelected(payload, allOff)).toBe(true);
    expect(emptyLabel(payload, allOff)).toBe(EMPTY_AUTHORS);
    expect(globalEmpty(payload, allOff)).toBe(EMPTY_AUTHORS);
  });

  it("blames the filter otherwise, and never empties a date-less card for it", () => {
    expect(noAuthorsSelected(payload, allOn)).toBe(false);
    expect(emptyLabel(payload, { ...allOn, years: [1999] })).toBe(EMPTY_FILTER);
    expect(globalEmpty(payload, { ...allOn, years: [1999] })).toBeNull();
  });

  it("does not count authors as off before the payload has named any", () => {
    expect(noAuthorsSelected(testPayload(), { ...allOn, active: [] })).toBe(false);
  });
});
