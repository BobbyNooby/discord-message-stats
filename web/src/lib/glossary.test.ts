import { describe, expect, it } from "vitest";

import { PANEL_ABOUT, TERMS, panelAbout } from "./glossary";
import { PANELS, type PanelId } from "../panels/registry";

/**
 * Every card says what it shows. The registry is the list of cards, so a card
 * added without a line here is the failure this test exists to catch — the
 * type is `Record<PanelId, string>`, and this pins it at runtime too.
 */
describe("the glossary", () => {
  it("has one line for every card in the registry, and no orphans", () => {
    const ids = Object.keys(PANELS) as PanelId[];
    expect(Object.keys(PANEL_ABOUT).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(PANEL_ABOUT[id].length, `${id} has no description`).toBeGreaterThan(20);
    }
  });

  it("resolves a card's line by id, and nothing for a card outside the registry", () => {
    expect(panelAbout("word-lift")).toMatch(/signature of one person/i);
    expect(panelAbout(undefined)).toBeUndefined();
  });

  it("keeps the shared terms short enough to be a tooltip", () => {
    for (const [name, text] of Object.entries(TERMS)) {
      expect(text.length, `${name} is a paragraph, not a tooltip`).toBeLessThan(240);
      expect(text).toMatch(/[.!]$/);
    }
  });
});
