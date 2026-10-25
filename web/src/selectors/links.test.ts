import { describe, expect, it } from "vitest";

import { initialFilters } from "../filters/reducer";
import { testPayload } from "../test/payload";
import { domainRows, providerRows, providerTotals, topLinkRows } from "./links";

const payload = testPayload({
  authors: [
    { id: "u1", name: "Ada", msgs: 3 },
    { id: "u2", name: "Bo", msgs: 1 },
  ],
  days: ["2023-03-01", "2024-03-01"],
  linkDomains: ["example.test", "video.test"],
  // [day, author, domain, uses]
  linkCells: [
    [0, 0, 0, 5],
    [1, 1, 1, 9],
    [1, 0, 0, 2],
  ],
  topLinks: [
    ["example.test/a", 3],
    ["example.test/b", 8],
  ],
  providers: [
    ["Tenor", 7],
    ["unprovidenced", 4],
    ["YouTube", 0],
  ],
});
const all = initialFilters(payload);

describe("the link numbers", () => {
  it("re-adds the domain cells under the time and author filters, busiest first", () => {
    expect(domainRows(payload, all)).toEqual([
      ["video.test", 9],
      ["example.test", 7],
    ]);
    expect(domainRows(payload, { ...all, years: [2024], active: [true, false] })).toEqual([
      ["example.test", 2],
    ]);
  });

  it("ranks the reposted links most posted first", () => {
    expect(topLinkRows(payload).map(([link]) => link)).toEqual(["example.test/b", "example.test/a"]);
  });

  it("names Discord's unnamed bucket, and narrows to a scoped provider", () => {
    expect(providerRows(payload, null)).toEqual([
      { name: "Tenor", value: 7 },
      { name: "No provider", value: 4 },
    ]);
    expect(providerRows(payload, "Tenor")).toEqual([{ name: "Tenor", value: 7 }]);
  });

  it("totals the providers by the label a reader sees", () => {
    expect(providerTotals(payload)).toEqual([
      ["Tenor", 7],
      ["No provider", 4],
      ["YouTube", 0],
    ]);
  });
});
