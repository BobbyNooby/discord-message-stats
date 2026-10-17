/**
 * §5.5's name heuristic, as a **score** rather than a yes/no.
 *
 * The board sorts by it and shows it, so a borderline pair ("angelina" and
 * "angelica") reads as a weaker suggestion than a containment ("Nightowl" and
 * "Owl") instead of both being presented as equally certain.
 */

import { describe, expect, it } from "vitest";

import { SUGGESTION_THRESHOLD, mergeScore, suggestsSamePerson } from "./IdentityMerge";

describe("mergeScore", () => {
  it("scores a containment above a mere shared run", () => {
    const contained = mergeScore("Nightowl", "Owl");
    const sharedRun = mergeScore("angelina", "angelica");
    expect(contained).toBeGreaterThan(sharedRun);
    expect(contained).toBeCloseTo(0.906, 2);
    expect(sharedRun).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD);
  });

  it("is zero for short handles and for names with nothing in common", () => {
    expect(mergeScore("alice", "wren")).toBe(0);
    expect(mergeScore("abc", "abcd")).toBe(0); // too short to be evidence
    expect(mergeScore("bobby", "zzzzzz")).toBe(0);
  });

  it("turns the same rule into the boolean §5.5 names", () => {
    expect(suggestsSamePerson("Nightowl", "Owl")).toBe(true);
    expect(suggestsSamePerson("angelina", "angelica")).toBe(true);
    expect(suggestsSamePerson("alice", "wren")).toBe(false);
    expect(mergeScore("Nightowl", "Owl")).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD);
  });
});
