import { describe, expect, it } from "vitest";

import { initialFilters } from "../filters/reducer";
import { testPayload } from "../test/payload";
import { leaderRows, replyBalance, replyNetwork } from "./people";

const payload = testPayload({
  authors: [
    { id: "u1", name: "Ada", msgs: 9 },
    { id: "u2", name: "Bo", msgs: 4 },
    { id: "u3", name: "Cy", msgs: 0 },
  ],
  days: ["2024-01-01"],
  cells: [
    [0, 0, 9, 90, 0, 0, 0],
    [0, 1, 4, 80, 0, 0, 0],
  ],
  // rollup_reply rows: [parent, child, messages]
  edges: [
    [0, 1, 5],
    [1, 0, 2],
  ],
});
const all = initialFilters(payload);

describe("the people numbers", () => {
  it("ranks by messages or by characters, dropping anyone with none", () => {
    expect(leaderRows(payload, all).map((row) => row.name)).toEqual(["Ada", "Bo"]);
    expect(leaderRows(payload, all, "chars").map((row) => [row.name, row.value])).toEqual([
      ["Ada", 90],
      ["Bo", 80],
    ]);
  });

  it("draws the switched-on authors and every reply between them", () => {
    const network = replyNetwork(payload, all);
    expect(network.nodes.map((node) => [node.name, node.msgs])).toEqual([
      ["Ada", 9],
      ["Bo", 4],
      ["Cy", 0],
    ]);
    expect(network.links).toEqual([
      { source: "Ada", target: "Bo", value: 5 },
      { source: "Bo", target: "Ada", value: 2 },
    ]);
    expect(network.replies).toBe(7);
    // Switching Bo off takes both of Bo's edges with him.
    expect(replyNetwork(payload, { ...all, active: [true, false, true] }).links).toEqual([]);
  });

  it("weighs what each author sent against what they received", () => {
    const balance = replyBalance(payload, all);
    // Cy has no messages, so Cy is not a point on the scatter.
    expect(balance.points.map((point) => [point.name, point.sent, point.received])).toEqual([
      ["Ada", 2, 5],
      ["Bo", 5, 2],
    ]);
    expect(balance.total).toBe(7);
  });
});
