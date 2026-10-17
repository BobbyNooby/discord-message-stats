import { describe, expect, it } from "vitest";

import { kindLabel, postedLabel, providerLabel } from "./mediaLabels";

/**
 * Discord writes the literal string "unprovidenced" when it cannot name an
 * embed's provider, and that string is an internal sentinel: `build.py` uses it
 * as a bucket, the UI must never show it (§UI/UX rule 1).
 */
describe("providerLabel", () => {
  it("passes a named provider through unchanged", () => {
    expect(providerLabel("Tenor", "https://tenor.com/view/cat")).toBe("Tenor");
    expect(providerLabel("YouTube", "")).toBe("YouTube");
  });

  it("calls an unnamed Discord CDN item a direct upload", () => {
    expect(providerLabel("unprovidenced", "https://cdn.discordapp.com/a.png")).toBe("Direct upload");
    expect(providerLabel("", "https://cdn.discordapp.net/a.png")).toBe("Direct upload");
  });

  it("calls an unnamed item with no usable URL 'No provider', never the sentinel", () => {
    expect(providerLabel("unprovidenced", "unprovidenced")).toBe("No provider");
    expect(providerLabel("unprovidenced", "https://example.com/a.png")).toBe("No provider");
    expect(providerLabel("", "")).toBe("No provider");
    expect(providerLabel("", "not a url")).toBe("No provider");
  });

  it("does not treat a lookalike host as Discord's CDN", () => {
    expect(providerLabel("unprovidenced", "https://notdiscordapp.com/a.png")).toBe("No provider");
  });
});

describe("kindLabel", () => {
  it("spells the embed kinds a reader would say out loud", () => {
    expect(kindLabel("gifv")).toBe("GIF");
    expect(kindLabel("video")).toBe("video");
    expect(kindLabel("image")).toBe("image");
  });

  it("passes an unknown kind through rather than hiding it", () => {
    expect(kindLabel("mystery")).toBe("mystery");
  });
});

describe("postedLabel", () => {
  it("counts a repost in words, and reads naturally at one", () => {
    expect(postedLabel(63)).toBe("posted 63 times");
    expect(postedLabel(1)).toBe("posted 1 time");
    expect(postedLabel(2132)).toBe("posted 2,132 times");
  });
});
