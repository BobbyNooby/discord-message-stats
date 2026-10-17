import { describe, expect, it } from "vitest";

import { EMPTY_AUTHORS, EMPTY_DATABASE, EMPTY_FILTER, emptyFor } from "./empty";

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
