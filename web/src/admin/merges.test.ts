import { describe, expect, it } from "vitest";

import type { Author } from "../api/types";
import { addAlt, foldSuggestion, mergeDirectory, mergePair, removeAlt, type Merge } from "./merges";

const authors: Author[] = [
  { id: "a1", name: "Ada", msgs: 50 },
  { id: "b1", name: "Bo", msgs: 20, accounts: ["b1", "b2"] },
  { id: "c1", name: "Cy", msgs: 5 },
];
const merges: Merge[] = [{ canonical: "b1", members: ["b2"] }];

describe("the merge rules", () => {
  it("knows who every account belongs to", () => {
    const people = mergeDirectory(authors, merges);
    expect(people.canonicalFor("b2")).toBe("b1");
    expect(people.membersOf("b1")).toEqual(["b1", "b2"]);
    expect(people.headsAnIdentity("b1")).toBe(true);
    expect(people.chipLabel("b2")).toBe("account b2");
    // b2 is folded into b1, so it is not offered as a free account.
    expect(people.available).toEqual(["a1", "b1", "c1"]);
  });

  it("merges two identities under the winner, with every alt of both", () => {
    const people = mergeDirectory(authors, merges);
    const { next, accounts } = mergePair(merges, people.membersOf, "a1", "b1", "a1");
    expect(next).toEqual([{ canonical: "a1", members: ["b1", "b2"] }]);
    expect(accounts).toBe(3);
  });

  it("absorbs a whole identity only when asked to", () => {
    expect(addAlt(merges, "a1", "b1").next).toEqual([{ canonical: "a1", members: ["b1"] }]);
    expect(addAlt(merges, "a1", "b1", true)).toEqual({
      next: [{ canonical: "a1", members: ["b1", "b2"] }],
      moved: 2,
    });
  });

  it("drops a merge whose last alt is removed", () => {
    expect(removeAlt(merges, "b1", "b2")).toEqual([]);
  });

  it("lets the busier author keep the name when a suggestion is taken", () => {
    const { next, keep, fold } = foldSuggestion(merges, authors[2], authors[0]);
    expect(keep.id).toBe("a1");
    expect(fold.id).toBe("c1");
    expect(next).toEqual([...merges, { canonical: "a1", members: ["c1"] }]);
  });
});
